'use strict';

// Tier 13 Chunk 2 — CommentService. Read + write operations against Comment
// and CommentReaction. ALLOWED_EMOJIS in validation/schemas.js is the source
// of truth for the reaction palette (CLAUDE.md invariant: REACTION_EMOJIS
// in CommentThread.jsx must stay in sync).
const { Comment, CommentReaction, User, Game } = require('../models');
const { ALLOWED_EMOJIS } = require('../validation/schemas');
const errors = require('../lib/errors');
const { getUserById } = require('../lib/users');

async function listForGame(gameId, viewerId, { limit = 50 } = {}) {
  const comments = await Comment.findAll({
    where: { gameId },
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
    userId: c.userId,
    username: userById.get(c.userId)?.username || 'Unknown',
    body: c.body,
    createdAt: c.createdAt,
    editedAt: c.editedAt || null,
    reactionCounts: countsByComment.get(c.id) || {},
    yourReactions: yourByComment.get(c.id) || [],
  }));
}

async function create({ gameId, userId, body }) {
  const game = await Game.findByPk(gameId);
  if (!game) throw errors.notFound('Game not found');

  const comment = await Comment.create({ gameId, userId, body });
  const user = await getUserById(userId);
  return {
    id: comment.id,
    gameId: comment.gameId,
    userId: comment.userId,
    username: user.username,
    body: comment.body,
    createdAt: comment.createdAt,
    editedAt: null,
    reactionCounts: {},
    yourReactions: [],
  };
}

async function edit({ commentId, userId, body }) {
  const comment = await Comment.findByPk(commentId);
  if (!comment) throw errors.notFound('Comment not found');
  if (comment.userId !== userId) throw errors.forbidden();
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

module.exports = { listForGame, create, edit, remove, react, unreact };
