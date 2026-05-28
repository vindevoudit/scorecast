'use strict';

// Captures the screenshots embedded in src/components/legal/Help.jsx.
// Writes PNGs directly to public/help/ so they ship as static assets via
// Vite's public-dir copy. Run with `npm run capture:help` against the
// iPhone-13 mobile project — single-device since the help page links one
// image per step.
//
// Each test below walks through one user-visible flow on a richer custom
// seed (real-feeling usernames, PL-flavoured fixtures, populated groups +
// friends + one scored game). The seed is rebuilt once in beforeAll;
// individual tests then drive the UI to the right state and shot().

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('../fixtures/env');
const { apiLogin } = require('../helpers/api');

const OUTPUT_DIR = path.resolve(__dirname, '..', '..', '..', 'public', 'help');

// Pre-bcrypted at rounds 10 in the seed function. Plain password is what the
// API helpers pass to /api/login.
const PASSWORD = 'HelpDemo123!';

// Stable UUIDs — different namespace from fixtures/data.js so the help seed
// can't collide with the regular E2E specs if they're somehow run together.
const LEAGUE_ID = '44444444-0000-4000-8000-000000000001';
const SEASON_ID = '55555555-0000-4000-8000-000000000001';

const USERS = {
  alex: {
    id: '66666666-0000-4000-8000-000000000001',
    username: 'alex_morgan',
    email: 'alex@example.test',
    displayName: 'Alex Morgan',
    bio: 'Liverpool fan. Sunday League predictor.',
  },
  jordan: {
    id: '66666666-0000-4000-8000-000000000002',
    username: 'jordan_lee',
    email: 'jordan@example.test',
    displayName: 'Jordan Lee',
  },
  sam: {
    id: '66666666-0000-4000-8000-000000000003',
    username: 'sam_kelly',
    email: 'sam@example.test',
    displayName: 'Sam Kelly',
  },
  riley: {
    id: '66666666-0000-4000-8000-000000000004',
    username: 'riley_ng',
    email: 'riley@example.test',
    displayName: 'Riley Ng',
  },
  casey: {
    id: '66666666-0000-4000-8000-000000000005',
    username: 'casey_p',
    email: 'casey@example.test',
    displayName: 'Casey P',
  },
  morgan: {
    id: '66666666-0000-4000-8000-000000000006',
    username: 'morgan_t',
    email: 'morgan@example.test',
    displayName: 'Morgan T',
  },
  admin: {
    id: '66666666-0000-4000-8000-000000000099',
    username: 'help_admin',
    email: 'help-admin@example.test',
    displayName: 'Help Admin',
    role: 'admin',
  },
};

function daysFromNow(days, hour = 18) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

// Brighton's TRUE date is yesterday — the result-card flow lives there.
// But PickService.createPick rejects picks on games whose kickoff has passed,
// so we create the row with a near-future temporary date, create alex's pick
// at API time, then direct-update the row to its real yesterday date BEFORE
// admin sets the result. Tier 24's dual-writer fires inside GameService.setResult
// and populates user_scores correctly regardless of game date.
//
// Backdate uses LOCAL yesterday-noon (not UTC) because the calendar's
// dayKey() uses en-CA local-timezone formatting; a stored "yesterday 16:00 UTC"
// could fall on today/tomorrow under offsets like UTC+8.
const brightonBackdate = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
})();

function localDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// Today-games use NOW + N hours so pick buttons render regardless of when
// the capture is run. Brighton's temp date is NOW + 6 h (well in future);
// the seedRelationships step backdates it to yesterday after the pick is
// created. Multi-day games stay on the daysFromNow grid since their bucket
// is forgiving.
const GAMES = {
  brighton: {
    id: '77777777-0000-4000-8000-000000000001',
    homeTeam: 'Brighton',
    awayTeam: 'Aston Villa',
    date: hoursFromNow(6),
    homeProbability: 0.4,
    drawProbability: 0.25,
    awayProbability: 0.35,
    status: 'scheduled',
    result: null,
  },
  liverpool: {
    id: '77777777-0000-4000-8000-000000000002',
    homeTeam: 'Liverpool',
    awayTeam: 'Manchester City',
    date: hoursFromNow(4),
    homeProbability: 0.55,
    drawProbability: 0.2,
    awayProbability: 0.25,
    status: 'scheduled',
    result: null,
  },
  arsenal: {
    id: '77777777-0000-4000-8000-000000000003',
    homeTeam: 'Arsenal',
    awayTeam: 'Chelsea',
    date: hoursFromNow(3),
    homeProbability: 0.5,
    drawProbability: 0.22,
    awayProbability: 0.28,
    status: 'scheduled',
    result: null,
  },
  palace: {
    id: '77777777-0000-4000-8000-000000000004',
    homeTeam: 'Crystal Palace',
    awayTeam: 'West Ham',
    date: daysFromNow(1, 15),
    homeProbability: 0.35,
    drawProbability: 0.22,
    awayProbability: 0.43,
    status: 'scheduled',
    result: null,
  },
  newcastle: {
    id: '77777777-0000-4000-8000-000000000005',
    homeTeam: 'Newcastle',
    awayTeam: 'Tottenham',
    date: daysFromNow(2, 17),
    homeProbability: 0.42,
    drawProbability: 0.23,
    awayProbability: 0.35,
    status: 'scheduled',
    result: null,
  },
};

