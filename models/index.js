require('dotenv').config();
const { Sequelize } = require('sequelize');
const { Umzug, SequelizeStorage } = require('umzug');
const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');

// Initialize Sequelize. Managed Postgres (Azure DB, RDS) requires TLS; signal
// that by adding `?sslmode=require` to the DATABASE_URL. The local
// docker-compose Postgres URL doesn't set it, so SSL stays off there.
const databaseUrl = process.env.DATABASE_URL || '';
const requireSsl = databaseUrl.includes('sslmode=require');
// Tier 25 A1 — pool sized for 3-replica concurrency. See
// config/database.js for the rationale. Both modules must stay in
// sync (config/database.js is sequelize-cli only; this is the runtime).
const sequelizeOptions = {
  pool: { max: 20, min: 2, idle: 10_000, acquire: 30_000 },
};
if (requireSsl) {
  sequelizeOptions.dialect = 'postgres';
  sequelizeOptions.dialectOptions = {
    ssl: { require: true, rejectUnauthorized: false },
  };
}
const sequelize = new Sequelize(
  databaseUrl || {
    host: 'localhost',
    database: 'scorecast_db',
    username: 'postgres',
    password: 'postgres',
    dialect: 'postgres',
  },
  sequelizeOptions,
);

// Import models
const User = require('./User')(sequelize);
const Group = require('./Group')(sequelize);
const Game = require('./Game')(sequelize);
const Pick = require('./Pick')(sequelize);
const GroupMember = require('./GroupMember')(sequelize);
const GroupInvite = require('./GroupInvite')(sequelize);
const GroupJoinRequest = require('./GroupJoinRequest')(sequelize);
const Badge = require('./Badge')(sequelize);
const Friendship = require('./Friendship')(sequelize);
const Comment = require('./Comment')(sequelize);
const Notification = require('./Notification')(sequelize);
const CommentReaction = require('./CommentReaction')(sequelize);
const EmailVerificationToken = require('./EmailVerificationToken')(sequelize);
const PasswordResetToken = require('./PasswordResetToken')(sequelize);
const RefreshToken = require('./RefreshToken')(sequelize);
const League = require('./League')(sequelize);
const Season = require('./Season')(sequelize);
const Team = require('./Team')(sequelize);
const AuditLog = require('./AuditLog')(sequelize);
const PushSubscription = require('./PushSubscription')(sequelize);
const UserScore = require('./UserScore')(sequelize);
const UserScoreOverall = require('./UserScoreOverall')(sequelize);

// Define associations.
//
// `onDelete: 'CASCADE'` is declared on every User-owned child relation so a
// fresh `sequelize.sync()` produces FKs that match the migration files. The
// existing prod DB had the bug version of these FKs (NO ACTION) for a long
// time; migration 20260516000002-cascade-user-fks.js retrofits CASCADE there.
User.hasMany(Pick, { foreignKey: 'userId', as: 'picks', onDelete: 'CASCADE' });
Pick.belongsTo(User, { foreignKey: 'userId' });

Game.hasMany(Pick, { foreignKey: 'gameId', as: 'picks', onDelete: 'CASCADE' });
Pick.belongsTo(Game, { foreignKey: 'gameId' });

Group.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });
User.hasMany(Group, { foreignKey: 'ownerId', as: 'ownedGroups', onDelete: 'CASCADE' });

Group.hasMany(GroupMember, { foreignKey: 'groupId', as: 'members', onDelete: 'CASCADE' });
GroupMember.belongsTo(Group, { foreignKey: 'groupId' });

User.hasMany(GroupMember, { foreignKey: 'userId', as: 'groupMemberships', onDelete: 'CASCADE' });
GroupMember.belongsTo(User, { foreignKey: 'userId' });

Group.hasMany(GroupInvite, { foreignKey: 'groupId', as: 'invites', onDelete: 'CASCADE' });
GroupInvite.belongsTo(Group, { foreignKey: 'groupId' });

// Tier 19 Chunk 3 — group join requests. CASCADE on both sides so deleting
// a group or a user atomically clears pending requests they owned.
Group.hasMany(GroupJoinRequest, {
  foreignKey: 'groupId',
  as: 'joinRequests',
  onDelete: 'CASCADE',
});
GroupJoinRequest.belongsTo(Group, { foreignKey: 'groupId' });
User.hasMany(GroupJoinRequest, {
  foreignKey: 'requesterId',
  as: 'groupJoinRequests',
  onDelete: 'CASCADE',
});
GroupJoinRequest.belongsTo(User, { foreignKey: 'requesterId', as: 'requester' });

User.hasMany(Badge, { foreignKey: 'userId', as: 'badges', onDelete: 'CASCADE' });
Badge.belongsTo(User, { foreignKey: 'userId' });

Friendship.belongsTo(User, { foreignKey: 'requesterId', as: 'requester' });
Friendship.belongsTo(User, { foreignKey: 'addresseeId', as: 'addressee' });

