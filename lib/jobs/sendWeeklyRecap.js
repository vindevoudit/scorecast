'use strict';

// Tier 30 Phase 3 A5 — Post-match weekly recap cron.
//
// Fires Mondays at 02:00 UTC. For every user with at least one pick whose
// game was scored in the trailing 7-day window, computes a per-user
// weekly summary (scored picks, wins, points) and dispatches ONE
// `weekly-recap` push notification with the recap framed as a one-line
// summary. The push and the in-app bell row carry the recap text in the
// body — the deep-link routes the user to their Profile view where the
// recent picks list naturally shows what happened.
//
// Why scoped to "picks whose game was SCORED this week": that's the
// engagement frame the user understands ("how I did"). Picks made this
// week on games that haven't settled yet aren't in the recap — they'll
// land in next week's recap when they score.
//
// Idempotency: relies on the cron firing once per week. A manual restart
// that lands on Monday morning would double-send; not worth a
// `lastWeeklyRecapAt` column for the v1.
//
// Cost gate: count() short-circuit before any per-user work. If the
// trailing window has zero scored picks (deep off-season), the job
// returns instantly without scanning the users table.

const { Op } = require('sequelize');
const { Pick, Game, User, GroupMember, UserScore } = require('../../models');
const NotificationService = require('../../services/NotificationService');
const logger = require('../logger');

// Pure function — given a flat list of {points, won} rows for a single
// user's scored picks within the recap window, return the aggregate
// totals. Exposed for unit testing.
function aggregateWeeklyStats(rows) {
  let scored = 0;
  let wins = 0;
  let points = 0;
  for (const r of rows) {
    scored += 1;
    points += r.points || 0;
    if (r.won) wins += 1;
  }
  return { scored, wins, points };
}

// Pure function — given the aggregate totals + optional flair pieces,
// return the notification title + body strings. Exposed for unit testing.
function formatRecap({ scored, wins, points, leagueFlair, groupFlair }) {
  const title = 'Your week on Bantryx';
  const sign = points >= 0 ? '+' : '';
  const recordLine = `You went ${wins}/${scored} this week, ${sign}${points} pts.`;
  const flairs = [leagueFlair, groupFlair].filter(Boolean);
  const body = flairs.length > 0 ? `${recordLine} ${flairs.join(' · ')}` : recordLine;
  return { title, body };
}

// Compute "top X%" of N members given a rank (1 = best). Returns the
// rounded-up percentile so a #2 of 10 lands at "top 20%" (2/10 = 20).
// Caller filters out cases where the user doesn't belong to the scope.
function topPercent(rank, total) {
  if (!total || total < 2 || !rank) return null;
  return Math.max(1, Math.ceil((rank / total) * 100));
}

