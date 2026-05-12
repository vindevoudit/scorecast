require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { Op } = require('sequelize');

const { User, Group, Game, Pick, GroupMember, GroupInvite, Badge, Friendship, Comment, Notification, initDatabase } = require('./models');
const { validate } = require('./validation/middleware');
const {
  registerSchema,
  loginSchema,
  createGroupSchema,
  inviteSchema,
  pickSchema,
  resultSchema,
  friendRequestSchema,
  visibilitySchema,
  commentSchema,
} = require('./validation/schemas');
const { BADGE_CATALOG } = require('./badges/catalog');

const RAW_JWT_SECRET = process.env.JWT_SECRET;
if (!RAW_JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET env var is required in production');
  }
  console.warn('[scorecast] JWT_SECRET not set — using insecure dev fallback');
}
const JWT_SECRET = RAW_JWT_SECRET || 'scorecast-dev-only-do-not-use';
const PORT = process.env.PORT || 3000;

function createToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = req.cookies?.token || (authHeader && authHeader.split(' ')[1]);

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registrations from this IP, try again later' },
});

function scorePick(pick, game) {
  if (!game.result) return 0;
  const isWinningChoice = (pick.choice === 'home' && game.result === 'home') || (pick.choice === 'away' && game.result === 'away');
  if (!isWinningChoice) return 0;
  const probability = pick.choice === 'home' ? parseFloat(game.homeProbability) : parseFloat(game.awayProbability);
  return Math.round((1 - probability) * 100);
}

async function getUserById(id) {
  return User.findByPk(id);
}

async function getUserByUsername(username) {
  return User.findOne({ where: { username: { [Op.iLike]: username } } });
}

async function getJoinedGroupIds(userId) {
  const memberships = await GroupMember.findAll({ where: { userId } });
  return memberships.map((m) => m.groupId);
}

async function getPendingInvites(userId) {
  const user = await getUserById(userId);
  if (!user) return [];

  const invites = await GroupInvite.findAll({ where: { username: user.username } });
  const groups = await Group.findAll({ where: { id: invites.map((i) => i.groupId) } });
  
  return invites.map((invite) => {
    const group = groups.find((g) => g.id === invite.groupId);
    return {
      id: invite.id,
      groupId: invite.groupId,
      groupName: group?.name || 'Unknown Group',
      createdAt: invite.createdAt,
    };
  });
}

async function getGroupsForUser(userId) {
  const memberships = await GroupMember.findAll({ where: { userId } });
  const groupIds = memberships.map((m) => m.groupId);
  const groups = await Group.findAll({ where: { id: groupIds } });

  return Promise.all(groups.map(async (group) => {
    const members = await GroupMember.findAll({ where: { groupId: group.id } });
    const memberUsers = await User.findAll({ where: { id: members.map((m) => m.userId) } });
    const orderedMembers = members.map((m) => {
      const user = memberUsers.find((u) => u.id === m.userId);
      return { userId: m.userId, username: user?.username || 'Unknown' };
    });
    const invites = await GroupInvite.findAll({ where: { groupId: group.id } });
    return {
      id: group.id,
      name: group.name,
      ownerId: group.ownerId,
      visibility: group.visibility,
      members: orderedMembers,
      invites: invites.map((i) => ({ username: i.username, createdAt: i.createdAt })),
      createdAt: group.createdAt,
    };
  }));
}

async function getGroupById(groupId) {
  const group = await Group.findByPk(groupId);
  if (!group) return null;

  const members = await GroupMember.findAll({ where: { groupId } });
  const memberUsers = await User.findAll({ where: { id: members.map((m) => m.userId) } });
  const orderedMembers = members.map((m) => {
    const user = memberUsers.find((u) => u.id === m.userId);
    return { userId: m.userId, username: user?.username || 'Unknown' };
  });
  const invites = await GroupInvite.findAll({ where: { groupId } });

  return {
    id: group.id,
    name: group.name,
    ownerId: group.ownerId,
    members: orderedMembers,
    invites: invites.map((i) => ({ username: i.username, createdAt: i.createdAt })),
    createdAt: group.createdAt,
  };
}

