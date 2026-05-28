'use strict';

// Tier 13 Chunk 2 — group routes delegate to GroupService. /groups/discover
// MUST be declared before /groups/:groupId so Express doesn't treat
// "discover" as a path param (CLAUDE.md invariant).
const express = require('express');
const { validate } = require('../validation/middleware');
const {
  createGroupSchema,
  inviteSchema,
  transferOwnerSchema,
  visibilitySchema,
  setGroupPasswordSchema,
  joinWithPasswordSchema,
  joinRequestSchema,
  commentSchema,
} = require('../validation/schemas');
const { authMiddleware } = require('../middleware/auth');
const { optionalAuth } = require('../middleware/optionalAuth');
const {
  publicReadLimiter,
  commentLimiter,
  groupJoinPasswordLimiter,
  inviteLimiter,
} = require('../middleware/rateLimit');
const asyncHandler = require('../middleware/asyncHandler');
const GroupService = require('../services/GroupService');
const CommentService = require('../services/CommentService');
const { Group, GroupMember } = require('../models');
const errors = require('../lib/errors');
const { getGroupsForUser } = require('../lib/groups');

const router = express.Router();

router.get(
  '/groups',
  authMiddleware,
  asyncHandler(async (req, res) => {
    res.json(await getGroupsForUser(req.user.id));
  }),
);

// MUST come before /groups/:groupId — CLAUDE.md invariant.
router.get(
  '/groups/discover',
  publicReadLimiter,
  optionalAuth,
  asyncHandler(async (req, res) => {
    res.json(await GroupService.discoverPublic(req.user?.id ?? null));
  }),
);

router.get(
  '/groups/:groupId',
  publicReadLimiter,
  optionalAuth,
  asyncHandler(async (req, res) => {
    res.json(await GroupService.getVisible(req.params.groupId, req.user?.id ?? null));
  }),
);

router.post(
  '/groups',
  authMiddleware,
  validate(createGroupSchema),
  asyncHandler(async (req, res) => {
    const created = await GroupService.createGroup({
      ownerId: req.user.id,
      name: req.body.name,
      visibility: req.body.visibility,
      // Tier 19 Chunk 1 — optional plaintext password (server hashes).
      // Schema's refine() guarantees it's only set when visibility==='private'.
      password: req.body.password || null,
    });
    res.json(created);
  }),
);

router.post(
  '/groups/:groupId/invite',
  inviteLimiter,
  authMiddleware,
  validate(inviteSchema),
  asyncHandler(async (req, res) => {
    const group = await GroupService.invite({
      groupId: req.params.groupId,
      inviterId: req.user.id,
      username: req.body.username,
    });
    res.json({ success: true, group });
  }),
);

router.post(
  '/groups/:groupId/invite/:inviteId/accept',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const group = await GroupService.acceptInvite({
      groupId: req.params.groupId,
      inviteId: req.params.inviteId,
      userId: req.user.id,
    });
    res.json({ success: true, group });
  }),
);

router.post(
  '/groups/:groupId/invite/:inviteId/decline',
  authMiddleware,
  asyncHandler(async (req, res) => {
    await GroupService.declineInvite({ inviteId: req.params.inviteId, userId: req.user.id });
    res.json({ success: true });
  }),
);

router.post(
  '/groups/:groupId/join',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const group = await GroupService.joinPublic({
      groupId: req.params.groupId,
      userId: req.user.id,
    });
    res.json({ success: true, group });
  }),
);

router.post(
  '/groups/:groupId/leave',
  authMiddleware,
  asyncHandler(async (req, res) => {
    await GroupService.leave({ groupId: req.params.groupId, userId: req.user.id });
    res.json({ success: true });
  }),
);

router.post(
  '/groups/:groupId/transfer',
  authMiddleware,
  validate(transferOwnerSchema),
  asyncHandler(async (req, res) => {
    const group = await GroupService.transferOwnership({
      groupId: req.params.groupId,
      currentOwnerId: req.user.id,
      newOwnerId: req.body.newOwnerId,
    });
    res.json({ success: true, group });
  }),
);

router.delete(
  '/groups/:groupId',
  authMiddleware,
  asyncHandler(async (req, res) => {
    await GroupService.deleteGroup({ groupId: req.params.groupId, requesterId: req.user.id });
    res.json({ success: true });
  }),
);

router.post(
  '/groups/:groupId/visibility',
  authMiddleware,
  validate(visibilitySchema),
  asyncHandler(async (req, res) => {
    const result = await GroupService.setVisibility({
      groupId: req.params.groupId,
      requesterId: req.user.id,
      visibility: req.body.visibility,
      password: req.body.password || null,
    });
    res.json({ success: true, ...result });
  }),
);

