require('dotenv').config();
const { Sequelize } = require('sequelize');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$/;

// Initialize Sequelize
const sequelize = new Sequelize(process.env.DATABASE_URL || {
  host: 'localhost',
  database: 'scorecast_db',
  username: 'postgres',
  password: 'postgres',
  dialect: 'postgres',
});

// Import models
const User = require('./User')(sequelize);
const Group = require('./Group')(sequelize);
const Game = require('./Game')(sequelize);
const Pick = require('./Pick')(sequelize);
const GroupMember = require('./GroupMember')(sequelize);
const GroupInvite = require('./GroupInvite')(sequelize);
const Badge = require('./Badge')(sequelize);
const Friendship = require('./Friendship')(sequelize);
const Comment = require('./Comment')(sequelize);
const Notification = require('./Notification')(sequelize);

// Define associations
User.hasMany(Pick, { foreignKey: 'userId', as: 'picks' });
Pick.belongsTo(User, { foreignKey: 'userId' });

Game.hasMany(Pick, { foreignKey: 'gameId', as: 'picks' });
Pick.belongsTo(Game, { foreignKey: 'gameId' });

Group.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });
User.hasMany(Group, { foreignKey: 'ownerId', as: 'ownedGroups' });

Group.hasMany(GroupMember, { foreignKey: 'groupId', as: 'members' });
GroupMember.belongsTo(Group, { foreignKey: 'groupId' });

User.hasMany(GroupMember, { foreignKey: 'userId', as: 'groupMemberships' });
GroupMember.belongsTo(User, { foreignKey: 'userId' });

Group.hasMany(GroupInvite, { foreignKey: 'groupId', as: 'invites' });
GroupInvite.belongsTo(Group, { foreignKey: 'groupId' });

User.hasMany(Badge, { foreignKey: 'userId', as: 'badges' });
Badge.belongsTo(User, { foreignKey: 'userId' });

Friendship.belongsTo(User, { foreignKey: 'requesterId', as: 'requester' });
Friendship.belongsTo(User, { foreignKey: 'addresseeId', as: 'addressee' });

Game.hasMany(Comment, { foreignKey: 'gameId', as: 'comments' });
Comment.belongsTo(Game, { foreignKey: 'gameId' });
Comment.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Comment, { foreignKey: 'userId', as: 'comments' });

User.hasMany(Notification, { foreignKey: 'userId', as: 'notifications' });
Notification.belongsTo(User, { foreignKey: 'userId' });

// Initialize database
async function initDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Database connection established.');

    await sequelize.sync({ alter: false });
    console.log('Database synced.');

    await runMigrations();

    // Check if users exist
    const userCount = await User.count();
    if (userCount === 0) {
      await seedDatabase();
    }
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

async function runMigrations() {
  await sequelize.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS role "public"."enum_users_role" NOT NULL DEFAULT 'user'`
  );
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS picks_user_game_unique ON picks ("userId", "gameId")'
  );
  await sequelize.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_groups_visibility') THEN
        CREATE TYPE "public"."enum_groups_visibility" AS ENUM ('private', 'public');
      END IF;
    END $$;
  `);
  await sequelize.query(
    `ALTER TABLE groups ADD COLUMN IF NOT EXISTS visibility "public"."enum_groups_visibility" NOT NULL DEFAULT 'private'`
  );
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_unique ON friendships (LEAST("requesterId", "addresseeId"), GREATEST("requesterId", "addresseeId"))`
  );

  const seedFilePath = path.join(__dirname, '..', 'data.json');
  if (!fs.existsSync(seedFilePath)) return;
  const seed = JSON.parse(fs.readFileSync(seedFilePath, 'utf8'));
  const seedPasswordByUsername = new Map(seed.users.map((u) => [u.username, u.password]));
  const seedRoleByUsername = new Map(seed.users.map((u) => [u.username, u.role || 'user']));

  const existingUsers = await User.findAll();
  for (const user of existingUsers) {
    const needsHash = user.password && !BCRYPT_HASH_PATTERN.test(user.password);
    const seedPassword = seedPasswordByUsername.get(user.username);
    const seedRole = seedRoleByUsername.get(user.username);

    if (needsHash) {
      if (seedPassword && user.password === seedPassword) {
        user.password = await bcrypt.hash(seedPassword, 10);
        console.log(`Migrated plaintext password for seed user '${user.username}'`);
      } else {
        console.warn(
          `[scorecast] User '${user.username}' has a non-bcrypt password that isn't in data.json — they will need to reset it`
        );
      }
    }
    if (seedRole && user.role !== seedRole) {
      user.role = seedRole;
    }
    if (user.changed()) {
      await user.save({ hooks: false });
    }
  }
}

async function seedDatabase() {
  const seedFilePath = path.join(__dirname, '..', 'data.json');

  if (!fs.existsSync(seedFilePath)) {
    console.log('No seed file found.');
    return;
  }

  try {
    const seed = JSON.parse(fs.readFileSync(seedFilePath, 'utf8'));

    // Insert users
    const usersData = seed.users.map(user => ({
      id: user.id,
      username: user.username,
      password: user.password,
      role: user.role || 'user',
      createdAt: user.createdAt,
    }));
    await User.bulkCreate(usersData, { ignoreDuplicates: true, individualHooks: true });
    console.log('Users seeded.');

    // Insert games
    await Game.bulkCreate(seed.games, { ignoreDuplicates: true });
    console.log('Games seeded.');

    // Insert groups
    const groupsData = seed.groups.map(group => ({
      id: group.id,
      name: group.name,
      ownerId: group.ownerId,
      createdAt: group.createdAt,
    }));
    await Group.bulkCreate(groupsData, { ignoreDuplicates: true });
    console.log('Groups seeded.');

    // Insert group members
    for (const group of seed.groups) {
      for (const memberId of group.members || []) {
        await GroupMember.create({ groupId: group.id, userId: memberId }).catch(() => {});
      }
    }
    console.log('Group members seeded.');

    // Insert group invites
    for (const group of seed.groups) {
      for (const invite of group.invites || []) {
        await GroupInvite.create({ groupId: group.id, username: invite.username }).catch(() => {});
      }
    }
    console.log('Group invites seeded.');

    // Insert picks
    await Pick.bulkCreate(seed.picks, { ignoreDuplicates: true });
    console.log('Picks seeded.');
  } catch (error) {
    console.error('Seeding failed:', error);
  }
}

module.exports = {
  sequelize,
  User,
  Group,
  Game,
  Pick,
  GroupMember,
  GroupInvite,
  Badge,
  Friendship,
  Comment,
  Notification,
  initDatabase,
};
