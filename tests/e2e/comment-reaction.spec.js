'use strict';

const { test, expect } = require('@playwright/test');
const { loginViaUI } = require('./helpers/auth');
const { closestCard } = require('./helpers/selectors');
const { USERS, GAMES } = require('./fixtures/data');

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