Game.hasMany(Comment, { foreignKey: 'gameId', as: 'comments', onDelete: 'CASCADE' });
Comment.belongsTo(Game, { foreignKey: 'gameId' });
Comment.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Comment, { foreignKey: 'userId', as: 'comments', onDelete: 'CASCADE' });
// Tier 18 Chunk 5 — group running comments. CASCADE so deleting a group
// removes its comment thread atomically; GroupService.cascadeDelete also
// fires an explicit Comment.destroy inside the transaction for parity
// with the post-Tier-11 user-cascade pattern.
Group.hasMany(Comment, { foreignKey: 'groupId', as: 'comments', onDelete: 'CASCADE' });
Comment.belongsTo(Group, { foreignKey: 'groupId' });

User.hasMany(Notification, { foreignKey: 'userId', as: 'notifications', onDelete: 'CASCADE' });
Notification.belongsTo(User, { foreignKey: 'userId' });

Comment.hasMany(CommentReaction, { foreignKey: 'commentId', as: 'reactions', onDelete: 'CASCADE' });
CommentReaction.belongsTo(Comment, { foreignKey: 'commentId' });

EmailVerificationToken.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(EmailVerificationToken, {
  foreignKey: 'userId',
  as: 'emailVerificationTokens',
  onDelete: 'CASCADE',
});

PasswordResetToken.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(PasswordResetToken, {
  foreignKey: 'userId',
  as: 'passwordResetTokens',
  onDelete: 'CASCADE',
});

RefreshToken.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(RefreshToken, { foreignKey: 'userId', as: 'refreshTokens', onDelete: 'CASCADE' });

PushSubscription.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(PushSubscription, {
  foreignKey: 'userId',
  as: 'pushSubscriptions',
  onDelete: 'CASCADE',
});

// Tier 4b Chunk 1 — League / Season / Game wiring. Deleting a league
// CASCADEs to its seasons; orphaning games is intentional (ON DELETE SET
// NULL on the FK) so legacy fixtures aren't blown away.
League.hasMany(Season, { foreignKey: 'leagueId', as: 'seasons', onDelete: 'CASCADE' });
Season.belongsTo(League, { foreignKey: 'leagueId', as: 'league' });

League.hasMany(Game, { foreignKey: 'leagueId', as: 'games' });
Game.belongsTo(League, { foreignKey: 'leagueId', as: 'league' });

Season.hasMany(Game, { foreignKey: 'seasonId', as: 'games' });
Game.belongsTo(Season, { foreignKey: 'seasonId', as: 'season' });

// Tier 17 — League → Team. CASCADE on delete so removing a league doesn't
// strand orphan team rows that the reactive Elo cascade would then look
// up forever and find missing. The seeder 20260522000001 + LeagueService's
// upsertFixture auto-insert both populate this table.
League.hasMany(Team, { foreignKey: 'leagueId', as: 'teams', onDelete: 'CASCADE' });
Team.belongsTo(League, { foreignKey: 'leagueId', as: 'league' });

// Tier 4b Chunk 3 — audit log writes survive admin deletion via SET NULL
// on actorUserId. AuditLog deliberately has no hasMany hooked from User
// because the history is a flat append-only stream, not user-owned data.
AuditLog.belongsTo(User, { foreignKey: 'actorUserId', as: 'actor' });

// Tier 24 — Materialized leaderboard scores. CASCADE on every axis so a
// deleted user / league / season drops its rows atomically. No belongsTo
// from the parent side because reads always start from user_scores (top-N
// by points DESC) and join Users in for the masking projection — no
// reverse-direction traversal exists. The cascade-fix post-Tier-11
// invariant (sync()-vs-migration order) is satisfied because these tables
// are NEW — they don't exist in the synced shape before the migration
// runs, so the migration is the one and only path that creates them.
UserScore.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(UserScore, { foreignKey: 'userId', as: 'userScores', onDelete: 'CASCADE' });
UserScore.belongsTo(League, { foreignKey: 'leagueId', as: 'league' });
UserScore.belongsTo(Season, { foreignKey: 'seasonId', as: 'season' });
UserScoreOverall.belongsTo(User, { foreignKey: 'userId' });
User.hasOne(UserScoreOverall, {
  foreignKey: 'userId',
  as: 'overallScore',
  onDelete: 'CASCADE',
});

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
      info: (params) =>
        logger.info({ migrate: params.event, name: params.name }, `migrate: ${params.event}`),
      warn: (params) =>
        logger.warn({ migrate: params.event, name: params.name }, `migrate: ${params.event}`),
      error: (params) =>
        logger.error({ migrate: params.event, name: params.name }, `migrate: ${params.event}`),
      debug: () => {},
    },
  });
}

async function runMigrations() {
  if (process.env.NODE_ENV === 'production' && process.env.MIGRATE_ON_BOOT !== 'true') {
    logger.warn(
      'Skipping auto-migrate in production. Run `npm run db:migrate` explicitly, or set MIGRATE_ON_BOOT=true to override.',
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
    const usersData = seed.users.map((user) => ({
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
    const groupsData = seed.groups.map((group) => ({
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
  GroupJoinRequest,
  Badge,
  Friendship,
  Comment,
  Notification,
  CommentReaction,
  EmailVerificationToken,
  PasswordResetToken,
  RefreshToken,
  League,
  Season,
  Team,
  AuditLog,
  PushSubscription,
  UserScore,
  UserScoreOverall,
  initDatabase,
  runMigrations,
};