async function run({ now = new Date() } = {}) {
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Cost gate — bail out if nothing scored this week.
  const scoredThisWeek = await Pick.count({
    include: [
      {
        model: Game,
        required: true,
        attributes: [],
        where: {
          result: { [Op.ne]: null },
          date: { [Op.gte]: windowStart, [Op.lt]: windowEnd },
        },
      },
    ],
  });
  if (scoredThisWeek === 0) {
    return { processed: 0, skipped: 'no-scored-picks-this-week' };
  }

  // Pull every scored pick in the window, joined with its game. One bulk
  // query feeds the per-user aggregation below.
  const picks = await Pick.findAll({
    where: {
      // Filter on `appliedResult` so picks that have been scored via the
      // Tier 24 dual-writer are captured — equivalent to game.result IS
      // NOT NULL but cheaper because the column is already indexed for
      // the parity log path.
      appliedResult: { [Op.ne]: null },
    },
    include: [
      {
        model: Game,
        required: true,
        attributes: ['id', 'date', 'result', 'homeTeam', 'awayTeam', 'leagueId'],
        where: {
          result: { [Op.ne]: null },
          date: { [Op.gte]: windowStart, [Op.lt]: windowEnd },
        },
      },
    ],
  });

  // Bucket by userId. Each row carries the pick's points (already
  // computed + stamped by the dual-writer) and a "won" flag.
  const byUser = new Map();
  for (const p of picks) {
    const game = p.Game;
    const won = p.choice === game.result;
    const arr = byUser.get(p.userId) || [];
    arr.push({
      points: p.appliedPoints || 0,
      won,
      leagueId: game.leagueId,
    });
    byUser.set(p.userId, arr);
  }

  if (byUser.size === 0) {
    return { processed: 0 };
  }

  // Resolve users + their group memberships in bulk so the per-user loop
  // doesn't fire N round-trips.
  const userIds = [...byUser.keys()];
  const users = await User.findAll({
    where: { id: { [Op.in]: userIds } },
    attributes: ['id', 'username'],
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  // Group memberships — every group each recap user belongs to.
  const memberships = await GroupMember.findAll({
    where: { userId: { [Op.in]: userIds } },
    attributes: ['userId', 'groupId'],
  });
  const groupsByUser = new Map();
  for (const m of memberships) {
    const arr = groupsByUser.get(m.userId) || [];
    arr.push(m.groupId);
    groupsByUser.set(m.userId, arr);
  }

  let sent = 0;
  for (const userId of userIds) {
    const user = userById.get(userId);
    if (!user) continue;

    const rows = byUser.get(userId) || [];
    const stats = aggregateWeeklyStats(rows);

    // League flair — when the user has scored picks in EXACTLY one
    // league this week, surface their rank within that league. Multi-
    // league weeks skip it (the message would otherwise need to pick a
    // "primary" which feels arbitrary).
    const leagueIds = new Set(rows.map((r) => r.leagueId).filter(Boolean));
    let leagueFlair = null;
    if (leagueIds.size === 1) {
      const leagueId = [...leagueIds][0];
      const allInLeague = await UserScore.findAll({
        where: { leagueId },
        attributes: ['userId', 'points'],
        order: [['points', 'DESC']],
      });
      const rank = allInLeague.findIndex((r) => r.userId === userId) + 1;
      const total = allInLeague.length;
      const pct = topPercent(rank, total);
      if (pct) leagueFlair = `Top ${pct}% in this league.`;
    }

    // Group flair — pick the user's most-populated group (largest
    // member count). Skipped when the user is in no groups.
    let groupFlair = null;
    const groupIds = groupsByUser.get(userId) || [];
    if (groupIds.length > 0) {
      // Find the largest group the user belongs to.
      const counts = await GroupMember.findAll({
        where: { groupId: { [Op.in]: groupIds } },
        attributes: ['groupId', [GroupMember.sequelize.fn('COUNT', '*'), 'memberCount']],
        group: ['groupId'],
        raw: true,
      });
      if (counts.length > 0) {
        counts.sort((a, b) => parseInt(b.memberCount, 10) - parseInt(a.memberCount, 10));
        const largestId = counts[0].groupId;
        const groupMembers = await GroupMember.findAll({
          where: { groupId: largestId },
          attributes: ['userId'],
        });
        const memberIds = groupMembers.map((gm) => gm.userId);
        if (memberIds.length >= 2) {
          const groupScores = await UserScore.findAll({
            where: { userId: { [Op.in]: memberIds } },
            attributes: ['userId', 'points'],
          });
          const totalsByMember = new Map(memberIds.map((id) => [id, 0]));
          for (const s of groupScores) {
            totalsByMember.set(s.userId, (totalsByMember.get(s.userId) || 0) + (s.points || 0));
          }
          const sorted = [...totalsByMember.entries()].sort((a, b) => b[1] - a[1]);
          const rank = sorted.findIndex(([uid]) => uid === userId) + 1;
          const pct = topPercent(rank, sorted.length);
          if (pct) groupFlair = `Top ${pct}% in your group.`;
        }
      }
    }

    const { title, body } = formatRecap({
      scored: stats.scored,
      wins: stats.wins,
      points: stats.points,
      leagueFlair,
      groupFlair,
    });

    NotificationService.notify(userId, 'weekly-recap', title, body, '/?view=profile').catch(
      (err) => {
        logger.warn({ err: err.message, userId }, 'sendWeeklyRecap: notify failed');
      },
    );
    sent += 1;
  }

  logger.info({ processed: sent, scoredThisWeek }, 'sendWeeklyRecap: dispatched weekly recaps');
  return { processed: sent, scoredThisWeek };
}

module.exports = {
  run,
  // Exposed for unit tests.
  aggregateWeeklyStats,
  formatRecap,
  topPercent,
};
