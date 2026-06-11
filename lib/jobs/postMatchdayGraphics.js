'use strict';

// Tier 31 — Matchday graphics automation.
//
// Every 5 min (gated behind MARKETING_AUTOMATION_ENABLED at registration in
// server.js), renders the right social graphic for each "worthwhile" fixture
// at the right moment and EMAILS it to MARKETING_EMAIL_TO so the operator just
// downloads + posts (no IG/TikTok story API exists for auto-posting). Four
// graphic types, each on its own trigger window:
//
//   countdown      — "kicks off in 2h, get your picks in" — scheduled games
//                    with kickoff in [now+1h55m, now+2h). The 5-min band ==
//                    the cron interval, so each game fires once ~2h out.
//   picks-vs-model — "fans vs the model" — scheduled games with kickoff in
//                    [now+5m, now+10m); the crowd is fully formed just before
//                    the kickoff lock. Skipped when no one has picked (empty
//                    card is a weak post) or on placeholder / sentinel-prob
//                    fixtures (TBD-vs-TBD knockouts).
//   halftime       — final HT scoreboard — in-progress games that reached HT
//                    with elapsed (now − kickoff) in [45, 65] min (bounds it to
//                    the real break — halfTimeReached stays true into the 2nd
//                    half).
//   fulltime       — result + points a correct pick earned — finished games
//                    with a result + scores, bounded to a kickoff in the last
//                    5h so a fresh deploy doesn't email a backlog of every old
//                    finished game (cold-start guard — there's no finishedAt
//                    column to key off, and games has timestamps:false).
//
// Idempotency: marketing_posts (gameId, type) records each emitted graphic.
// The stamp lands AFTER a successful send (or a log-mode "no transport" run),
// so a transient email failure retries on the next tick. Per-type failures are
// isolated + logged; the job never throws back into the scheduler.
//
// The four SVG renderers + rasterizer live in marketing/lib/render.mjs (shared
// with the CLI so the emailed PNGs are byte-identical to `npm run
// assets:marketing`). render.mjs is ESM; it's dynamic-import()ed once and the
// module + fonts are cached across ticks. @resvg/resvg-js is a prod dep and
// marketing/lib + marketing/fonts are COPY'd into the runtime image (Dockerfile).

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Op } = require('sequelize');
const { League, Game, MarketingPost } = require('../../models');
const GameService = require('../../services/GameService');
const email = require('../email');
const logger = require('../logger');

// Trigger windows (minutes).
const COUNTDOWN_LEAD_MIN = 115; // ~1h55m before kickoff …
const COUNTDOWN_LEAD_MAX = 120; // … to 2h before (one 5-min tick wide).
const PVM_LEAD_MIN = 5; //  fans-vs-model: 5 min …
const PVM_LEAD_MAX = 10; //   … to 10 min before kickoff.
const HT_ELAPSED_MIN = 45; // halftime: elapsed since kickoff in [45, 65] min.
const HT_ELAPSED_MAX = 65;
const FULLTIME_LOOKBACK_MS = 5 * 60 * 60 * 1000; // only recently-finished games.

const RENDER_WIDTH = 1080; // both square (1080²) + story (1080×1920) fit-to-width.
const FORMATS = ['square', 'story'];

// Placeholder-fixture guard — mirrors src/utils/teamNames.js isPlaceholderGame
// + marketing/lib/livedata.mjs. Knockout brackets ship "Winner of QF1" /
// "Group A 1st" / "TBD" rows before the real teams are known.
const PLACEHOLDER_RE = /^(tbd|winner|loser|group\s|placeholder)/i;
function isPlaceholder(name) {
  return PLACEHOLDER_RE.test(String(name || '').trim());
}

// The model "untouched" sentinel (0.50, 0.00, 0.50) — a fixture the cascade
// hasn't predicted (no Elo yet). No real model story to tell.
function isSentinelProbs(h, d, a) {
  return Math.abs(h - 0.5) < 0.001 && Math.abs(d) < 0.001 && Math.abs(a - 0.5) < 0.001;
}

