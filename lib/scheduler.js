'use strict';

// Tier 4b Chunk 2 (shared with Tier 7.1) — in-process cron scheduler with
// Postgres advisory locks so multi-replica deploys (post Tier 10.4) only
// run any given tick once. Jobs register at module load and `start()` is
// called from server.js after the listener is up.
//
// Failure policy: a job that throws is logged + skipped; we never crash
// the host process. node-cron runs in-process so a missed tick (process
// died mid-handler) is the next tick's problem — fixture sync is daily
// and idempotent; live-score sync is once-per-minute and self-recovers.
//
// `register()` is idempotent against duplicate names: the second call
// replaces the first. Useful for hot-reload paths in dev.

const cron = require('node-cron');
const { sequelize } = require('../models');
const logger = require('./logger');

// crc32 — stable per-deploy lock id derived from job name. Postgres
// advisory locks are 64-bit (or two 32-bit), so a single 32-bit value
// works fine and stays human-readable in pg_locks.
function crc32(str) {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i += 1) {
    crc ^= str.charCodeAt(i);
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  // Force positive int32 for nicer logs; advisory locks treat the value
  // as bigint either way.
  return crc >>> 0;
}

const jobs = new Map(); // name → { schedule, handler, advisoryLockId, task }

function register(name, schedule, handler) {
  if (jobs.has(name)) {
    const existing = jobs.get(name);
    if (existing.task) {
      existing.task.stop();
      existing.task = null;
    }
  }
  jobs.set(name, {
    schedule,
    handler,
    advisoryLockId: crc32(name),
    task: null,
  });
}

async function withAdvisoryLock(lockId, handler) {
  const [rows] = await sequelize.query('SELECT pg_try_advisory_lock(:id) AS acquired', {
    replacements: { id: lockId },
  });
  const acquired = rows[0]?.acquired === true;
  if (!acquired) return { acquired: false };
  try {
    await handler();
  } finally {
    try {
      await sequelize.query('SELECT pg_advisory_unlock(:id)', { replacements: { id: lockId } });
    } catch (err) {
      // Releasing a lock we already hold is best-effort; surface but
      // don't propagate so the next tick still runs.
      logger.warn({ err, lockId }, 'scheduler: failed to release advisory lock');
    }
  }
  return { acquired: true };
}

function runTick(name, job) {
  return async () => {
    const startedAt = Date.now();
    try {
      const { acquired } = await withAdvisoryLock(job.advisoryLockId, job.handler);
      if (!acquired) {
        logger.info({ job: name }, 'scheduler: advisory lock not acquired, skipping tick');
        return;
      }
      logger.info({ job: name, durationMs: Date.now() - startedAt }, 'scheduler: tick completed');
    } catch (err) {
      logger.error({ err, job: name }, 'scheduler: tick failed');
    }
  };
}

function start() {
  if (process.env.NODE_ENV === 'test') {
    logger.info('scheduler: NODE_ENV=test, scheduler disabled');
    return { started: 0 };
  }
  let started = 0;
  for (const [name, job] of jobs.entries()) {
    if (job.task) continue;
    if (!cron.validate(job.schedule)) {
      logger.warn(
        { job: name, schedule: job.schedule },
        'scheduler: invalid cron schedule, skipping',
      );
      continue;
    }
    job.task = cron.schedule(job.schedule, runTick(name, job), { scheduled: true });
    started += 1;
    logger.info(
      { job: name, schedule: job.schedule, advisoryLockId: job.advisoryLockId },
      'scheduler: job registered',
    );
  }
  logger.info({ started, total: jobs.size }, `scheduler started: ${started} job(s) registered`);
  return { started };
}

function stop() {
  for (const [name, job] of jobs.entries()) {
    if (job.task) {
      job.task.stop();
      job.task = null;
      logger.info({ job: name }, 'scheduler: job stopped');
    }
  }
}

// Test-only helper — run a job's handler synchronously without waiting
// for the cron schedule. Used by ad-hoc verification scripts and the
// future Tier 7 integration tests.
async function triggerNow(name) {
  const job = jobs.get(name);
  if (!job) throw new Error(`scheduler: no job named ${name}`);
  await runTick(name, job)();
}

module.exports = { register, start, stop, triggerNow, _crc32: crc32 };
