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
  commentSchema,
} = require('../validation/schemas');
const { authMiddleware } = require('../middleware/auth');
const { optionalAuth } = require('../middleware/optionalAuth');
const { publicReadLimiter, commentLimiter } = require('../middleware/rateLimit');
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
    });
    res.json(created);
  }),
);

router.post(
  '/groups/:groupId/invite',
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
    const visibility = await GroupService.setVisibility({
      groupId: req.params.groupId,
      requesterId: req.user.id,
      visibility: req.body.visibility,
    });
    res.json({ success: true, visibility });
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