// Points a correct pick earns on a decisive result — mirrors lib/scoring.js
// scorePick (backing the winning side pays (1 − winningProb) × 100, so the
// underdog pays more). Draws are partial-credit + have no single winner → null.
function pointsForWinner(result, homeProb, awayProb) {
  if (result === 'home') return Math.round((1 - homeProb) * 100);
  if (result === 'away') return Math.round((1 - awayProb) * 100);
  return null;
}

// Format the kickoff date + time for the picks-vs-model meta line, preferring
// the fixture's IANA timezone (kickoffTz) and falling back to UTC. Mirrors
// marketing/lib/livedata.mjs formatDateParts. Guarded so a bad tz can't throw.
function formatKickoff(date, tz) {
  const fmt = (extra) => {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', ...extra });
    } catch {
      return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...extra });
    }
  };
  return {
    dateLabel: fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(date),
    kickoff: fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(date),
  };
}

// Filename-safe slug: "Aston Villa" → "aston-villa".
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

// ── Renderer module (ESM) — dynamic-imported once, cached across ticks ─────
let renderModule = null;
let fontFiles = null;
async function getRenderer() {
  if (!renderModule) {
    const url = pathToFileURL(path.join(__dirname, '../../marketing/lib/render.mjs')).href;
    renderModule = await import(url);
    fontFiles = await renderModule.loadFonts();
  }
  return renderModule;
}

// Of `candidates`, drop any (gameId, type) already in marketing_posts.
async function filterUnposted(candidates, type) {
  if (candidates.length === 0) return [];
  const already = await MarketingPost.findAll({
    where: { type, gameId: { [Op.in]: candidates.map((g) => g.id) } },
    attributes: ['gameId'],
    raw: true,
  });
  const posted = new Set(already.map((r) => r.gameId));
  return candidates.filter((g) => !posted.has(g.id));
}

// ── Per-type "due" queries ────────────────────────────────────────────────

async function findDueCountdown(leagueIds, now, leagueNameById) {
  const start = new Date(now + COUNTDOWN_LEAD_MIN * 60000);
  const end = new Date(now + COUNTDOWN_LEAD_MAX * 60000);
  const candidates = await Game.findAll({
    where: {
      leagueId: { [Op.in]: leagueIds },
      status: 'scheduled',
      date: { [Op.gte]: start, [Op.lt]: end },
    },
  });
  const unposted = await filterUnposted(candidates, 'countdown');
  return unposted
    .filter((g) => !isPlaceholder(g.homeTeam) && !isPlaceholder(g.awayTeam))
    .map((g) => ({
      id: g.id,
      home: g.homeTeam,
      away: g.awayTeam,
      leagueName: leagueNameById.get(g.leagueId) || '',
      kickoffAt: new Date(g.date),
    }));
}

async function findDuePicksVsModel(leagueIds, now, leagueNameById) {
  const start = new Date(now + PVM_LEAD_MIN * 60000);
  const end = new Date(now + PVM_LEAD_MAX * 60000);
  const candidates = await Game.findAll({
    where: {
      leagueId: { [Op.in]: leagueIds },
      status: 'scheduled',
      date: { [Op.gte]: start, [Op.lt]: end },
    },
  });
  const unposted = await filterUnposted(candidates, 'picks-vs-model');
  const eligible = unposted.filter((g) => {
    if (isPlaceholder(g.homeTeam) || isPlaceholder(g.awayTeam)) return false;
    return !isSentinelProbs(
      Number(g.homeProbability),
      Number(g.drawProbability),
      Number(g.awayProbability),
    );
  });
  if (eligible.length === 0) return [];

  // Crowd split — skip games no one has picked (empty card is a weak post).
  const crowdMap = await GameService.getCrowdForGames(eligible.map((g) => g.id));
  const due = [];
  for (const g of eligible) {
    const crowd = crowdMap.get(g.id) || { home: 0, away: 0, total: 0 };
    if (crowd.total === 0) continue;
    const { dateLabel, kickoff } = formatKickoff(new Date(g.date), g.kickoffTz);
    due.push({
      id: g.id,
      home: g.homeTeam,
      away: g.awayTeam,
      leagueName: leagueNameById.get(g.leagueId) || '',
      dateLabel,
      kickoff,
      probs: {
        home: Number(g.homeProbability),
        draw: Number(g.drawProbability),
        away: Number(g.awayProbability),
      },
      crowd,
    });
  }
  return due;
}

