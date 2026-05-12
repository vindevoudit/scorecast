require('dotenv').config();

const baseLocal = {
  host: 'localhost',
  database: 'scorecast_db',
  username: 'postgres',
  password: 'postgres',
  dialect: 'postgres',
};

function configFor(envName) {
  if (process.env.DATABASE_URL) {
    return {
      use_env_variable: 'DATABASE_URL',
      dialect: 'postgres',
    };
  }
  if (envName === 'test') {
    return { ...baseLocal, database: 'scorecast_test_db' };
  }
  return { ...baseLocal };
}

module.exports = {
  development: configFor('development'),
  test: configFor('test'),
  production: configFor('production'),
};
