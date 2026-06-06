'use strict';

// Tier 13 Chunk 2 — UserService. Owns the cascade delete for users (with
// the Tier 5.3 transaction wrap) plus admin user list / role flip / bulk
// ops. Auth-cookie lifecycle stays in lib/auth.js + AuthService.
//
// Tier 8.6 — also owns getProfileByUsername, which gates the profile
// payload behind users.profileVisibility (public / friends / private).
const { Op } = require('sequelize');
const {
  User,
  Group,
  Pick,
  Game,
  Comment,
  CommentReaction,
  Friendship,
  GroupMember,
  GroupInvite,
  Badge,
  Notification,
  EmailVerificationToken,
  PasswordResetToken,
  RefreshToken,
  PushSubscription,
  UserScore,
  UserScoreOverall,
  sequelize,
} = require('../models');
const errors = require('../lib/errors');
const { scorePick } = require('../lib/scoring');
const { getUserByUsername } = require('../lib/users');
const { getFriendshipBetween, friendStatusFrom } = require('../lib/friends');
const { BADGE_CATALOG } = require('../badges/catalog');
const BadgeService = require('./BadgeService');
const LeaderboardService = require('./LeaderboardService');

// Returns true when `viewer` (may be null for anonymous) is allowed to see
// the target's full profile. Same-shape 404 for friends-gated-out and
// private so the friend graph isn't inferable from the response code.
async function canViewProfile(target, viewer) {
  if (viewer?.role === 'admin') return true;
  if (viewer?.id === target.id) return true;
  if (target.profileVisibility === 'public') return true;
  if (target.profileVisibility === 'friends' && viewer?.id) {
    const friendship = await getFriendshipBetween(viewer.id, target.id);
    return friendStatusFrom(friendship, viewer.id, target.id) === 'friends';
  }
  return false;
}

