'use strict';

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/auth');
const { selectGameDate } = require('./helpers/games');
const { closestCard } = require('./helpers/selectors');
const { clearPicksAndBadges } = require('./helpers/api');
const { USERS, GAMES } = require('./fixtures/data');

// Lazy model access (mirrors the getModels pattern in helpers/api.js +
// admin-panel.spec.js): require env first so DATABASE_URL is set before the
// Sequelize singleton connects, then reuse the shared instance.
let _models = null;
function getModels() {
  if (_models) return _models;
  require('./fixtures/env');
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
  _models = require('../../models');
  return _models;
}

// Phase 0 verification — under full-suite load a prior spec can leave the
// Eagles fixture in a state that hides the "Pick X to win" button: a result
// set, its date moved off the visible calendar window, or even a delete. The
// old reset only cleared the result, which wasn't enough (the game would be
// missing from its expected day entirely). upsert it back to the canonical
// fixture state — right date, scheduled, no result — so this spec is
// self-sufficient regardless of what ran before it; then clear alice's picks
// so the card shows the pick button rather than an existing pick.
test.beforeAll(async () => {
  const { Game } = getModels();
  await Game.upsert({ ...GAMES.eagles, status: 'scheduled', result: null });
  await clearPicksAndBadges([USERS.alice.id]);
});

// 5.5.5 — Comment + reaction: post → edit → react → delete.
test('comment thread: alice posts, edits, reacts, deletes', async ({ browser }) => {
  // Use a different fixture game from pick-and-result.spec.js so suites don't
  // entangle if both run.
  const game = GAMES.eagles;
  const stamp = Date.now().toString(36);
  const originalBody = `E2E comment ${stamp}`;
  const editedBody = `E2E comment edited ${stamp}`;

  const context = await browser.newContext();
  const page = await context.newPage();
  await loginViaUI(page, USERS.alice);
  // GamesCalendar defaults to today; the Eagles fixture sits at today+2,
  // so snap the chip to its date before hunting for the pick button.
  await selectGameDate(page, game);

  // Wait for the games list to be hydrated.
  const pickButton = page.getByRole('button', {
    name: `Pick ${game.homeTeam} to win`,
    exact: true,
  });
  await expect(pickButton).toBeVisible();

  // Locate the GameCard via the pick button anchor.
  const gameCard = closestCard(pickButton);
  await expect(gameCard).toHaveCount(1);

  // CommentThread starts collapsed — toggle it open.
  const showComments = gameCard.getByRole('button', { name: /Show comments/ });
  await expect(showComments).toBeVisible();
  await showComments.click();

  // Post a comment.
  await gameCard.getByPlaceholder('Add some banter…').fill(originalBody);
  await gameCard.getByRole('button', { name: 'Post', exact: true }).click();

  // Alice has exactly one comment in this test, so scoping by her username
  // is stable across the post → edit → react → delete cycle. Filtering by
  // body text would stop matching during edit mode, because the body moves
  // into a <textarea value> (which isn't part of an element's text content).
  const commentRow = page.locator('li').filter({ hasText: USERS.alice.username });
  await expect(commentRow).toBeVisible({ timeout: 10_000 });
  await expect(commentRow).toContainText(originalBody);

  // --- Edit the comment. ---
  await commentRow.getByRole('button', { name: 'Edit', exact: true }).click();
  await commentRow.getByRole('textbox').fill(editedBody);
  await commentRow.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(commentRow).toContainText(editedBody, { timeout: 10_000 });
  await expect(commentRow.getByText('(edited)')).toBeVisible();

  // --- React with 👍. ---
  // Reaction buttons render as "👍" alone (count hidden) when count is 0,
  // and "👍 1" once a reaction lands.
  const thumbsButton = commentRow.getByRole('button', { name: /^👍/ });
  await thumbsButton.click();
  await expect(thumbsButton).toContainText('1', { timeout: 10_000 });

  // --- Delete the comment. ---
  await commentRow.getByRole('button', { name: 'Delete', exact: true }).click();
  // No confirm modal for comment delete — it's a direct remove.
  await expect(commentRow).toHaveCount(0, { timeout: 10_000 });

  await context.close();
});