async function seedHelpFixtures() {
  // Lazy require so DATABASE_URL is set before models load.
  require('../fixtures/env');
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
  const { sequelize, User, Game, League, Season, GroupMember } = require('../../../models');

  const [tables] = await sequelize.query(`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename <> 'SequelizeMeta'
  `);
  if (tables.length > 0) {
    const list = tables.map((t) => `"${t.tablename}"`).join(', ');
    await sequelize.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }

  const now = new Date();

  await League.create({
    id: LEAGUE_ID,
    name: 'Premier League',
    sourceProvider: 'legacy',
    sourceLeagueId: 'PL',
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  await League.create({
    name: 'Legacy / Imported',
    sourceProvider: 'legacy',
    sourceLeagueId: 'LEGACY',
    active: false,
    createdAt: now,
    updatedAt: now,
  });
  await Season.create({
    id: SEASON_ID,
    leagueId: LEAGUE_ID,
    year: now.getUTCFullYear(),
    current: true,
    createdAt: now,
    updatedAt: now,
  });

  const hashed = await bcrypt.hash(PASSWORD, 10);
  const userRows = Object.values(USERS).map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    emailVerifiedAt: now,
    password: hashed,
    role: u.role || 'user',
    displayName: u.displayName,
    bio: u.bio || null,
    loginAttempts: 0,
    onboardingCompletedAt: now,
    termsAcceptedAt: now,
    termsAcceptedVersion: 2,
    pushPreferences: {},
    createdAt: now,
  }));
  await User.bulkCreate(userRows);

  await Game.bulkCreate(
    Object.values(GAMES).map((g) => ({
      ...g,
      leagueId: LEAGUE_ID,
      seasonId: SEASON_ID,
    })),
  );

  return { sequelize, Game, GroupMember };
}

