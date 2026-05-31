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
//
// Tier 30 Phase 3 A2 — expanded catalog. Adds: Hot Hand, Cold Plunge,
// Crystal Ball, Globetrotter, Roundsman, Loyalist, Margin Master,
// Centurion, Conversationalist, Friendly Five, Three's a Crowd,
// Streakmaster, Recruiter I/II/III. computeProgressForUser exposes
// per-metric current values for the frontend BadgeWall's progress bars.
// When a user has a `referredByUserId` and has any scored pick, evaluation
// also fans out to the referrer so their Recruiter tier advances at the
// moment their referee's first pick settles.
const { Op } = require('sequelize');
const { Badge, Pick, Game, User, Comment, Friendship, GroupMember } = require('../models');
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

// ISO week key in YYYY-WW (UTC). Used for the Loyalist metric.
function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Set d to the Thursday of the same week (ISO week starts Monday but
  // anchors on Thursday for year-boundary stability).
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-${String(weekNum).padStart(2, '0')}`;
}

function utcDayKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Computes the metric values that drive the badge progress bars.
// Returns null when the user doesn't exist. Shape matches the `metric`
// keys declared in BADGE_CATALOG.
async function computeProgressForUser(userId) {
  if (!userId) return null;
  const user = await User.findByPk(userId);
  if (!user) return null;

  const [picks, commentCount, friendCount, groupCount, referees] = await Promise.all([
    Pick.findAll({ where: { userId } }),
    Comment.count({ where: { userId } }),
    Friendship.count({
      where: {
        status: 'accepted',
        [Op.or]: [{ requesterId: userId }, { addresseeId: userId }],
      },
    }),
    GroupMember.count({ where: { userId } }),
    User.findAll({ where: { referredByUserId: userId }, attributes: ['id'] }),
  ]);

  const pickGameIds = picks.map((p) => p.gameId);
  const games =
    pickGameIds.length === 0 ? [] : await Game.findAll({ where: { id: { [Op.in]: pickGameIds } } });
  const gameById = new Map(games.map((g) => [g.id, g]));

  // Walk picks in chronological order to compute streak-style metrics.
  const sortedPicks = picks
    .map((p) => ({ pick: p, game: gameById.get(p.gameId) }))
    .filter((row) => row.game)
    .sort((a, b) => new Date(a.game.date) - new Date(b.game.date));

  let wins = 0;
  let scoredPicks = 0;
  let upsetWins = 0;
  let favoritesWon = 0;
  let consecutiveWins = 0;
  let consecutiveLosses = 0;
  let curWin = 0;
  let curLoss = 0;
  const leagueIds = new Set();
  const pickDays = new Set();
  const pickWeeks = new Set();

  for (const { pick, game } of sortedPicks) {
    if (game.leagueId) leagueIds.add(game.leagueId);
    const day = utcDayKey(new Date(game.date));
    pickDays.add(day);
    pickWeeks.add(isoWeekKey(new Date(game.date)));
    if (!game.result) continue;
    scoredPicks += 1;
    const isWin = pick.choice === game.result;
    const probability =
      pick.choice === 'home'
        ? parseFloat(game.homeProbability)
        : pick.choice === 'away'
          ? parseFloat(game.awayProbability)
          : NaN;
    if (isWin) {
      wins += 1;
      if (!Number.isNaN(probability) && probability < 0.4) upsetWins += 1;
      if (!Number.isNaN(probability) && probability >= 0.6) favoritesWon += 1;
      curWin += 1;
      curLoss = 0;
      if (curWin > consecutiveWins) consecutiveWins = curWin;
    } else {
      curLoss += 1;
      curWin = 0;
      if (curLoss > consecutiveLosses) consecutiveLosses = curLoss;
    }
  }

  // Referrals — count referees that have at least one SCORED pick. A
  // referee with only unsettled picks doesn't yet count toward the
  // Recruiter tier.
  let referrals = 0;
  if (referees.length > 0) {
    const refIds = referees.map((r) => r.id);
    const scoredRefPicks = await Pick.findAll({
      where: { userId: { [Op.in]: refIds } },
      include: [
        {
          model: Game,
          required: true,
          where: { result: { [Op.ne]: null } },
          attributes: [],
        },
      ],
      attributes: ['userId'],
    });
    const refsWithScored = new Set(scoredRefPicks.map((p) => p.userId));
    referrals = refsWithScored.size;
  }

  return {
    picks: picks.length,
    scoredPicks,
    wins,
    upsetWins,
    favoritesWon,
    consecutiveWins,
    consecutiveLosses,
    leagues: leagueIds.size,
    pickDays: pickDays.size,
    pickWeeks: pickWeeks.size,
    longestStreak: user.longestDailyStreak || 0,
    comments: commentCount,
    friends: friendCount,
    groups: groupCount,
    referrals,
    winRate: scoredPicks > 0 ? wins / scoredPicks : 0,
  };
}

async function evaluateBadges(userId, context = {}) {
  if (!userId) return;
  try {
    const earned = await Badge.findAll({ where: { userId } });
    const earnedSlugs = new Set(earned.map((b) => b.slug));
    const metrics = await computeProgressForUser(userId);
    if (!metrics) return;

    // Award helpers — encapsulate the "compute → threshold-check →
    // award if newly earned" sequence so each badge is one line below.
    const tryAward = async (slug, condition) => {
      if (!condition || earnedSlugs.has(slug)) return;
      await awardBadge(userId, slug);
      earnedSlugs.add(slug);
    };

    // Pick lifecycle
    await tryAward('first-pick', metrics.picks > 0);
    await tryAward('first-win', metrics.wins >= 1);
    await tryAward('correct-10', metrics.wins >= 10);
    await tryAward('correct-25', metrics.wins >= 25);
    await tryAward('correct-50', metrics.wins >= 50);
    await tryAward('centurion', metrics.picks >= 100);

    // Probability quality
    await tryAward('upset-specialist', metrics.upsetWins >= 5);
    await tryAward('margin-master', metrics.favoritesWon >= 10);

    // Streak-shape
    await tryAward('hot-hand', metrics.consecutiveWins >= 3);
    await tryAward('cold-plunge', metrics.consecutiveLosses >= 3);
    await tryAward('crystal-ball', metrics.scoredPicks >= 20 && metrics.winRate >= 0.75);

    // Breadth
    await tryAward('globetrotter', metrics.leagues >= 5);
    await tryAward('roundsman', metrics.pickDays >= 10);
    await tryAward('loyalist', metrics.pickWeeks >= 8);

    // Daily streak (Tier 30 Phase 3 A1)
    await tryAward('streakmaster', metrics.longestStreak >= 30);

    // Social
    await tryAward('conversationalist', metrics.comments >= 25);
    await tryAward('friendly-five', metrics.friends >= 5);
    await tryAward('threes-a-crowd', metrics.groups >= 3);

    // Referrals — Recruiter tier ladder
    await tryAward('recruiter-1', metrics.referrals >= 1);
    await tryAward('recruiter-2', metrics.referrals >= 5);
    await tryAward('recruiter-3', metrics.referrals >= 25);

    // Group founder via context (existing path)
    if (context.groupCreated && !earnedSlugs.has('group-founder')) {
      await awardBadge(userId, 'group-founder');
    }

    // Referrer re-evaluation — when this user has a scored pick, their
    // referrer's Recruiter tier may now be eligible to advance. Fire-and-
    // forget so a slow chain doesn't block the originating event. Bounded
    // at 1 level because evaluateBadges(referrer) only chains again if
    // the REFERRER also has a referrer (different user) — no recursion
    // back to the picker.
    const user = await User.findByPk(userId, { attributes: ['referredByUserId'] });
    if (user?.referredByUserId && metrics.scoredPicks > 0) {
      evaluateBadges(user.referredByUserId).catch((err) => {
        logger.warn(
          { err: err.message, refereeId: userId, referrerId: user.referredByUserId },
          'referrer badge evaluation failed',
        );
      });
    }
  } catch (error) {
    logger.warn({ err: error, userId }, 'badge evaluation failed');
  }
}

module.exports = { awardBadge, evaluateBadges, computeProgressForUser };
