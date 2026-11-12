// Checks, at start-up, that the app is NOT connected to PostgreSQL with a powerful account.
// The app must use the restricted runtime account (e.g. musabe_app). See docs/database-roles.md.
// - Production (NODE_ENV=production): a powerful account, or a database we cannot check, stops the start.
// - Elsewhere: a clear warning only, so local development keeps working.
const db = require('./db');

async function readRole(conn = db) {
  const { rows } = await conn.raw(`
    SELECT current_user AS name, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls,
           (SELECT d.datdba = r.oid FROM pg_database d WHERE d.datname = current_database()) AS owns_database,
           (SELECT count(*)::int FROM pg_tables t WHERE t.schemaname = 'public' AND t.tableowner = current_user) AS owned_tables
    FROM pg_roles r WHERE r.rolname = current_user`);
  return rows[0];
}

function problemsOf(r) {
  const p = [];
  if (r.rolsuper) p.push('is a superuser');
  if (r.rolcreaterole) p.push('can create roles');
  if (r.rolcreatedb) p.push('can create databases');
  if (r.rolbypassrls) p.push('can bypass row security');
  if (r.owns_database) p.push('owns the database');
  if (r.owned_tables > 0) p.push(`owns ${r.owned_tables} table(s), so it could change or drop them`);
  return p;
}

async function checkDbRole({ production = process.env.NODE_ENV === 'production', conn = db } = {}) {
  let r;
  try {
    r = await readRole(conn);
  } catch {
    const msg = 'Could not check which PostgreSQL account the app uses (database not reachable).';
    if (production) throw new Error(`${msg} Not starting in production until it can be checked.`);
    console.warn(`WARNING: ${msg}`);
    return null;
  }
  const problems = problemsOf(r);
  if (!problems.length) return r;
  const msg = `The app is connected to PostgreSQL as "${r.name}", which ${problems.join(', ')}. `
    + 'Use the restricted runtime account (DATABASE_USER=musabe_app). See docs/database-roles.md.';
  if (production) throw new Error(msg);
  console.warn(`WARNING: ${msg} Allowed only outside production.`);
  return r;
}

module.exports = { checkDbRole, readRole, problemsOf };
