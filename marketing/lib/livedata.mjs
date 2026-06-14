// Bantryx marketing kit — live production data fetchers.
//
// Read-only, raw-SQL access to the production database for the two
// live-data marketing assets (picks-vs-model per upcoming game + the
// thank-you / user-count graphic). Mirrors scripts/query-teams.mjs for the
// connection + SSL opt-in so prod Azure URLs (which carry `sslmode=require`)
// connect cleanly.
//
// Usage (PowerShell):   $env:DATABASE_URL="<prod url>"; npm run assets:marketing
//        (bash):        DATABASE_URL="<prod url>" npm run assets:marketing
//
// When DATABASE_URL is unset, openDb() returns null and the generator falls
// back to baked-in sample data so the full kit still renders offline. Every
// query is read-only — this module never writes.

import { Sequelize } from 'sequelize';

// Open a Sequelize handle against $DATABASE_URL, or null when unset. SSL is
// enabled when the URL asks for it (Azure DB for PostgreSQL requires TLS),
// matching models/index.js + scripts/query-teams.mjs.
export function openDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const opts = url.includes('sslmode=require')
    ? {
        dialect: 'postgres',
        dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
        logging: false,
      }
    : { logging: false };
  return new Sequelize(url, opts);
}

// Total registered users.
export async function fetchUserCount(db) {
  const [rows] = await db.query('SELECT COUNT(*)::int AS n FROM users');
  return rows[0]?.n ?? 0;
}

