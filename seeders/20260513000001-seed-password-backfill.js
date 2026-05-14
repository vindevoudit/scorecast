'use strict';

const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$/;

module.exports = {
  async up(queryInterface) {
    const seedFilePath = path.join(__dirname, '..', 'data.json');
    if (!fs.existsSync(seedFilePath)) return;

    const seed = JSON.parse(fs.readFileSync(seedFilePath, 'utf8'));
    const seedPasswordByUsername = new Map(seed.users.map((u) => [u.username, u.password]));
    const seedRoleByUsername = new Map(seed.users.map((u) => [u.username, u.role || 'user']));

    const [users] = await queryInterface.sequelize.query(
      `SELECT id, username, password, role FROM users`,
    );

    for (const user of users) {
      const updates = {};

      if (user.password && !BCRYPT_HASH_PATTERN.test(user.password)) {
        const seedPassword = seedPasswordByUsername.get(user.username);
        if (seedPassword && user.password === seedPassword) {
          updates.password = await bcrypt.hash(seedPassword, 10);
        }
      }

      const seedRole = seedRoleByUsername.get(user.username);
      if (seedRole && user.role !== seedRole) {
        updates.role = seedRole;
      }

      if (Object.keys(updates).length > 0) {
        const setParts = [];
        const replacements = { id: user.id };
        for (const [key, value] of Object.entries(updates)) {
          setParts.push(`"${key}" = :${key}`);
          replacements[key] = value;
        }
        await queryInterface.sequelize.query(
          `UPDATE users SET ${setParts.join(', ')} WHERE id = :id`,
          { replacements },
        );
      }
    }
  },

  async down() {
    // Not reversible — leaves passwords hashed.
  },
};
