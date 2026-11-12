require('dotenv').config({ quiet: true });

// Database settings come from .env. There are TWO accounts (see docs/database-roles.md):
// - Runtime (the app): DATABASE_USER / DATABASE_PASSWORD, or DATABASE_URL. Restricted: read and write rows only.
// - Migrations and seeds (npm run migrate / seed / setup): MIGRATION_DATABASE_USER / MIGRATION_DATABASE_PASSWORD,
//   or MIGRATION_DATABASE_URL. Owns the tables, so it can change them. Never used by the running app.
// If the MIGRATION_* values are empty, migrations use the runtime values (old single-account setup).
// No passwords are written in this file.
const base = {
  host: process.env.DATABASE_HOST || 'localhost',
  port: Number(process.env.DATABASE_PORT) || 5432,
  database: process.env.DATABASE_NAME || 'musabe_db',
};

const runtime = process.env.DATABASE_URL || {
  ...base,
  user: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD || '',
};

const migration = process.env.MIGRATION_DATABASE_URL
  || (process.env.MIGRATION_DATABASE_USER
    ? { ...base, user: process.env.MIGRATION_DATABASE_USER, password: process.env.MIGRATION_DATABASE_PASSWORD || '' }
    : runtime);

const shared = {
  client: 'pg',
  migrations: { directory: './migrations', tableName: 'knex_migrations' },
  seeds: { directory: './seeds' },
};

// Used by the knex command line (migrate, rollback, seed): the migration account.
module.exports = { ...shared, connection: migration, pool: { min: 0, max: 2 } };

// Used by the running app (src/db.js): the restricted runtime account.
module.exports.runtime = { ...shared, connection: runtime, pool: { min: 0, max: 10 } };