async function seedRelationships(Game, GroupMember) {
  // Use the service layer for picks + result so dual-writers run.
  const alex = await apiLogin({ username: USERS.alex.username, password: PASSWORD });
  const jordan = await apiLogin({ username: USERS.jordan.username, password: PASSWORD });
  const sam = await apiLogin({ username: USERS.sam.username, password: PASSWORD });
  const riley = await apiLogin({ username: USERS.riley.username, password: PASSWORD });
  const morgan = await apiLogin({ username: USERS.morgan.username, password: PASSWORD });
  const admin = await apiLogin({ username: USERS.admin.username, password: PASSWORD });

  try {
    // Alex's picks: brighton (today temp date — will backdate after), liverpool, palace.
    await alex.post('/api/picks', { data: { gameId: GAMES.brighton.id, choice: 'home' } });
    await alex.post('/api/picks', { data: { gameId: GAMES.liverpool.id, choice: 'home' } });
    await alex.post('/api/picks', { data: { gameId: GAMES.palace.id, choice: 'away' } });

    // Friends' picks so the FriendPicksPanel + leaderboard have content.
    await jordan.post('/api/picks', { data: { gameId: GAMES.brighton.id, choice: 'away' } });
    await jordan.post('/api/picks', { data: { gameId: GAMES.liverpool.id, choice: 'away' } });
    await sam.post('/api/picks', { data: { gameId: GAMES.brighton.id, choice: 'home' } });
    await sam.post('/api/picks', { data: { gameId: GAMES.arsenal.id, choice: 'home' } });

    // Backdate brighton to yesterday via direct DB write — PickService is now
    // out of the picture and admin's POST /result doesn't gate on date.
    await Game.update(
      { date: brightonBackdate },
      { where: { id: GAMES.brighton.id }, hooks: false },
    );

    // Score brighton (Brighton wins) so the dual-writer + notify + badge
    // cascade fires exactly like prod. Sam + alex picked home → win. Jordan
    // picked away → loss.
    await admin.post(`/api/games/${GAMES.brighton.id}/result`, { data: { result: 'home' } });

    // Friendships: alex ↔ jordan accepted, alex ↔ sam accepted, riley → alex pending.
    // POST /api/friends/request returns { success, friendship: { id, ... } }.
    const r1 = await alex.post('/api/friends/request', {
      data: { username: USERS.jordan.username },
    });
    if (r1.ok()) {
      const body = await r1.json();
      if (body?.friendship?.id) {
        await jordan.post(`/api/friends/${body.friendship.id}/accept`);
      }
    }
    const r2 = await alex.post('/api/friends/request', {
      data: { username: USERS.sam.username },
    });
    if (r2.ok()) {
      const body = await r2.json();
      if (body?.friendship?.id) {
        await sam.post(`/api/friends/${body.friendship.id}/accept`);
      }
    }
    // Pending inbound: riley → alex.
    await riley.post('/api/friends/request', { data: { username: USERS.alex.username } });

    // Groups:
    //  - "Sunday League Crew" → public, alex owns. Jordan + Sam are members.
    //  - "Pundit Pool" → public, morgan owns. Alex is NOT a member (so the
    //    Discover panel has one to join).
    //  - "VIP Predictors" → private + password, morgan owns. Alex is NOT
    //    a member.
    // Use direct GroupMember inserts for jordan/sam: the invite-accept
    // ceremony's response doesn't expose the inviteId, and a member-only
    // flow doesn't change visible state in screenshots.
    const sundayRes = await alex.post('/api/groups', {
      data: { name: 'Sunday League Crew', visibility: 'public' },
    });
    if (sundayRes.ok()) {
      const body = await sundayRes.json();
      const sunday = body?.group || body;
      if (sunday?.id) {
        await GroupMember.create({ groupId: sunday.id, userId: USERS.jordan.id });
        await GroupMember.create({ groupId: sunday.id, userId: USERS.sam.id });
      }
    }
    await morgan.post('/api/groups', {
      data: { name: 'Pundit Pool', visibility: 'public' },
    });
    await morgan.post('/api/groups', {
      data: { name: 'VIP Predictors', visibility: 'private', password: 'demo-pass-123' },
    });
  } finally {
    await Promise.all([
      alex.dispose(),
      jordan.dispose(),
      sam.dispose(),
      riley.dispose(),
      morgan.dispose(),
      admin.dispose(),
    ]);
  }
}

