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
} = require('../validation/schemas');
const { authMiddleware } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const GroupService = require('../services/GroupService');
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
  authMiddleware,
  asyncHandler(async (req, res) => {
    res.json(await GroupService.discoverPublic(req.user.id));
  }),
);

router.get(
  '/groups/:groupId',
  authMiddleware,
  asyncHandler(async (req, res) => {
    res.json(await GroupService.getVisible(req.params.groupId, req.user.id));
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

module.exports = router;