async function getProfileByUsername({ username, viewer }) {
  const target = await getUserByUsername(username);
  if (!target) throw errors.notFound('User not found');

  if (!(await canViewProfile(target, viewer))) {
    // Same shape as "not found" so the existence of a non-public user can't
    // be probed via response codes.
    throw errors.notFound('User not found');
  }

  // Phase 0 P0-3 — read the materialized totals from user_scores_overall
  // (Tier 24 dual-writer keeps this row in sync on every score-affecting
  // mutation). Fall back to the on-the-fly aggregate when the row is
  // missing (legacy users with all picks pre-dating the migration whose
  // backfill hasn't run yet). picksMade still comes from a Pick.count
  // because the materialized table only tracks SCORED picks.
  const [overallRow, picksMade, badges] = await Promise.all([
    UserScoreOverall.findOne({ where: { userId: target.id } }),
    Pick.count({ where: { userId: target.id } }),
    Badge.findAll({ where: { userId: target.id } }),
  ]);

  let totalPoints = 0;
  let picksWon = 0;
  let picksScored = 0;
  let usedMaterialized = false;
  if (overallRow) {
    totalPoints = overallRow.points;
    picksScored = overallRow.picksScored;
    picksWon = overallRow.picksWon;
    usedMaterialized = true;
  }

  // Fetch the 10 most recent picks server-side. Narrow Game.findAll to
  // ONLY the games these picks point at instead of the previous full-
  // table scan. (Previously Game.findAll() loaded every game in the
  // database — fine in beta with a few thousand rows, scary at launch
  // with multi-league multi-season state.)
  //
  // Pick model has `timestamps: false` — order by `submittedAt` (the
  // pick's own timestamp column), NOT `createdAt` which doesn't exist.
  const recentPickRows = await Pick.findAll({
    where: { userId: target.id },
    order: [['submittedAt', 'DESC']],
    limit: 50, // wide net so we can drop picks whose game vanished
  });
  const pickGameIds = [...new Set(recentPickRows.map((p) => p.gameId))];
  const recentGames =
    pickGameIds.length > 0 ? await Game.findAll({ where: { id: { [Op.in]: pickGameIds } } }) : [];
  const recentGameById = new Map(recentGames.map((g) => [g.id, g]));
  // Anti-bias gate (mirrors GameService.listGames' crowd gate +
  // PickService.listFriendsPicks): another user must NOT see this user's
  // picks before kickoff — it would telegraph the pick and bias the viewer.
  // Self-view (and only self) keeps upcoming picks visible. A game has
  // kicked off once status != 'scheduled' OR the wall-clock kickoff passed.
  const isSelf = Boolean(viewer?.id && viewer.id === target.id);
  const profileNow = new Date();
  const recentPicks = recentPickRows
    .map((pick) => ({ pick, game: recentGameById.get(pick.gameId) }))
    .filter((row) => row.game)
    .filter(
      (row) => isSelf || row.game.status !== 'scheduled' || new Date(row.game.date) <= profileNow,
    )
    .sort((a, b) => new Date(b.game.date) - new Date(a.game.date))
    .slice(0, 10)
    .map(({ pick, game }) => ({
      gameId: game.id,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      date: game.date,
      result: game.result,
      choice: pick.choice,
      points: scorePick(pick, game),
    }));

  // Fallback path: no materialized row → recompute from full pick set.
  // Same math as the legacy code, just behind the if so the common case
  // skips loading every game in the DB.
  if (!usedMaterialized) {
    const allUserPicks = await Pick.findAll({ where: { userId: target.id } });
    const allPickGameIds = [...new Set(allUserPicks.map((p) => p.gameId))];
    const allRelevantGames =
      allPickGameIds.length > 0
        ? await Game.findAll({ where: { id: { [Op.in]: allPickGameIds } } })
        : [];
    const allGameById = new Map(allRelevantGames.map((g) => [g.id, g]));
    for (const pick of allUserPicks) {
      const game = allGameById.get(pick.gameId);
      if (!game) continue;
      if (game.result) {
        picksScored += 1;
        totalPoints += scorePick(pick, game);
        if (pick.choice === game.result) picksWon += 1;
      }
    }
  }
  const winRate = picksScored > 0 ? picksWon / picksScored : 0;

  // Anonymous viewers don't have friendship or head-to-head data.
  let friendship = null;
  let friendStatus = null;
  let headToHead = null;
  if (viewer?.id) {
    friendship = await getFriendshipBetween(viewer.id, target.id);
    friendStatus = friendStatusFrom(friendship, viewer.id, target.id);
    if (friendStatus === 'friends') {
      // Phase 0 P0-3 — H2H now joins on the intersection of the two
      // users' picks instead of loading every game in the DB. Pull each
      // user's picks, find shared gameIds, then a single targeted
      // Game.findAll for just those rows.
      const [targetPicks, viewerPicks] = await Promise.all([
        Pick.findAll({ where: { userId: target.id } }),
        Pick.findAll({ where: { userId: viewer.id } }),
      ]);
      const viewerByGame = new Map(viewerPicks.map((p) => [p.gameId, p]));
      const sharedGameIds = targetPicks.map((p) => p.gameId).filter((gid) => viewerByGame.has(gid));
      const sharedGames =
        sharedGameIds.length > 0
          ? await Game.findAll({ where: { id: { [Op.in]: sharedGameIds } } })
          : [];
      const sharedGameById = new Map(sharedGames.map((g) => [g.id, g]));
      let viewerWins = 0;
      let targetWins = 0;
      let ties = 0;
      for (const pick of targetPicks) {
        const game = sharedGameById.get(pick.gameId);
        if (!game || !game.result) continue;
        const viewerPick = viewerByGame.get(pick.gameId);
        if (!viewerPick) continue;
        const viewerPts = scorePick(viewerPick, game);
        const targetPts = scorePick(pick, game);
        if (viewerPts > targetPts) viewerWins += 1;
        else if (targetPts > viewerPts) targetWins += 1;
        else ties += 1;
      }
      headToHead = { viewerWins, targetWins, ties };
    }
  }

  // Tier 30 Phase 3 A2 — badge progress is computed only when the viewer
  // is the target (self-view). Showing other users' progress bars would
  // leak the granular pick/win counts behind the public profile. Earned
  // badges + catalog are always returned so spectators see the locked
  // tiles without progress metadata.
  let badgeProgress = null;
  if (viewer?.id && viewer.id === target.id) {
    badgeProgress = await BadgeService.computeProgressForUser(target.id);
  }

  return {
    id: target.id,
    username: target.username,
    role: target.role,
    displayName: target.displayName || null,
    bio: target.bio || null,
    profileVisibility: target.profileVisibility,
    joinedAt: target.createdAt,
    totalPoints,
    picksMade,
    picksWon,
    picksScored,
    winRate,
    // Tier 30 Phase 3 A1 Revision — surface the persisted win-streak so
    // ProfileView's Overview can render a "Best streak" tile alongside
    // the existing 4-stat grid. Same field shape as GET /api/me.
    streak: {
      current: target.currentWinStreak || 0,
      longest: target.longestWinStreak || 0,
    },
    badges: badges.map((b) => ({ slug: b.slug, awardedAt: b.awardedAt })),
    catalog: BADGE_CATALOG,
    badgeProgress,
    recentPicks,
    friendship: friendship ? { id: friendship.id, status: friendship.status } : null,
    friendStatus,
    headToHead,
  };
}

