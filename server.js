require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');

const { User, Group, Game, Pick, GroupMember, GroupInvite, initDatabase } = require('./models');

const JWT_SECRET = process.env.JWT_SECRET || 'scorecast-demo-secret-2026';
const PORT = process.env.PORT || 3001;

function createToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
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

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

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

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await getUserByUsername(username);

  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  res.json({ token: createToken(user), user: { id: user.id, username: user.username } });
});

app.get('/api/me', authMiddleware, async (req, res) => {
  const user = await getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const joinedGroups = await getJoinedGroupIds(user.id);
  res.json({ id: user.id, username: user.username, joinedGroups });
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

app.post('/api/groups', authMiddleware, async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  try {
    const group = await Group.create({ name, ownerId: req.user.id });
    await GroupMember.create({ groupId: group.id, userId: req.user.id });
    const user = await getUserById(req.user.id);
    res.json({
      id: group.id,
      name: group.name,
      ownerId: group.ownerId,
      members: [{ userId: req.user.id, username: user.username }],
      invites: [],
      createdAt: group.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create group' });
  }
});

app.post('/api/groups/:groupId/invite', authMiddleware, async (req, res) => {
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

    await GroupMember.create({ groupId: req.params.groupId, userId: invitedUser.id });
    const updatedGroup = await getGroupById(req.params.groupId);
    res.json({ success: true, group: updatedGroup });
  } catch (error) {
    res.status(500).json({ error: 'Failed to invite user' });
  }
});

app.post('/api/picks', authMiddleware, async (req, res) => {
  const { gameId, choice } = req.body;
  if (!gameId || !choice || !['home', 'away'].includes(choice)) {
    return res.status(400).json({ error: 'Valid gameId and choice are required' });
  }

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

app.post('/api/games/:gameId/result', authMiddleware, async (req, res) => {
  const { result } = req.body;
  if (result !== null && !['home', 'away'].includes(result)) {
    return res.status(400).json({ error: 'Result must be home, away, or null' });
  }

  try {
    const game = await Game.findByPk(req.params.gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    game.result = result;
    await game.save();
    res.json({ success: true, game });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update game result' });
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
