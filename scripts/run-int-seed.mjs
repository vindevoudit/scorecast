// Wrapper for the international Elo seeder. Spawns sequelize-cli, captures
// all output to a file inside the container, and emits ASCII-only status to
// stdout. Required for invocation via `az containerapp exec` on Windows
// hosts whose Azure CLI hardcodes cp1252 in its stdout decoder and crashes
// the connection on the unicode spinner characters npx / pino emit. See
// CLAUDE.md's "ACA migrate-job AcrPull recipe" + the similar pattern from
// Tier 24's backfill scripts.

import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';

const SEED_FILE = '20260528000003-seed-teams-from-intl-elo-history.js';
const LOG_PATH = '/tmp/int-seed.log';

const child = spawn(
  'npx',
  ['sequelize-cli', 'db:seed', '--seed', SEED_FILE],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } },
);

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

child.on('exit', (code) => {
  try {
    writeFileSync(LOG_PATH, `STDOUT:\n${stdout}\nSTDERR:\n${stderr}\nEXIT: ${code}\n`);
  } catch {}
  // ASCII-only status to caller.
  const ok = code === 0 ? 'OK' : 'FAIL';
  // Look for the seeder's own success log line to confirm row insert.
  const upsertMatch = stdout.match(/"rows":\s*(\d+)/);
  const matchesMatch = stdout.match(/"matches":\s*(\d+)/);
  const teamsMatch = stdout.match(/"teams":\s*(\d+)/);
  const fields = [`STATUS=${ok}`, `EXIT=${code}`];
  if (upsertMatch) fields.push(`UPSERT_ROWS=${upsertMatch[1]}`);
  if (matchesMatch) fields.push(`MATCHES=${matchesMatch[1]}`);
  if (teamsMatch) fields.push(`TEAMS=${teamsMatch[1]}`);
  // ASCII-safe single-line summary so az containerapp exec on cp1252 doesn't choke.
  process.stdout.write(fields.join(' ') + '\n');
  // Print log path for follow-up inspection.
  process.stdout.write(`LOG_PATH=${LOG_PATH}\n`);
  // Optional: tail of the log without unicode.
  try {
    const tail = readFileSync(LOG_PATH, 'utf8')
      .split('\n')
      .filter((line) => !/[^\x09\x0a\x0d\x20-\x7e]/.test(line))
      .slice(-10)
      .join('\n');
    process.stdout.write('TAIL:\n' + tail + '\n');
  } catch {}
  process.exit(code ?? 1);
});