async function cascadeDelete(target, { transaction } = {}) {
  const opts = transaction ? { transaction } : {};

  // Owned groups: tear down their members + invites first.
  const ownedGroups = await Group.findAll({ where: { ownerId: target.id }, ...opts });
  const ownedGroupIds = ownedGroups.map((g) => g.id);
  if (ownedGroupIds.length > 0) {
    await GroupMember.destroy({ where: { groupId: ownedGroupIds }, ...opts });
    await GroupInvite.destroy({ where: { groupId: ownedGroupIds }, ...opts });
    await Group.destroy({ where: { id: ownedGroupIds }, ...opts });
  }

  // Reactions on the user's own comments must go before the comments
  // themselves (the comment_reactions → comments FK isn't cascading).
  const ownedComments = await Comment.findAll({
    where: { userId: target.id },
    attributes: ['id'],
    ...opts,
  });
  const ownedCommentIds = ownedComments.map((c) => c.id);
  if (ownedCommentIds.length > 0) {
    await CommentReaction.destroy({ where: { commentId: ownedCommentIds }, ...opts });
  }

  // The user's reactions on other people's comments.
  await CommentReaction.destroy({ where: { userId: target.id }, ...opts });

  await Pick.destroy({ where: { userId: target.id }, ...opts });
  await Comment.destroy({ where: { userId: target.id }, ...opts });
  await Friendship.destroy({
    where: { [Op.or]: [{ requesterId: target.id }, { addresseeId: target.id }] },
    ...opts,
  });
  await GroupMember.destroy({ where: { userId: target.id }, ...opts });
  await GroupInvite.destroy({ where: { username: target.username }, ...opts });

  // Tier 6 token tables + notifications + badges. These were created via
  // `sequelize.sync()` on the original deploy, so their FKs to users(id)
  // were never given ON DELETE CASCADE (the migrations declared it but
  // CREATE TABLE IF NOT EXISTS no-op'd against the synced tables). Until a
  // fix-up migration runs, we destroy these rows explicitly.
  await Notification.destroy({ where: { userId: target.id }, ...opts });
  await Badge.destroy({ where: { userId: target.id }, ...opts });
  await EmailVerificationToken.destroy({ where: { userId: target.id }, ...opts });
  await PasswordResetToken.destroy({ where: { userId: target.id }, ...opts });
  await RefreshToken.destroy({ where: { userId: target.id }, ...opts });
  // PWA Chunk 4 — push_subscriptions table was created via a real migration
  // with ON DELETE CASCADE, so this destroy is belt-and-suspenders. Keeping
  // the explicit destroy keeps the cascade path symmetrical with the rest of
  // the user-owned rows and survives any future sync()-vs-migration ordering
  // changes.
  await PushSubscription.destroy({ where: { userId: target.id }, ...opts });

  // Tier 24 — explicit destroy mirrors the pattern above. The migration
  // declares ON DELETE CASCADE on the userId FK, so the cascade would fire
  // automatically — but a documented prod-DB gotcha (CLAUDE.md "Cascade-
  // delete fix-up (post-Tier 11)") is that `sync({alter:false})` running
  // ahead of migrations can leave the synced FK in a different state than
  // the migrated one. Doing the destroy explicitly inside the transaction
  // means a future ordering surprise can't break user delete.
  await UserScore.destroy({ where: { userId: target.id }, ...opts });
  await UserScoreOverall.destroy({ where: { userId: target.id }, ...opts });

  await target.destroy(opts);
}

