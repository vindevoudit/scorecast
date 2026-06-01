'use strict';

// Tier 13 Chunk 2 — CommentService. Read + write operations against Comment
// and CommentReaction. ALLOWED_EMOJIS in validation/schemas.js is the source
// of truth for the reaction palette (CLAUDE.md invariant: REACTION_EMOJIS
// in CommentThread.jsx must stay in sync).
// Tier 18 Chunk 5 — list + create accept either a `gameId` OR a `groupId`
// scope. The DB CHECK constraint guarantees exactly one is set; service
// callers assert the same so we never round-trip a half-formed scope to
// Postgres. Group-scoped creates fan out a `group-comment` notification
// to every other group member.
const { Comment, CommentReaction, GroupMember, User, Game, Group } = require('../models');
const { ALLOWED_EMOJIS } = require('../validation/schemas');
const errors = require('../lib/errors');
const { getUserById } = require('../lib/users');
const { formatGroupLabel } = require('../lib/groupLabel');
const NotificationService = require('./NotificationService');

function assertSingleScope({ gameId, groupId }) {
  const haveGame = Boolean(gameId);
  const haveGroup = Boolean(groupId);
  if (haveGame === haveGroup) {
    // Both set or both missing — programmer error, surface a 400 so a
    // bad client/test path gets a recognizable response shape.
    throw errors.badRequest('Comment must be scoped to exactly one of gameId or groupId');
  }
}

