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

// Tier 25 A1 — connection pool sized for 3-replica concurrency.
// Default sequelize pool is `max: 5` per replica → ~15 cluster-wide,
// which the 16th concurrent DB-bound request hits and 503s after
// waiting 30s. max=20 gives ~60 cluster-wide; Postgres B1ms has
// ~100 `max_connections` headroom. acquire bumped from 60s default
// to 30s so a connection-starvation incident surfaces as a 503 fast
// instead of holding the request thread for a minute.
const sequelizePool = {
  max: 20,
  min: 2,
  idle: 10_000,
  acquire: 30_000,
};

function configFor(envName) {
  if (process.env.DATABASE_URL) {
    const config = {
      use_env_variable: 'DATABASE_URL',
      dialect: 'postgres',
      pool: sequelizePool,
    };
    if (process.env.DATABASE_URL.includes('sslmode=require')) {
      config.dialectOptions = sslDialectOptions;
    }
    return config;
  }
  if (envName === 'test') {
    return { ...baseLocal, database: 'scorecast_test_db', pool: sequelizePool };
  }
  return { ...baseLocal, pool: sequelizePool };
}

module.exports = {
  development: configFor('development'),
  test: configFor('test'),
  production: configFor('production'),
};