async function listAdminSummary() {
  const users = await User.findAll({ order: [['createdAt', 'ASC']] });
  const userIds = users.map((u) => u.id);
  const picks = await Pick.findAll({ where: { userId: userIds } });
  const memberships = await GroupMember.findAll({ where: { userId: userIds } });
  const picksByUser = new Map();
  for (const p of picks) picksByUser.set(p.userId, (picksByUser.get(p.userId) || 0) + 1);
  const groupsByUser = new Map();
  for (const m of memberships) groupsByUser.set(m.userId, (groupsByUser.get(m.userId) || 0) + 1);
  return users.map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    createdAt: u.createdAt,
    picksCount: picksByUser.get(u.id) || 0,
    groupsCount: groupsByUser.get(u.id) || 0,
  }));
}

async function setRole({ targetId, requesterId, role }) {
  if (targetId === requesterId && role !== 'admin') {
    throw errors.badRequest('You cannot demote yourself');
  }
  const target = await User.findByPk(targetId);
  if (!target) throw errors.notFound('User not found');
  target.role = role;
  await target.save({ hooks: false });
  return target.role;
}

async function deleteUserById({ targetId, requesterId }) {
  if (targetId === requesterId) throw errors.badRequest('You cannot delete yourself');
  const target = await User.findByPk(targetId);
  if (!target) throw errors.notFound('User not found');
  await sequelize.transaction(async (t) => {
    await cascadeDelete(target, { transaction: t });
  });
  LeaderboardService.invalidate('all');
}

// Bulk admin user actions. CLAUDE.md invariant: the caller's own id is
// filtered and returned in `skipped:[{id,reason:'self'}]` rather than
// erroring the whole batch. Tier 5.3: one transaction per entity so a single
// bad row doesn't undo the rest.
async function bulkAction({ ids, action, requesterId }) {
  const skipped = [];
  const affected = [];
  const filteredIds = ids.filter((id) => {
    if (id === requesterId) {
      skipped.push({ id, reason: 'self' });
      return false;
    }
    return true;
  });
  const users = await User.findAll({ where: { id: filteredIds } });
  for (const target of users) {
    if (action === 'promote') {
      target.role = 'admin';
      await target.save({ hooks: false });
      affected.push(target.id);
    } else if (action === 'demote') {
      target.role = 'user';
      await target.save({ hooks: false });
      affected.push(target.id);
    } else if (action === 'delete') {
      await sequelize.transaction(async (t) => {
        await cascadeDelete(target, { transaction: t });
      });
      affected.push(target.id);
    }
  }
  if (affected.length > 0 && action === 'delete') LeaderboardService.invalidate('all');
  return { affected, skipped };
}

module.exports = {
  cascadeDelete,
  listAdminSummary,
  setRole,
  deleteUserById,
  bulkAction,
  canViewProfile,
  getProfileByUsername,
};