async function findDueHalftime(leagueIds, now, leagueNameById) {
  const candidates = await Game.findAll({
    where: {
      leagueId: { [Op.in]: leagueIds },
      status: 'in-progress',
      halfTimeReached: true,
      homeScore: { [Op.ne]: null },
      awayScore: { [Op.ne]: null },
    },
  });
  const unposted = await filterUnposted(candidates, 'halftime');
  return unposted
    .filter((g) => {
      if (isPlaceholder(g.homeTeam) || isPlaceholder(g.awayTeam)) return false;
      const elapsedMin = (now - new Date(g.date).getTime()) / 60000;
      return elapsedMin >= HT_ELAPSED_MIN && elapsedMin <= HT_ELAPSED_MAX;
    })
    .map((g) => ({
      id: g.id,
      home: g.homeTeam,
      away: g.awayTeam,
      leagueName: leagueNameById.get(g.leagueId) || '',
      homeScore: Number(g.homeScore),
      awayScore: Number(g.awayScore),
    }));
}

async function findDueFulltime(leagueIds, now, leagueNameById) {
  const candidates = await Game.findAll({
    where: {
      leagueId: { [Op.in]: leagueIds },
      status: 'finished',
      result: { [Op.ne]: null },
      homeScore: { [Op.ne]: null },
      awayScore: { [Op.ne]: null },
      // Cold-start guard — only games that kicked off in the last 5h (so a
      // fresh deploy doesn't flood the inbox with every historical result).
      date: { [Op.gte]: new Date(now - FULLTIME_LOOKBACK_MS) },
    },
  });
  const unposted = await filterUnposted(candidates, 'fulltime');
  return unposted
    .filter((g) => !isPlaceholder(g.homeTeam) && !isPlaceholder(g.awayTeam))
    .map((g) => ({
      id: g.id,
      home: g.homeTeam,
      away: g.awayTeam,
      leagueName: leagueNameById.get(g.leagueId) || '',
      homeScore: Number(g.homeScore),
      awayScore: Number(g.awayScore),
      result: g.result,
      winner: g.result === 'home' ? g.homeTeam : g.result === 'away' ? g.awayTeam : null,
      points: pointsForWinner(g.result, Number(g.homeProbability), Number(g.awayProbability)),
    }));
}

// ── Render + email one type's batch ───────────────────────────────────────

const RENDERERS = {
  countdown: (r, g, fmt) => r.renderKickoffCountdown(g, fmt),
  'picks-vs-model': (r, g, fmt) => r.renderPicksVsModel(g, fmt),
  halftime: (r, g, fmt) => r.renderHalftime(g, fmt),
  fulltime: (r, g, fmt) => r.renderFulltime(g, fmt),
};

const TYPE_TITLES = {
  countdown: 'Kickoff countdown',
  'picks-vs-model': 'Fans vs the model',
  halftime: 'Half-time',
  fulltime: 'Full-time',
};

