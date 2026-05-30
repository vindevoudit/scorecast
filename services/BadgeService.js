'use strict';

// Tier 13 Chunk 2 — BadgeService. Evaluates the badge catalog against a
// user's current pick history and awards anything newly earned. Failures are
// logged and swallowed (badges are best-effort, never block the surrounding
// request flow).
//
// CLAUDE.md invariant: any code path that sets a result, creates a pick,
// creates a group, or accepts an invite must call evaluateBadges() + notify().
// Tier 5.3 invariant: evaluate runs OUTSIDE the surrounding transaction
// because notify() fires inside the awardBadge path.
const { Badge, Pick, Game } = require('../models');
const { BADGE_CATALOG } = require('../badges/catalog');
const logger = require('../lib/logger');
const NotificationService = require('./NotificationService');

async function awardBadge(userId, slug) {
  try {
    await Badge.create({ userId, slug });
    const meta = BADGE_CATALOG.find((b) => b.slug === slug);
    // Tier 30 Phase 1 — deep-link straight to the Badges sub-tab so the
    // unlocked badge is on-screen the moment the user clicks. SubTabs
    // reads `?tab=` on mount; an unknown value would fall back to
    // ProfileView's `defaultValue='overview'`, so the link is safe even
    // on a pre-Phase-1 client.
    await NotificationService.notify(
      userId,
      'badge',
      `Badge earned: ${meta?.name || slug}`,
      meta?.description || null,
      '/?view=profile&tab=badges',
    );
    return true;
  } catch (_error) {
    return false;
  }
}

async function evaluateBadges(userId, context = {}) {
  if (!userId) return;
  try {
    const earned = await Badge.findAll({ where: { userId } });
    const earnedSlugs = new Set(earned.map((b) => b.slug));

    const userPicks = await Pick.findAll({ where: { userId } });
    if (userPicks.length > 0 && !earnedSlugs.has('first-pick')) {
      await awardBadge(userId, 'first-pick');
    }

    const games = await Game.findAll();
    const gameById = new Map(games.map((g) => [g.id, g]));

    let correctCount = 0;
    let upsetWins = 0;
    for (const pick of userPicks) {
      const game = gameById.get(pick.gameId);
      if (!game || !game.result) continue;
      const isWin = pick.choice === game.result;
      if (!isWin) continue;
      correctCount += 1;
      const probability =
        pick.choice === 'home'
          ? parseFloat(game.homeProbability)
          : parseFloat(game.awayProbability);
      if (probability < 0.4) upsetWins += 1;
    }

    if (correctCount >= 1 && !earnedSlugs.has('first-win')) await awardBadge(userId, 'first-win');
    if (correctCount >= 10 && !earnedSlugs.has('correct-10'))
      await awardBadge(userId, 'correct-10');
    if (correctCount >= 25 && !earnedSlugs.has('correct-25'))
      await awardBadge(userId, 'correct-25');
    if (correctCount >= 50 && !earnedSlugs.has('correct-50'))
      await awardBadge(userId, 'correct-50');
    if (upsetWins >= 5 && !earnedSlugs.has('upset-specialist'))
      await awardBadge(userId, 'upset-specialist');

    if (context.groupCreated && !earnedSlugs.has('group-founder')) {
      await awardBadge(userId, 'group-founder');
    }
  } catch (error) {
    logger.warn({ err: error, userId }, 'badge evaluation failed');
  }
}

module.exports = { awardBadge, evaluateBadges };