// Current top N players for the "top players" marketing graphic. Reads the
// PUBLIC leaderboard API (no DB creds needed — the same data + masking the
// site shows), so this works with a plain `npm run assets:marketing`. Masked
// rows (private/friends-only profiles) are skipped so we never feature a
// "Player #abcd" placeholder on a public post. Falls back to [] on any error
// (the generator then uses baked-in sample data).
//
// Shape: [{ username, displayName, points, streak }]
export async function fetchTopPlayers({ limit = 3, baseUrl = 'https://bantryx.com' } = {}) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/leaderboard?overallLimit=50`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.overall || [])
      .filter((r) => !r.isMasked)
      .slice(0, limit)
      .map((r) => ({
        username: r.username,
        displayName: r.displayName || null,
        points: Number(r.points || 0),
        streak: Number(r.currentWinStreak || 0),
      }));
  } catch {
    return [];
  }
}

// Placeholder-fixture guard — mirrors src/utils/teamNames.js isPlaceholderGame.
// Knockout brackets ship rows like "Winner of QF1" / "Group A 1st" / "TBD"
// before the real teams are known; a "what the model said" chart on those is
// meaningless (the cascade leaves them at the sentinel anyway).
const PLACEHOLDER_RE = /^(tbd|winner|loser|group\s|placeholder)/i;
function isPlaceholder(name) {
  return PLACEHOLDER_RE.test(String(name || '').trim());
}

// The model "untouched" sentinel (0.50, 0.00, 0.50) — a fixture whose teams
// have no Elo yet, or that the cascade hasn't predicted. Skip it: there's no
// real model story to tell.
function isSentinelProbs(h, d, a) {
  return Math.abs(h - 0.5) < 0.001 && Math.abs(d) < 0.001 && Math.abs(a - 0.5) < 0.001;
}

function formatDateParts(date, tz) {
  // Format the kickoff date + time. Prefer the fixture's IANA timezone when
  // present (kickoffTz, e.g. "Europe/London"); fall back to UTC. Guard the
  // Intl call so a malformed tz string can't throw the whole run.
  const opts = (extra) => {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', ...extra });
    } catch {
      return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...extra });
    }
  };
  const dateLabel = opts({ weekday: 'short', day: 'numeric', month: 'short' }).format(date);
  const kickoff = opts({ hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return { dateLabel, kickoff };
}

// Every upcoming (scheduled) fixture with its model probabilities + the live
// crowd split (winner-only home/away pick counts). Placeholder + sentinel-prob
// fixtures are filtered out. Returns [] when there are none.
//
// Shape: [{ id, home, away, dateLabel, kickoff, leagueName,
//           probs:{home,draw,away}, crowd:{home,away,total} }]
export async function fetchUpcomingGames(db) {
  const [games] = await db.query(`
    SELECT g.id,
           g."homeTeam"        AS home,
           g."awayTeam"        AS away,
           g.date              AS date,
           g."kickoffTz"       AS tz,
           g."homeProbability" AS hp,
           g."drawProbability" AS dp,
           g."awayProbability" AS ap,
           l.name              AS league
    FROM games g
    LEFT JOIN leagues l ON l.id = g."leagueId"
    WHERE g.status = 'scheduled'
    ORDER BY g.date ASC
  `);

  const eligible = games.filter((g) => {
    if (isPlaceholder(g.home) || isPlaceholder(g.away)) return false;
    const h = Number(g.hp);
    const d = Number(g.dp);
    const a = Number(g.ap);
    if (isSentinelProbs(h, d, a)) return false;
    return true;
  });

  // One grouped crowd query across every eligible game id.
  const crowdByGame = new Map();
  if (eligible.length > 0) {
    const ids = eligible.map((g) => g.id);
    const [rows] = await db.query(
      `SELECT "gameId", choice, COUNT(*)::int AS c
       FROM picks WHERE "gameId" = ANY($ids) GROUP BY "gameId", choice`,
      { bind: { ids } },
    );
    for (const r of rows) {
      const entry = crowdByGame.get(r.gameId) || { home: 0, away: 0, total: 0 };
      if (r.choice === 'home') entry.home = r.c;
      else if (r.choice === 'away') entry.away = r.c;
      entry.total += r.c;
      crowdByGame.set(r.gameId, entry);
    }
  }

  return eligible.map((g) => {
    const kickoffAt = new Date(g.date);
    const { dateLabel, kickoff } = formatDateParts(kickoffAt, g.tz);
    return {
      id: g.id,
      home: g.home,
      away: g.away,
      // Raw kickoff Date so renderers can compute a live "kicks off in N"
      // countdown at generation time (dateLabel/kickoff are the preformatted
      // display strings).
      kickoffAt,
      dateLabel,
      kickoff,
      leagueName: g.league || '',
      probs: { home: Number(g.hp), draw: Number(g.dp), away: Number(g.ap) },
      crowd: crowdByGame.get(g.id) || { home: 0, away: 0, total: 0 },
    };
  });
}

// In-progress fixtures that already have a score on the board — the source for
// the halftime score graphic. Ordered so a game that has reached half-time
// (halfTimeReached) is preferred, then by kickoff. Placeholder fixtures are
// filtered. Returns [] when nothing is live.
//
// Shape: [{ home, away, homeScore, awayScore, halfTimeReached, leagueName }]
export async function fetchLiveGames(db) {
  const [games] = await db.query(`
    SELECT g."homeTeam"        AS home,
           g."awayTeam"        AS away,
           g."homeScore"       AS hs,
           g."awayScore"       AS ascore,
           g."halfTimeReached" AS htr,
           l.name              AS league
    FROM games g
    LEFT JOIN leagues l ON l.id = g."leagueId"
    WHERE g.status = 'in-progress'
      AND g."homeScore" IS NOT NULL
      AND g."awayScore" IS NOT NULL
    ORDER BY g."halfTimeReached" DESC, g.date ASC
  `);

  return games
    .filter((g) => !isPlaceholder(g.home) && !isPlaceholder(g.away))
    .map((g) => ({
      home: g.home,
      away: g.away,
      homeScore: Number(g.hs),
      awayScore: Number(g.ascore),
      halfTimeReached: Boolean(g.htr),
      leagueName: g.league || '',
    }));
}

// Points a correct pick earns on a decisive result, mirroring lib/scoring.js
// scorePick: backing the winning side pays (1 - winning_probability) × 100, so
// backing an underdog pays more. Draws are winner-only-pick partial credit and
// have no single "winner", so they return null here.
function pointsForWinner(result, homeProb, awayProb) {
  if (result === 'home') return Math.round((1 - homeProb) * 100);
  if (result === 'away') return Math.round((1 - awayProb) * 100);
  return null;
}

// Partial credit a winner-only pick on `side` earns on a DRAW, mirroring
// lib/scoring.js scorePick: (drawProb × opposite-side prob / (home+away)) × 100.
// The two sides pay differently — backing the bigger underdog pays more.
function pointsForDraw(side, homeProb, drawProb, awayProb) {
  const denom = homeProb + awayProb;
  if (!(drawProb > 0) || denom <= 0) return 0;
  const opposite = side === 'home' ? awayProb : homeProb;
  return Math.round(((drawProb * opposite) / denom) * 100);
}

// Finished fixtures with a score + a recorded result — the source for the
// full-time card. Precomputes the winner + the points a correct pick earned.
// Ordered most-recent-first; placeholder fixtures filtered.
//
// Shape: [{ home, away, homeScore, awayScore, result, winner, points,
//           drawPoints:{home,away}|null, leagueName }]
export async function fetchFinishedGames(db) {
  const [games] = await db.query(`
    SELECT g."homeTeam"        AS home,
           g."awayTeam"        AS away,
           g."homeScore"       AS hs,
           g."awayScore"       AS ascore,
           g.result            AS result,
           g."homeProbability" AS hp,
           g."drawProbability" AS dp,
           g."awayProbability" AS ap,
           l.name              AS league
    FROM games g
    LEFT JOIN leagues l ON l.id = g."leagueId"
    WHERE g.status = 'finished'
      AND g.result IS NOT NULL
      AND g."homeScore" IS NOT NULL
      AND g."awayScore" IS NOT NULL
    ORDER BY g.date DESC
  `);

  return games
    .filter((g) => !isPlaceholder(g.home) && !isPlaceholder(g.away))
    .map((g) => ({
      home: g.home,
      away: g.away,
      homeScore: Number(g.hs),
      awayScore: Number(g.ascore),
      result: g.result,
      winner: g.result === 'home' ? g.home : g.result === 'away' ? g.away : null,
      points: pointsForWinner(g.result, Number(g.hp), Number(g.ap)),
      drawPoints:
        g.result === 'draw'
          ? {
              home: pointsForDraw('home', Number(g.hp), Number(g.dp), Number(g.ap)),
              away: pointsForDraw('away', Number(g.hp), Number(g.dp), Number(g.ap)),
            }
          : null,
      leagueName: g.league || '',
    }));
}