function buildEmail(type, labels) {
  const title = TYPE_TITLES[type];
  const n = labels.length;
  const subject = `⚽ Matchday: ${title.toLowerCase()} — ${n} match${n === 1 ? '' : 'es'}`;
  const text = `${title} graphics (square + story) attached for:\n${labels
    .map((l) => `• ${l}`)
    .join('\n')}\n\nGrab them from the attachments and post.`;
  const html = `<p>${escapeHtml(title)} graphics (square + story) attached for:</p><ul>${labels
    .map((l) => `<li>${escapeHtml(l)}</li>`)
    .join('')}</ul><p>Grab them from the attachments and post.</p>`;
  return { subject, html, text };
}

// Render every due game in a type to square + story PNGs, email the batch, and
// (on success / log-mode) stamp marketing_posts. Returns the count posted.
async function processType(type, games, render, recipient) {
  if (games.length === 0) return 0;

  const attachments = [];
  for (const g of games) {
    for (const fmt of FORMATS) {
      const svg = RENDERERS[type](render, g, fmt);
      const png = await render.rasterize(svg, RENDER_WIDTH, fontFiles);
      attachments.push({
        filename: `${type}-${slugify(g.home)}-vs-${slugify(g.away)}-${fmt}.png`,
        content: png,
      });
    }
  }

  const labels = games.map((g) => `${g.home} vs ${g.away}`);
  const { subject, html, text } = buildEmail(type, labels);
  const res = await email.send({ to: recipient, subject, html, text, attachments });

  // Stamp on a real delivery OR on log-mode ("no transport" — dev without a
  // RESEND_API_KEY). A genuine send failure (configured but rejected) leaves
  // the rows un-stamped so the next tick retries.
  const ok = res.delivered || res.reason === 'no transport';
  if (!ok) {
    logger.warn(
      { type, count: games.length, reason: res.reason },
      'postMatchdayGraphics: email send failed — will retry next tick',
    );
    return 0;
  }

  await MarketingPost.bulkCreate(
    games.map((g) => ({ gameId: g.id, type })),
    { ignoreDuplicates: true },
  );
  logger.info(
    { type, count: games.length, delivered: res.delivered, matches: labels },
    'postMatchdayGraphics: posted matchday graphics',
  );
  return games.length;
}

async function run() {
  const recipient = process.env.MARKETING_EMAIL_TO;
  if (!recipient) {
    logger.warn('postMatchdayGraphics: MARKETING_EMAIL_TO unset — skipping');
    return { skipped: true, reason: 'no-recipient' };
  }

  const activeLeagues = await League.findAll({ where: { active: true } });
  if (activeLeagues.length === 0) {
    return { skipped: true, reason: 'no-active-leagues' };
  }
  const leagueIds = activeLeagues.map((l) => l.id);
  const leagueNameById = new Map(activeLeagues.map((l) => [l.id, l.name]));

  const now = Date.now();

  // Each query is a tight indexed SELECT; on an idle tick all four return [].
  const due = {
    countdown: await findDueCountdown(leagueIds, now, leagueNameById),
    'picks-vs-model': await findDuePicksVsModel(leagueIds, now, leagueNameById),
    halftime: await findDueHalftime(leagueIds, now, leagueNameById),
    fulltime: await findDueFulltime(leagueIds, now, leagueNameById),
  };

  const totalDue =
    due.countdown.length + due['picks-vs-model'].length + due.halftime.length + due.fulltime.length;
  if (totalDue === 0) {
    return { skipped: true, reason: 'nothing-due' };
  }

  // Only load the ESM renderer + fonts once there's actually work (keeps idle
  // ticks to four cheap SELECTs).
  const render = await getRenderer();

  const posted = {};
  for (const type of ['countdown', 'picks-vs-model', 'halftime', 'fulltime']) {
    try {
      posted[type] = await processType(type, due[type], render, recipient);
    } catch (err) {
      // Isolate per-type failures so one render/email error doesn't block the
      // other types this tick.
      logger.error({ err, type }, 'postMatchdayGraphics: type failed');
      posted[type] = 0;
    }
  }

  return { skipped: false, posted };
}

module.exports = { run };
