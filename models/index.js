require('dotenv').config();
const { Sequelize } = require('sequelize');
const { Umzug, SequelizeStorage } = require('umzug');
const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');

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
const CommentReaction = require('./CommentReaction')(sequelize);
const EmailVerificationToken = require('./EmailVerificationToken')(sequelize);
const PasswordResetToken = require('./PasswordResetToken')(sequelize);

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

Comment.hasMany(CommentReaction, { foreignKey: 'commentId', as: 'reactions' });
CommentReaction.belongsTo(Comment, { foreignKey: 'commentId' });

EmailVerificationToken.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(EmailVerificationToken, { foreignKey: 'userId', as: 'emailVerificationTokens' });

PasswordResetToken.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(PasswordResetToken, { foreignKey: 'userId', as: 'passwordResetTokens' });

// Initialize database
async function initDatabase() {
  try {
    await sequelize.authenticate();
    logger.info('Database connection established.');

    await sequelize.sync({ alter: false });
    logger.info('Database synced.');

    await runMigrations();

    // Check if users exist
    const userCount = await User.count();
    if (userCount === 0) {
      await seedDatabase();
    }
  } catch (error) {
    logger.error({ err: error }, 'Database initialization failed');
    throw error;
  }
}

function buildUmzug() {
  return new Umzug({
    migrations: {
      glob: ['*.js', { cwd: path.join(__dirname, '..', 'migrations') }],
      resolve: ({ name, path: filepath, context }) => {
        const migration = require(filepath);
        return {
          name,
          up: async () => migration.up(context, Sequelize),
          down: async () => migration.down(context, Sequelize),
        };
      },
    },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: {
      info: (params) => logger.info({ migrate: params.event, name: params.name }, `migrate: ${params.event}`),
      warn: (params) => logger.warn({ migrate: params.event, name: params.name }, `migrate: ${params.event}`),
      error: (params) => logger.error({ migrate: params.event, name: params.name }, `migrate: ${params.event}`),
      debug: () => {},
    },
  });
}

async function runMigrations() {
  if (process.env.NODE_ENV === 'production' && process.env.MIGRATE_ON_BOOT !== 'true') {
    logger.warn(
      'Skipping auto-migrate in production. Run `npm run db:migrate` explicitly, or set MIGRATE_ON_BOOT=true to override.'
    );
    return;
  }
  const umzug = buildUmzug();
  const pending = await umzug.pending();
  if (pending.length === 0) {
    logger.info('No pending migrations.');
    return;
  }
  logger.info({ count: pending.length }, `Applying ${pending.length} pending migration(s)`);
  await umzug.up();
  logger.info('Migrations done.');
}

async function seedDatabase() {
  const seedFilePath = path.join(__dirname, '..', 'data.json');

  if (!fs.existsSync(seedFilePath)) {
    logger.info('No seed file found.');
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
    logger.info('Users seeded.');

    // Insert games
    await Game.bulkCreate(seed.games, { ignoreDuplicates: true });
    logger.info('Games seeded.');

    // Insert groups
    const groupsData = seed.groups.map(group => ({
      id: group.id,
      name: group.name,
      ownerId: group.ownerId,
      createdAt: group.createdAt,
    }));
    await Group.bulkCreate(groupsData, { ignoreDuplicates: true });
    logger.info('Groups seeded.');

    // Insert group members
    for (const group of seed.groups) {
      for (const memberId of group.members || []) {
        await GroupMember.create({ groupId: group.id, userId: memberId }).catch(() => {});
      }
    }
    logger.info('Group members seeded.');

    // Insert group invites
    for (const group of seed.groups) {
      for (const invite of group.invites || []) {
        await GroupInvite.create({ groupId: group.id, username: invite.username }).catch(() => {});
      }
    }
    logger.info('Group invites seeded.');

    // Insert picks
    await Pick.bulkCreate(seed.picks, { ignoreDuplicates: true });
    logger.info('Picks seeded.');
  } catch (error) {
    logger.error({ err: error }, 'Seeding failed');
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
  CommentReaction,
  EmailVerificationToken,
  PasswordResetToken,
  initDatabase,
};