async function shot(page, name, { fullPage = true } = {}) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`), fullPage });
}

async function dismissLanding(page) {
  const cta = page.getByRole('button', { name: /Get started/i }).first();
  await cta.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await cta.isVisible().catch(() => false)) await cta.click();
}

async function loginMobile(page, { username, password }) {
  await page.goto('/');
  await dismissLanding(page);
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: /^Sign in$/ }).click();
  await page.locator('[aria-haspopup="menu"]:visible').waitFor({ timeout: 15_000 });
}

async function openSidebarTab(page, tabName) {
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('dialog', { name: 'Dashboard navigation' }).waitFor({ timeout: 5000 });
  await page.getByRole('tab', { name: tabName }).click();
  await page.waitForTimeout(200);
}

test.describe('help page screenshots', () => {
  let sequelize;

  // The seed runs a lot of HTTP+DB work (6 picks, 1 setResult, 3 friendship
  // flows, 3 group creates, 2 invite/accepts). Default 60s hook timeout is
  // too tight; bump to 5 min for the hook + per-test.
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    const seeded = await seedHelpFixtures();
    sequelize = seeded.sequelize;
    // Wait for the server to be up before HTTP-seeding relationships.
    await fetch(`${BASE_URL}/healthz`).catch(() => {});
    await seedRelationships(seeded.Game, seeded.GroupMember);
  });

  test.afterAll(async () => {
    // Don't close — workers:1 shares the pool with other specs if both ran.
    // The capture script only runs this project, so it doesn't matter much.
    if (sequelize) await sequelize.close().catch(() => {});
  });

  test('01 — landing / sign up', async ({ page }) => {
    // Landing page itself.
    await page.goto('/');
    await page.getByRole('heading', { name: 'BANTRYX' }).waitFor({ timeout: 10_000 });
    await shot(page, '01-landing');

    // Click into the auth grid and shot the register form.
    await dismissLanding(page);
    await page.locator('#register-username').waitFor({ timeout: 5000 });
    await page.locator('#register-username').fill('alex_morgan');
    await page.locator('#register-email').fill('alex.morgan@example.com');
    await page.locator('#register-password').fill('MyStrongPass123!');
    await page.locator('#register-password-confirm').fill('MyStrongPass123!');
    await page.locator('#register-confirm-age').check();
    await page.locator('#register-accept-terms').check();
    await shot(page, '02-register-form');
  });

  test('02 — calendar + games', async ({ page }) => {
    await loginMobile(page, { username: USERS.alex.username, password: PASSWORD });
    // Default Games view.
    await page.getByRole('heading', { name: 'Games' }).first().waitFor({ timeout: 10_000 });
    await shot(page, '03-games-calendar');
  });

  test('03 — make a pick', async ({ page }) => {
    await loginMobile(page, { username: USERS.alex.username, password: PASSWORD });
    await page.getByRole('heading', { name: 'Games' }).first().waitFor({ timeout: 10_000 });
    // Today view shows Arsenal (no pick) + Liverpool (locked) + Brighton
    // (24:00 — but backdated below to yesterday). Scroll to find Arsenal.
    await page
      .getByText(/Arsenal/i)
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => {});
    await page.waitForTimeout(300);
    await shot(page, '04-pick-buttons');

    // Click "Pick Arsenal to win" on the Arsenal vs Chelsea card.
    const pickArsenal = page.getByRole('button', { name: /^Pick Arsenal to win/ }).first();
    await pickArsenal.waitFor({ state: 'visible', timeout: 5000 });
    await pickArsenal.click();
    // Wait for the locked-pick chip to appear so we shot the post-pick state.
    await page
      .getByText(/You picked Arsenal/i)
      .first()
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, '05-pick-locked');
  });

  test('04 — see a result', async ({ page }) => {
    await loginMobile(page, { username: USERS.alex.username, password: PASSWORD });
    // Navigate to yesterday's date via ?date= URL param. Calendar's
    // useState reads ?date= on mount and pre-shifts the windowIndex if needed,
    // so the chip + the day's games render together.
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yesterdayDate = localDateString(y);
    await page.goto(`/?date=${yesterdayDate}`);
    await page.getByRole('heading', { name: 'Games' }).first().waitFor({ timeout: 10_000 });
    // Brighton card should be visible — it's the scored game with alex's
    // locked winning pick.
    await page
      .getByText(/Brighton/i)
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => {});
    await page.waitForTimeout(300);
    await shot(page, '06-result-card');

    // Open the notification bell to show the pick-scored notification.
    const bell = page.getByRole('button', { name: /Notifications/i }).first();
    await bell.waitFor({ state: 'visible', timeout: 5000 });
    await bell.click();
    await page.waitForTimeout(400);
    await shot(page, '07-notifications', { fullPage: false });
    await page.keyboard.press('Escape').catch(() => {});
  });

  test('05 — leaderboard', async ({ page }) => {
    await loginMobile(page, { username: USERS.alex.username, password: PASSWORD });
    await openSidebarTab(page, /Leaderboards Rankings/);
    await page
      .getByRole('heading', { name: /Overall Leaderboard|Rankings/i })
      .first()
      .waitFor({ timeout: 10_000 });
    await shot(page, '08-leaderboard');
  });

  test('06 — groups: create + discover + invites', async ({ page }) => {
    await loginMobile(page, { username: USERS.alex.username, password: PASSWORD });
    await openSidebarTab(page, /Groups My Groups/);
    await page.getByRole('heading', { name: /Create a new group/i }).waitFor({ timeout: 10_000 });
    await shot(page, '09-groups-page');

    // Fill the Group name field cleanly. The previous selector also matched
    // the top-bar search input (placeholder includes "groups").
    const groupNameInput = page.getByPlaceholder('Group name').first();
    await groupNameInput.fill('Weekend Predictors').catch(() => {});
    await groupNameInput.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(200);
    await shot(page, '10-create-group-form', { fullPage: false });

    // Scroll down to Discover panel for the public-join shot.
    await page
      .getByText(/Discover public groups/i)
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => {});
    await page.waitForTimeout(200);
    await shot(page, '11-discover-groups', { fullPage: false });
  });

  test('07 — friends: search + add', async ({ page }) => {
    await loginMobile(page, { username: USERS.alex.username, password: PASSWORD });
    // Use the mobile search bar (row 3 of the top bar). Search for "riley".
    const input = page.locator('input[type="search"]').first();
    await input.click();
    await input.fill('riley');
    await page.waitForTimeout(600); // debounce + dropdown render
    await shot(page, '12-search-friend', { fullPage: false });
  });
});
