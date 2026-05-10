require('dotenv').config();

module.exports = {
  development: {
    username: 'postgres',
    password: 'postgres',
    database: 'scorecast_db',
    host: 'localhost',
    dialect: 'postgres',
  },
  test: {
    username: 'postgres',
    password: 'postgres',
    database: 'scorecast_test',
    host: 'localhost',
    dialect: 'postgres',
  },
  production: {
    use_env_variable: 'DATABASE_URL',
    dialect: 'postgres',
    ssl: true,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
  },
};
