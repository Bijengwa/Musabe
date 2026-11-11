require('dotenv').config({ quiet: true });

// Database settings come from .env.
// Either give DATABASE_URL, or the separate DATABASE_* values below.
const connection = process.env.DATABASE_URL || {
  host: process.env.DATABASE_HOST || 'localhost',
  port: Number(process.env.DATABASE_PORT) || 5432,
  user: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD || '',
  database: process.env.DATABASE_NAME || 'musabe_db',
};

module.exports = {
  client: 'pg',
  connection,
  pool: { min: 0, max: 10 },
  migrations: { directory: './migrations', tableName: 'knex_migrations' },
  seeds: { directory: './seeds' },
};
