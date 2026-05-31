'use strict';

// Tier 30 Phase 3 C1 — smoke test that seeds rich pick history then captures
// a screenshot of the rendered StatsDashboard. Also asserts no page-level
// runtime errors fire (catches Vite/recharts interop regressions).

const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { USERS } = require('./fixtures/data');
const { loginViaUI } = require('./helpers/auth');

// Lazy-load models the same way helpers/api.js does.
function getModels() {
  require('./fixtures/env');
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
  return require('../../models');
}

const PAST_GAMES = [
  // 14 days of activity spread across two leagues so the line, win-rate
  // trend, league bar, heatmap, and blind-spot card all have something to
  // draw.
  {
    day: 28,
    home: 'Arsenal',
    away: 'Tigers',
    hp: 0.6,
    ap: 0.4,
    dp: 0.0,
    result: 'home',
    choice: 'home',
  },
  {
    day: 26,
    home: 'Arsenal',
    away: 'Sharks',
    hp: 0.55,
    ap: 0.45,
    dp: 0.0,
    result: 'away',
    choice: 'home',
  },
  {
    day: 24,
    home: 'Chelsea',
    away: 'Lions',
    hp: 0.4,
    ap: 0.6,
    dp: 0.0,
    result: 'away',
    choice: 'away',
  },
  {
    day: 22,
    home: 'Liverpool',
    away: 'Eagles',
    hp: 0.7,
    ap: 0.3,
    dp: 0.0,
    result: 'home',
    choice: 'home',
  },
  {
    day: 20,
    home: 'Arsenal',
    away: 'Wolves',
    hp: 0.5,
    ap: 0.5,
    dp: 0.0,
    result: 'away',
    choice: 'home',
  },
  {
    day: 18,
    home: 'Brazil',
    away: 'Argentina',
    hp: 0.4,
    ap: 0.4,
    dp: 0.2,
    result: 'draw',
    choice: 'home',
  },
  {
    day: 16,
    home: 'Liverpool',
    away: 'Falcons',
    hp: 0.65,
    ap: 0.35,
    dp: 0.0,
    result: 'home',
    choice: 'home',
  },
  {
    day: 14,
    home: 'Arsenal',
    away: 'Rangers',
    hp: 0.45,
    ap: 0.55,
    dp: 0.0,
    result: 'home',
    choice: 'home',
  },
  {
    day: 12,
    home: 'Chelsea',
    away: 'Sharks',
    hp: 0.5,
    ap: 0.5,
    dp: 0.0,
    result: 'away',
    choice: 'home',
  },
  {
    day: 10,
    home: 'France',
    away: 'Spain',
    hp: 0.5,
    ap: 0.5,
    dp: 0.0,
    result: 'home',
    choice: 'home',
  },
  {
    day: 8,
    home: 'Liverpool',
    away: 'Owls',
    hp: 0.6,
    ap: 0.4,
    dp: 0.0,
    result: 'home',
    choice: 'home',
  },
  {
    day: 6,
    home: 'Chelsea',
    away: 'Bears',
    hp: 0.55,
    ap: 0.45,
    dp: 0.0,
    result: 'home',
    choice: 'home',
  },
  {
    day: 4,
    home: 'Arsenal',
    away: 'Pumas',
    hp: 0.5,
    ap: 0.5,
    dp: 0.0,
    result: 'away',
    choice: 'away',
  },
  {
    day: 2,
    home: 'Liverpool',
    away: 'Stags',
    hp: 0.5,
    ap: 0.5,
    dp: 0.0,
    result: 'home',
    choice: 'home',
  },
];

function daysAgo(n, hour = 13) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

async function seedRichHistory() {
  const { Game, Pick } = getModels();
  const { LEAGUE_ID, SEASON_ID } = require('./fixtures/data');
  const aliceId = USERS.alice.id;

  // Clear any prior runs of this spec's data
  const previousIds = PAST_GAMES.map(
    (_, i) => `99999999-0000-4000-8000-${String(i).padStart(12, '0')}`,
  );
  await Pick.destroy({ where: { userId: aliceId, gameId: previousIds } });
  await Game.destroy({ where: { id: previousIds } });

  const games = PAST_GAMES.map((p, i) => ({
    id: `99999999-0000-4000-8000-${String(i).padStart(12, '0')}`,
    homeTeam: p.home,
    awayTeam: p.away,
    date: daysAgo(p.day),
    homeProbability: p.hp,
    drawProbability: p.dp,
    awayProbability: p.ap,
    result: p.result,
    status: 'finished',
    leagueId: LEAGUE_ID,
    seasonId: SEASON_ID,
  }));
  await Game.bulkCreate(games);

  const picks = PAST_GAMES.map((p, i) => {
    const game = games[i];
    // Submit time varies across the week so the heatmap has spread
    const submittedAt = new Date(game.date);
    submittedAt.setUTCDate(submittedAt.getUTCDate() - 1);
    submittedAt.setUTCHours((i * 3) % 24, 15, 0, 0);
    // Compute the score that StatsService will recompute via scorePick
    let pts = 0;
    if (game.result === 'draw') {
      const denom = p.hp + p.ap;
      const opp = p.choice === 'home' ? p.ap : p.hp;
      pts = denom > 0 ? Math.round(((p.dp * opp) / denom) * 100) : 0;
    } else if (p.choice === game.result) {
      const prob = p.choice === 'home' ? p.hp : p.ap;
      pts = Math.round((1 - prob) * 100);
    }
    return {
      userId: aliceId,
      gameId: game.id,
      choice: p.choice,
      submittedAt,
      pickedHomeProbability: p.hp,
      pickedDrawProbability: p.dp,
      pickedAwayProbability: p.ap,
      appliedResult: game.result,
      appliedPoints: pts,
    };
  });
  await Pick.bulkCreate(picks);
}

test.afterEach(async () => {
  const { Pick, Game } = getModels();
  const previousIds = PAST_GAMES.map(
    (_, i) => `99999999-0000-4000-8000-${String(i).padStart(12, '0')}`,
  );
  await Pick.destroy({ where: { userId: USERS.alice.id, gameId: previousIds } });
  await Game.destroy({ where: { id: previousIds } });
});

test('StatsDashboard renders with rich data + capture screenshot', async ({ page }) => {
  await seedRichHistory();
  // Bust the StatsService 5-min cache by invalidating via direct service call
  // (cache is in-process so we share it with the running app via the same DB
  // — wait, it doesn't share. Restart isn't possible from here; cache is
  // per-process. The webServer is the test app, and its cache is unaffected
  // by what this spec runs in-process. We just have to seed BEFORE the first
  // request the spec makes. Cache miss on first GET = computed from fresh DB).

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(e.message + '\n' + (e.stack || '')));

  await loginViaUI(page, USERS.alice);
  await page.getByRole('tab', { name: /Profile/i }).click();
  const statsTab = page.getByRole('tab', { name: /^Stats$/ });
  await expect(statsTab).toBeVisible({ timeout: 10000 });
  await statsTab.click();

  // Wait for the summary tiles + first chart card to appear
  await expect(page.getByText('Points over time')).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2000); // give recharts time to layout

  const out = path.join(__dirname, '..', '..', 'docs', 'stats-dashboard-screenshot.png');
  await page.screenshot({ path: out, fullPage: true });
  expect(pageErrors, `console errors: ${consoleErrors.join('|')}`).toEqual([]);
});
