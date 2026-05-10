require('dotenv').config();
const { Sequelize } = require('sequelize');
const fs = require('fs');
const path = require('path');

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

// Initialize database
async function initDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Database connection established.');

    await sequelize.sync({ alter: false });
    console.log('Database synced.');

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
      createdAt: user.createdAt,
    }));
    await User.bulkCreate(usersData, { ignoreDuplicates: true });
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
  initDatabase,
};