// Tier 19 Chunk 1 — password-protected join. Per-user rate limited at
// `groupJoinPasswordLimiter` to deter brute force (bcrypt is constant-time
// but slow enough that an attacker would still want to throttle).
router.post(
  '/groups/:groupId/join-with-password',
  groupJoinPasswordLimiter,
  authMiddleware,
  validate(joinWithPasswordSchema),
  asyncHandler(async (req, res) => {
    const group = await GroupService.joinWithPassword({
      groupId: req.params.groupId,
      userId: req.user.id,
      password: req.body.password,
    });
    res.json({ success: true, group });
  }),
);

router.put(
  '/groups/:groupId/password',
  authMiddleware,
  validate(setGroupPasswordSchema),
  asyncHandler(async (req, res) => {
    const result = await GroupService.setPassword({
      groupId: req.params.groupId,
      requesterId: req.user.id,
      password: req.body.password,
    });
    res.json({ success: true, ...result });
  }),
);

// Tier 19 Chunk 3 — request-to-join CRUD. POST creates, GET lists (owner),
// approve/decline are owner-only, DELETE cancels (requester only).
router.post(
  '/groups/:groupId/join-request',
  authMiddleware,
  validate(joinRequestSchema),
  asyncHandler(async (req, res) => {
    const created = await GroupService.requestToJoin({
      groupId: req.params.groupId,
      requesterId: req.user.id,
      message: req.body.message || null,
    });
    res.json({ success: true, request: created });
  }),
);

router.get(
  '/groups/:groupId/join-requests',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const items = await GroupService.listJoinRequests({
      groupId: req.params.groupId,
      requesterId: req.user.id,
    });
    res.json({ items });
  }),
);

router.post(
  '/groups/:groupId/join-requests/:requestId/approve',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const group = await GroupService.approveJoinRequest({
      groupId: req.params.groupId,
      requestId: req.params.requestId,
      ownerId: req.user.id,
    });
    res.json({ success: true, group });
  }),
);

router.post(
  '/groups/:groupId/join-requests/:requestId/decline',
  authMiddleware,
  asyncHandler(async (req, res) => {
    await GroupService.declineJoinRequest({
      groupId: req.params.groupId,
      requestId: req.params.requestId,
      ownerId: req.user.id,
    });
    res.json({ success: true });
  }),
);

router.delete(
  '/groups/:groupId/join-requests/:requestId',
  authMiddleware,
  asyncHandler(async (req, res) => {
    await GroupService.cancelJoinRequest({
      groupId: req.params.groupId,
      requestId: req.params.requestId,
      requesterId: req.user.id,
    });
    res.json({ success: true });
  }),
);

// Tier 18 Chunk 5 — group running comments. Read access mirrors
// /api/groups/:groupId visibility (anon may read PUBLIC group comments;
// PRIVATE requires membership). Writes are always member-only (and CSRF
// + auth gated by the middleware stack), regardless of group visibility.
//
// 404 (not 403) for the private-non-member case so the existence of the
// group isn't leaked — same contract as GET /api/groups/:groupId itself.
async function assertReadable(groupId, viewerId) {
  const group = await Group.findByPk(groupId);
  if (!group) throw errors.notFound('Group not found');
  if (group.visibility === 'public') return group;
  // Private group: must be a member to read.
  if (!viewerId) throw errors.notFound('Group not found');
  const membership = await GroupMember.findOne({ where: { groupId, userId: viewerId } });
  if (!membership) throw errors.notFound('Group not found');
  return group;
}

router.get(
  '/groups/:groupId/comments',
  publicReadLimiter,
  optionalAuth,
  asyncHandler(async (req, res) => {
    await assertReadable(req.params.groupId, req.user?.id ?? null);
    const comments = await CommentService.list(
      { groupId: req.params.groupId },
      req.user?.id ?? null,
    );
    res.json(comments);
  }),
);

router.post(
  '/groups/:groupId/comments',
  commentLimiter,
  authMiddleware,
  validate(commentSchema),
  asyncHandler(async (req, res) => {
    // CommentService.create itself enforces membership (returns 403 for
    // non-members), so the route stays a thin shim. No assertReadable
    // call here — the visibility gate is irrelevant for writes, only
    // membership matters.
    const comment = await CommentService.create({
      groupId: req.params.groupId,
      userId: req.user.id,
      body: req.body.body,
    });
    res.json(comment);
  }),
);

module.exports = router;