async function buildUserSummary() {
  const users = await User.findAll();
  const picks = await Pick.findAll();
  const games = await Game.findAll();

  const userScores = {};
  users.forEach((user) => {
    userScores[user.id] = { userId: user.id, username: user.username, points: 0 };
  });

  picks.forEach((pick) => {
    const game = games.find((g) => g.id === pick.gameId);
    if (!game) return;
    userScores[pick.userId].points += scorePick(pick, game);
  });

  return Object.values(userScores).sort((a, b) => b.points - a.points);
}

async function notify(userId, type, title, body = null, link = null) {
  try {
    await Notification.create({ userId, type, title, body, link });
  } catch (error) {
    console.warn('[scorecast] failed to create notification:', error.message);
  }
}

async function awardBadge(userId, slug) {
  try {
    await Badge.create({ userId, slug });
    const meta = BADGE_CATALOG.find((b) => b.slug === slug);
    await notify(
      userId,
      'badge',
      `Badge earned: ${meta?.name || slug}`,
      meta?.description || null
    );
    return true;
  } catch (error) {
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
      const probability = pick.choice === 'home'
        ? parseFloat(game.homeProbability)
        : parseFloat(game.awayProbability);
      if (probability < 0.4) upsetWins += 1;
    }

    if (correctCount >= 1 && !earnedSlugs.has('first-win')) await awardBadge(userId, 'first-win');
    if (correctCount >= 10 && !earnedSlugs.has('correct-10')) await awardBadge(userId, 'correct-10');
    if (correctCount >= 25 && !earnedSlugs.has('correct-25')) await awardBadge(userId, 'correct-25');
    if (correctCount >= 50 && !earnedSlugs.has('correct-50')) await awardBadge(userId, 'correct-50');
    if (upsetWins >= 5 && !earnedSlugs.has('upset-specialist')) await awardBadge(userId, 'upset-specialist');

    if (context.groupCreated && !earnedSlugs.has('group-founder')) {
      await awardBadge(userId, 'group-founder');
    }
  } catch (error) {
    console.warn('[scorecast] badge evaluation failed:', error.message);
  }
}

async function getFriendshipBetween(userAId, userBId) {
  if (!userAId || !userBId || userAId === userBId) return null;
  return Friendship.findOne({
    where: {
      [Op.or]: [
        { requesterId: userAId, addresseeId: userBId },
        { requesterId: userBId, addresseeId: userAId },
      ],
    },
  });
}

function friendStatusFrom(friendship, viewerId, targetId) {
  if (viewerId === targetId) return 'self';
  if (!friendship) return 'none';
  if (friendship.status === 'accepted') return 'friends';
  if (friendship.requesterId === viewerId) return 'pending-out';
  return 'pending-in';
}

async function buildGroupLeaderboard(groupId) {
  const group = await Group.findByPk(groupId);
  if (!group) return [];

  const members = await GroupMember.findAll({ where: { groupId } });
  const memberIds = members.map((m) => m.userId);
  const memberUsers = await User.findAll({ where: { id: memberIds } });
  const picks = await Pick.findAll({ where: { userId: memberIds } });
  const games = await Game.findAll();

  return memberIds
    .map((memberId) => {
      const user = memberUsers.find((u) => u.id === memberId);
      const points = picks
        .filter((pick) => pick.userId === memberId)
        .reduce((sum, pick) => {
          const game = games.find((g) => g.id === pick.gameId);
          return sum + (game ? scorePick(pick, game) : 0);
        }, 0);
      return { userId: memberId, username: user?.username || 'Unknown', points };
    })
    .sort((a, b) => b.points - a.points);
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'dist')));

