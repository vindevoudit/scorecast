require('dotenv').config();

const baseLocal = {
  host: 'localhost',
  database: 'scorecast_db',
  username: 'postgres',
  password: 'postgres',
  dialect: 'postgres',
};

// Cloud-managed Postgres (Azure DB for PostgreSQL Flexible Server, AWS RDS,
// etc.) requires TLS. sequelize-cli doesn't honour `?sslmode=require` in the
// DATABASE_URL string on its own — we look for it explicitly and opt into
// dialectOptions.ssl. Local docker-compose Postgres URLs don't set sslmode,
// so SSL stays off there.
const sslDialectOptions = {
  ssl: { require: true, rejectUnauthorized: false },
};

function configFor(envName) {
  if (process.env.DATABASE_URL) {
    const config = {
      use_env_variable: 'DATABASE_URL',
      dialect: 'postgres',
    };
    if (process.env.DATABASE_URL.includes('sslmode=require')) {
      config.dialectOptions = sslDialectOptions;
    }
    return config;
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