async function list({ gameId, groupId }, viewerId, { limit = 50 } = {}) {
  assertSingleScope({ gameId, groupId });
  const where = gameId ? { gameId } : { groupId };
  const comments = await Comment.findAll({
    where,
    order: [['createdAt', 'DESC']],
    limit,
  });
  const commentIds = comments.map((c) => c.id);
  const userIds = [...new Set(comments.map((c) => c.userId))];
  const [users, reactions] = await Promise.all([
    User.findAll({ where: { id: userIds } }),
    commentIds.length
      ? CommentReaction.findAll({ where: { commentId: commentIds } })
      : Promise.resolve([]),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const countsByComment = new Map();
  const yourByComment = new Map();
  for (const r of reactions) {
    if (!countsByComment.has(r.commentId)) countsByComment.set(r.commentId, {});
    const counts = countsByComment.get(r.commentId);
    counts[r.emoji] = (counts[r.emoji] || 0) + 1;
    if (r.userId === viewerId) {
      if (!yourByComment.has(r.commentId)) yourByComment.set(r.commentId, []);
      yourByComment.get(r.commentId).push(r.emoji);
    }
  }
  return comments.map((c) => ({
    id: c.id,
    gameId: c.gameId,
    groupId: c.groupId,
    userId: c.userId,
    username: userById.get(c.userId)?.username || 'Unknown',
    body: c.body,
    createdAt: c.createdAt,
    editedAt: c.editedAt || null,
    reactionCounts: countsByComment.get(c.id) || {},
    yourReactions: yourByComment.get(c.id) || [],
  }));
}

// Tier 18 Chunk 5 — fan out a `group-comment` push/bell notification to
// every group member EXCEPT the author. Best-effort: notify() itself is
// never-throws, and we wrap the loop in a try/catch so a notification
// outage can't break the comment create. Title carries the author +
// group name; body is the comment text (capped at 160 chars to keep
// push payloads small). Link deep-links to the group view — picked up
// by Chunk 6's notification-click consumer.
//
// P1-5 — bounded concurrency. Naive Promise.all(recipients.map(notify))
// fired N parallel DB INSERTs + N web-push sends regardless of N. At
// MAX_GROUP_MEMBERS=2000 (Tier 22 M4) that's a pool-starvation hazard
// on the 20-slot Sequelize pool (Tier 25 A1) and a thundering herd on
// the Web Push transport. The 8-at-a-time worker pool below preserves
// the fire-and-forget timing the caller sees (the function still
// resolves only when every notification has been attempted) while
// bounding parallel notify() calls so other request handlers and cron
// jobs aren't pool-starved.
const FANOUT_CONCURRENCY = 8;

async function fanOutGroupComment({ comment, author, group }) {
  try {
    const members = await GroupMember.findAll({ where: { groupId: group.id } });
    const recipients = members.map((m) => m.userId).filter((id) => id !== author.id);
    if (recipients.length === 0) return;
    const title = `${author.username} commented in ${formatGroupLabel(group)}`;
    const body = comment.body.length > 160 ? `${comment.body.slice(0, 157).trim()}…` : comment.body;
    const link = `/?view=groups&groupId=${group.id}`;
    // Worker-pool fan-out: spin up CONCURRENCY parallel "drainers" that
    // each pull the next userId off a shared cursor until the list is
    // empty. notify() never throws (NotificationService swallows per-
    // recipient failures internally), so no try/catch needed inside the
    // drainer loop.
    let cursor = 0;
    const drainer = async () => {
      while (cursor < recipients.length) {
        const idx = cursor;
        cursor += 1;
        await NotificationService.notify(recipients[idx], 'group-comment', title, body, link);
      }
    };
    const workers = Array.from(
      { length: Math.min(FANOUT_CONCURRENCY, recipients.length) },
      drainer,
    );
    await Promise.all(workers);
  } catch (_err) {
    // Notification fan-out is best-effort — swallow so the comment
    // create still resolves cleanly. NotificationService.notify already
    // logs per-recipient failures internally.
  }
}

async function create({ gameId, groupId, userId, body }) {
  assertSingleScope({ gameId, groupId });

  // Game scope: existence check (matches the old behavior).
  if (gameId) {
    const game = await Game.findByPk(gameId);
    if (!game) throw errors.notFound('Game not found');
  }

  // Group scope: load the group + verify the author is a member. Owner
  // counts (owner is automatically a member via the GroupMember row
  // created in GroupService.createGroup). Non-members get 403 even on
  // public groups — write is member-only by design.
  let group = null;
  if (groupId) {
    group = await Group.findByPk(groupId);
    if (!group) throw errors.notFound('Group not found');
    const membership = await GroupMember.findOne({ where: { groupId, userId } });
    if (!membership) throw errors.forbidden('Only group members can post comments');
  }

  const comment = await Comment.create({ gameId, groupId, userId, body });
  const user = await getUserById(userId);

  // Group fan-out runs OUTSIDE any wrapping transaction (none here, but
  // matches the Tier 5.3 invariant) — so a downstream rollback can't
  // leave behind ghost notifications.
  if (group) {
    fanOutGroupComment({ comment, author: user, group }).catch(() => {});
  }

  return {
    id: comment.id,
    gameId: comment.gameId,
    groupId: comment.groupId,
    userId: comment.userId,
    username: user.username,
    body: comment.body,
    createdAt: comment.createdAt,
    editedAt: null,
    reactionCounts: {},
    yourReactions: [],
  };
}

// Tier 22 H3 — for group-scoped comments, verify the editor is still a
// member. Without this, a user who leaves the group can still rewrite
// their own history inside it, defeating the membership gate that create()
// enforces on the write side.
async function assertStillMember(comment, userId) {
  if (!comment.groupId) return;
  const membership = await GroupMember.findOne({
    where: { groupId: comment.groupId, userId },
  });
  if (!membership) throw errors.forbidden('Not a group member');
}

async function edit({ commentId, userId, body }) {
  const comment = await Comment.findByPk(commentId);
  if (!comment) throw errors.notFound('Comment not found');
  if (comment.userId !== userId) throw errors.forbidden();
  await assertStillMember(comment, userId);
  comment.body = body;
  comment.editedAt = new Date();
  await comment.save();
  return { id: comment.id, body: comment.body, editedAt: comment.editedAt };
}

async function remove({ commentId, viewer }) {
  const comment = await Comment.findByPk(commentId);
  if (!comment) throw errors.notFound('Comment not found');
  if (comment.userId !== viewer.id && viewer.role !== 'admin') {
    throw errors.forbidden();
  }
  // Admins always can; otherwise apply the same still-member gate. (An admin
  // who has left a group can still moderate a comment in it — admin scope
  // outranks group membership.)
  if (viewer.role !== 'admin') {
    await assertStillMember(comment, viewer.id);
  }
  await CommentReaction.destroy({ where: { commentId: comment.id } });
  await comment.destroy();
}

async function react({ commentId, userId, emoji }) {
  const comment = await Comment.findByPk(commentId);
  if (!comment) throw errors.notFound('Comment not found');
  try {
    await CommentReaction.create({ commentId: comment.id, userId, emoji });
  } catch (_e) {
    // Unique constraint — already reacted with this emoji; treat as no-op success.
  }
}

async function unreact({ commentId, userId, emoji }) {
  if (!ALLOWED_EMOJIS.includes(emoji)) throw errors.badRequest('Invalid emoji');
  await CommentReaction.destroy({ where: { commentId, userId, emoji } });
}

module.exports = {
  list,
  create,
  edit,
  remove,
  react,
  unreact,
  // Tier 18 Chunk 5 — kept as a thin shim so any external caller that
  // imported the old signature keeps working. Internal code paths
  // (routes/games.js) have been updated to call list() directly.
  listForGame: (gameId, viewerId, opts) => list({ gameId }, viewerId, opts),
};