app.post('/api/register', registerLimiter, validate(registerSchema), async (req, res) => {
  const { username, password } = req.body;

  const existingUser = await getUserByUsername(username);
  if (existingUser) {
    return res.status(400).json({ error: 'That username is already taken' });
  }

  try {
    const newUser = await User.create({ username, password });
    res.json({ token: createToken(newUser), user: { id: newUser.id, username: newUser.username } });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', loginLimiter, validate(loginSchema), async (req, res) => {
  const { username, password } = req.body;
  const user = await getUserByUsername(username);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  res.json({ token: createToken(user), user: { id: user.id, username: user.username } });
});

app.get('/api/me', authMiddleware, async (req, res) => {
  const user = await getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const joinedGroups = await getJoinedGroupIds(user.id);
  const pendingInvites = await getPendingInvites(user.id);
  res.json({ id: user.id, username: user.username, joinedGroups, pendingInvites });
});

app.get('/api/games', authMiddleware, async (req, res) => {
  try {
    const games = await Game.findAll({ order: [['date', 'ASC']] });
    res.json(games);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

app.get('/api/groups', authMiddleware, async (req, res) => {
  try {
    const groups = await getGroupsForUser(req.user.id);
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

app.get('/api/groups/discover', authMiddleware, async (req, res) => {
  try {
    const joinedIds = await getJoinedGroupIds(req.user.id);
    const publicGroups = await Group.findAll({
      where: {
        visibility: 'public',
        id: { [Op.notIn]: joinedIds.length ? joinedIds : ['00000000-0000-0000-0000-000000000000'] },
      },
      limit: 20,
      order: [['createdAt', 'DESC']],
    });
    const groupIds = publicGroups.map((g) => g.id);
    const members = await GroupMember.findAll({ where: { groupId: groupIds } });
    const countByGroup = new Map();
    for (const m of members) {
      countByGroup.set(m.groupId, (countByGroup.get(m.groupId) || 0) + 1);
    }
    res.json(
      publicGroups.map((g) => ({
        id: g.id,
        name: g.name,
        ownerId: g.ownerId,
        visibility: g.visibility,
        memberCount: countByGroup.get(g.id) || 0,
        createdAt: g.createdAt,
      }))
    );
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch public groups' });
  }
});

app.get('/api/groups/:groupId', authMiddleware, async (req, res) => {
  try {
    const group = await getGroupById(req.params.groupId);
    if (!group || !group.members.some((m) => m.userId === req.user.id)) {
      return res.status(404).json({ error: 'Group not found or access denied' });
    }
    res.json(group);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch group' });
  }
});

app.post('/api/groups', authMiddleware, validate(createGroupSchema), async (req, res) => {
  const { name, visibility = 'private' } = req.body;

  try {
    const group = await Group.create({ name, ownerId: req.user.id, visibility });
    await GroupMember.create({ groupId: group.id, userId: req.user.id });
    const user = await getUserById(req.user.id);
    evaluateBadges(req.user.id, { groupCreated: true }).catch(() => {});
    res.json({
      id: group.id,
      name: group.name,
      ownerId: group.ownerId,
      visibility: group.visibility,
      members: [{ userId: req.user.id, username: user.username }],
      invites: [],
      createdAt: group.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create group' });
  }
});

app.post('/api/groups/:groupId/invite', authMiddleware, validate(inviteSchema), async (req, res) => {
  const { username } = req.body;

  try {
    const group = await Group.findByPk(req.params.groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const isMember = await GroupMember.findOne({
      where: { groupId: req.params.groupId, userId: req.user.id },
    });
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const invitedUser = await getUserByUsername(username);
    if (!invitedUser) {
      return res.status(400).json({ error: 'No user found with that username' });
    }

    const isAlreadyMember = await GroupMember.findOne({
      where: { groupId: req.params.groupId, userId: invitedUser.id },
    });
    if (isAlreadyMember) {
      return res.status(400).json({ error: 'User is already a member of this group' });
    }

    const existingInvite = await GroupInvite.findOne({
      where: { groupId: req.params.groupId, username: invitedUser.username },
    });
    if (existingInvite) {
      return res.status(400).json({ error: 'User has already been invited to this group' });
    }

    await GroupInvite.create({ groupId: req.params.groupId, username: invitedUser.username });
    notify(
      invitedUser.id,
      'invite',
      `You were invited to "${group.name}"`,
      `Open the Groups tab to accept or decline.`
    ).catch(() => {});
    const updatedGroup = await getGroupById(req.params.groupId);
    res.json({ success: true, group: updatedGroup });
  } catch (error) {
    res.status(500).json({ error: 'Failed to invite user' });
  }
});

app.post('/api/groups/:groupId/invite/:inviteId/accept', authMiddleware, async (req, res) => {
  try {
    const invite = await GroupInvite.findByPk(req.params.inviteId);
    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    const user = await getUserById(req.user.id);
    if (!user || user.username !== invite.username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const group = await Group.findByPk(req.params.groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const isAlreadyMember = await GroupMember.findOne({
      where: { groupId: req.params.groupId, userId: req.user.id },
    });
    if (!isAlreadyMember) {
      await GroupMember.create({ groupId: req.params.groupId, userId: req.user.id });
    }

    await GroupInvite.destroy({ where: { id: req.params.inviteId } });
    if (group.ownerId && group.ownerId !== req.user.id) {
      notify(
        group.ownerId,
        'group-join',
        `${user.username} joined "${group.name}"`
      ).catch(() => {});
    }
    const updatedGroup = await getGroupById(req.params.groupId);
    res.json({ success: true, group: updatedGroup });
  } catch (error) {
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

app.post('/api/groups/:groupId/invite/:inviteId/decline', authMiddleware, async (req, res) => {
  try {
    const invite = await GroupInvite.findByPk(req.params.inviteId);
    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    const user = await getUserById(req.user.id);
    if (!user || user.username !== invite.username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await GroupInvite.destroy({ where: { id: req.params.inviteId } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to decline invite' });
  }
});

app.post('/api/picks', authMiddleware, validate(pickSchema), async (req, res) => {
  const { gameId, choice } = req.body;

  try {
    const game = await Game.findByPk(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const gameDate = new Date(game.date);
    const now = new Date();
    if (game.result || gameDate <= now) {
      return res.status(400).json({ error: 'Picks can only be created or changed for upcoming games' });
    }

    const existingPick = await Pick.findOne({
      where: { userId: req.user.id, gameId },
    });

    if (existingPick) {
      existingPick.choice = choice;
      existingPick.submittedAt = new Date();
      await existingPick.save();
    } else {
      await Pick.create({ userId: req.user.id, gameId, choice });
    }

    evaluateBadges(req.user.id).catch(() => {});

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit pick' });
  }
});

app.get('/api/picks', authMiddleware, async (req, res) => {
  try {
    const picks = await Pick.findAll({ where: { userId: req.user.id } });
    res.json(picks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch picks' });
  }
});

app.get('/api/leaderboard', authMiddleware, async (req, res) => {
  try {
    const overall = await buildUserSummary();
    const groupId = req.query.groupId;
    const group = groupId ? await buildGroupLeaderboard(groupId) : [];
    res.json({ overall, group });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

app.post('/api/games/:gameId/result', authMiddleware, requireAdmin, validate(resultSchema), async (req, res) => {
  const { result } = req.body;

  try {
    const game = await Game.findByPk(req.params.gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    game.result = result;
    await game.save();

    if (result) {
      const picksForGame = await Pick.findAll({ where: { gameId: req.params.gameId } });
      for (const pick of picksForGame) {
        const points = scorePick(pick, game);
        const isWin = pick.choice === result;
        const title = isWin
          ? `Your pick on ${game.homeTeam} vs ${game.awayTeam}: ✓ Correct +${points} pts`
          : `Your pick on ${game.homeTeam} vs ${game.awayTeam}: ✗ Missed`;
        notify(pick.userId, 'pick-scored', title).catch(() => {});
        evaluateBadges(pick.userId).catch(() => {});
      }
    }

    res.json({ success: true, game });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update game result' });
  }
});

app.get('/api/users/:username/profile', authMiddleware, async (req, res) => {
  try {
    const targetUser = await getUserByUsername(req.params.username);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [userPicks, allGames, badges] = await Promise.all([
      Pick.findAll({ where: { userId: targetUser.id } }),
      Game.findAll(),
      Badge.findAll({ where: { userId: targetUser.id } }),
    ]);

    const gameById = new Map(allGames.map((g) => [g.id, g]));
    let totalPoints = 0;
    let picksWon = 0;
    let picksScored = 0;
    for (const pick of userPicks) {
      const game = gameById.get(pick.gameId);
      if (!game) continue;
      if (game.result) {
        picksScored += 1;
        const pts = scorePick(pick, game);
        totalPoints += pts;
        if (pick.choice === game.result) picksWon += 1;
      }
    }
    const picksMade = userPicks.length;
    const winRate = picksScored > 0 ? picksWon / picksScored : 0;

    const recentPicks = [...userPicks]
      .map((pick) => ({ pick, game: gameById.get(pick.gameId) }))
      .filter((row) => row.game)
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

    const friendship = await getFriendshipBetween(req.user.id, targetUser.id);
    const friendStatus = friendStatusFrom(friendship, req.user.id, targetUser.id);

    let headToHead = null;
    if (friendStatus === 'friends') {
      const viewerPicks = await Pick.findAll({ where: { userId: req.user.id } });
      const viewerByGame = new Map(viewerPicks.map((p) => [p.gameId, p]));
      let viewerWins = 0;
      let targetWins = 0;
      let ties = 0;
      for (const pick of userPicks) {
        const game = gameById.get(pick.gameId);
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

    res.json({
      id: targetUser.id,
      username: targetUser.username,
      role: targetUser.role,
      joinedAt: targetUser.createdAt,
      totalPoints,
      picksMade,
      picksWon,
      picksScored,
      winRate,
      badges: badges.map((b) => ({ slug: b.slug, awardedAt: b.awardedAt })),
      catalog: BADGE_CATALOG,
      recentPicks,
      friendship: friendship ? { id: friendship.id, status: friendship.status } : null,
      friendStatus,
      headToHead,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

app.post('/api/friends/request', authMiddleware, validate(friendRequestSchema), async (req, res) => {
  try {
    const target = await getUserByUsername(req.body.username);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot friend yourself' });

    const existing = await getFriendshipBetween(req.user.id, target.id);
    if (existing) {
      if (existing.status === 'accepted') return res.status(400).json({ error: 'Already friends' });
      return res.status(400).json({ error: 'Friend request already pending' });
    }

    const friendship = await Friendship.create({
      requesterId: req.user.id,
      addresseeId: target.id,
      status: 'pending',
    });
    const requester = await getUserById(req.user.id);
    notify(
      target.id,
      'friend-request',
      `${requester.username} sent you a friend request`,
      'Open Groups → Friends to accept or decline.'
    ).catch(() => {});
    res.json({ success: true, friendship });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send friend request' });
  }
});

app.post('/api/friends/:id/accept', authMiddleware, async (req, res) => {
  try {
    const friendship = await Friendship.findByPk(req.params.id);
    if (!friendship) return res.status(404).json({ error: 'Friend request not found' });
    if (friendship.addresseeId !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    if (friendship.status !== 'pending') return res.status(400).json({ error: 'Already accepted' });

    friendship.status = 'accepted';
    friendship.acceptedAt = new Date();
    await friendship.save();

    const accepter = await getUserById(req.user.id);
    notify(
      friendship.requesterId,
      'friend-request',
      `${accepter.username} accepted your friend request`
    ).catch(() => {});

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to accept friend request' });
  }
});

app.post('/api/friends/:id/decline', authMiddleware, async (req, res) => {
  try {
    const friendship = await Friendship.findByPk(req.params.id);
    if (!friendship) return res.status(404).json({ error: 'Friend request not found' });
    if (friendship.addresseeId !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    await friendship.destroy();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to decline friend request' });
  }
});

app.delete('/api/friends/:id', authMiddleware, async (req, res) => {
  try {
    const friendship = await Friendship.findByPk(req.params.id);
    if (!friendship) return res.status(404).json({ error: 'Friendship not found' });
    if (friendship.requesterId !== req.user.id && friendship.addresseeId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await friendship.destroy();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

app.get('/api/friends', authMiddleware, async (req, res) => {
  try {
    const rows = await Friendship.findAll({
      where: {
        [Op.or]: [{ requesterId: req.user.id }, { addresseeId: req.user.id }],
      },
    });
    const userIds = new Set();
    for (const row of rows) {
      userIds.add(row.requesterId);
      userIds.add(row.addresseeId);
    }
    const users = await User.findAll({ where: { id: [...userIds] } });
    const userById = new Map(users.map((u) => [u.id, u]));

    const friends = [];
    const incoming = [];
    const outgoing = [];
    for (const row of rows) {
      const otherId = row.requesterId === req.user.id ? row.addresseeId : row.requesterId;
      const other = userById.get(otherId);
      const entry = {
        id: row.id,
        userId: otherId,
        username: other?.username || 'Unknown',
        createdAt: row.createdAt,
      };
      if (row.status === 'accepted') friends.push(entry);
      else if (row.addresseeId === req.user.id) incoming.push(entry);
      else outgoing.push(entry);
    }
    res.json({ friends, incoming, outgoing });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

app.post('/api/groups/:groupId/join', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.visibility !== 'public') return res.status(403).json({ error: 'This group is private' });

    const existing = await GroupMember.findOne({
      where: { groupId: group.id, userId: req.user.id },
    });
    if (existing) return res.status(400).json({ error: 'Already a member' });

    await GroupMember.create({ groupId: group.id, userId: req.user.id });
    const joiner = await getUserById(req.user.id);
    if (group.ownerId !== req.user.id) {
      notify(
        group.ownerId,
        'group-join',
        `${joiner.username} joined "${group.name}"`
      ).catch(() => {});
    }
    const updated = await getGroupById(group.id);
    res.json({ success: true, group: updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to join group' });
  }
});

app.post('/api/groups/:groupId/visibility', authMiddleware, validate(visibilitySchema), async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.ownerId !== req.user.id) return res.status(403).json({ error: 'Only the owner can change visibility' });
    group.visibility = req.body.visibility;
    await group.save();
    res.json({ success: true, visibility: group.visibility });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update visibility' });
  }
});

app.get('/api/games/:gameId/comments', authMiddleware, async (req, res) => {
  try {
    const comments = await Comment.findAll({
      where: { gameId: req.params.gameId },
      order: [['createdAt', 'DESC']],
      limit: 50,
    });
    const userIds = [...new Set(comments.map((c) => c.userId))];
    const users = await User.findAll({ where: { id: userIds } });
    const userById = new Map(users.map((u) => [u.id, u]));
    res.json(
      comments.map((c) => ({
        id: c.id,
        gameId: c.gameId,
        userId: c.userId,
        username: userById.get(c.userId)?.username || 'Unknown',
        body: c.body,
        createdAt: c.createdAt,
      }))
    );
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

app.post('/api/games/:gameId/comments', authMiddleware, validate(commentSchema), async (req, res) => {
  try {
    const game = await Game.findByPk(req.params.gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    const comment = await Comment.create({
      gameId: req.params.gameId,
      userId: req.user.id,
      body: req.body.body,
    });
    const user = await getUserById(req.user.id);
    res.json({
      id: comment.id,
      gameId: comment.gameId,
      userId: comment.userId,
      username: user.username,
      body: comment.body,
      createdAt: comment.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

app.delete('/api/comments/:id', authMiddleware, async (req, res) => {
  try {
    const comment = await Comment.findByPk(req.params.id);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    await comment.destroy();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

app.get('/api/notifications', authMiddleware, async (req, res) => {
  try {
    const unreadOnly = req.query.unreadOnly === 'true';
    const where = { userId: req.user.id };
    if (unreadOnly) where.read = false;
    const items = await Notification.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 50,
    });
    const unreadCount = await Notification.count({ where: { userId: req.user.id, read: false } });
    res.json({ items, unreadCount });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.post('/api/notifications/:id/read', authMiddleware, async (req, res) => {
  try {
    const notification = await Notification.findByPk(req.params.id);
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    if (notification.userId !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    notification.read = true;
    await notification.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark notification' });
  }
});

app.post('/api/notifications/read-all', authMiddleware, async (req, res) => {
  try {
    await Notification.update({ read: true }, { where: { userId: req.user.id, read: false } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark notifications' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

(async () => {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`ScoreCast server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
})();
