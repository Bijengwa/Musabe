// Safe to run more than once: it only adds what is missing.
require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');

const SCHOOLS = [
  { code: 'pre', name: 'Musabe English Medium School', short_name: 'English Medium', levels: 'Nursery & Primary', receipt_prefix: 'EM' },
  { code: 'boys', name: 'Musabe Boys Secondary School', short_name: 'Boys Secondary', levels: 'Form I–IV', receipt_prefix: 'BS' },
  { code: 'girls', name: 'Musabe Girls Secondary School', short_name: 'Girls Secondary', levels: 'Form I–IV', receipt_prefix: 'GS' },
];

// Rules for the first Super Admin password. Stricter than the normal rule (util.js checkPassword),
// because this account controls everything. Kept here so the seed does not load application code.
// Words that make a password easy to guess here (school name, account name, common words).
const KNOWN_BAD = ['musabe', 'password', 'admin', 'changeme', 'qwerty', '123456'];
function checkAdminPassword(pw) {
  if (typeof pw !== 'string' || !pw) return 'SUPERADMIN_PASSWORD is not set.';
  if (pw.length < 12) return 'SUPERADMIN_PASSWORD must have at least 12 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'SUPERADMIN_PASSWORD must use both letters and numbers.';
  if (KNOWN_BAD.some((b) => pw.toLowerCase().includes(b))) return 'SUPERADMIN_PASSWORD contains an easy-to-guess word (for example the school name).';
  return null;
}

exports.seed = async (knex) => {
  for (const s of SCHOOLS) {
    await knex('schools').insert(s).onConflict('code').ignore();
  }

  const username = process.env.SUPERADMIN_USERNAME || 'superadmin';
  const exists = await knex('users').whereRaw('lower(username) = ?', [username.toLowerCase()]).first();
  if (!exists) {
    // No default password. The person setting up the system must supply one (never printed).
    const password = process.env.SUPERADMIN_PASSWORD;
    const problem = checkAdminPassword(password);
    if (problem) {
      throw new Error(`Cannot create the first Super Admin: ${problem} `
        + 'Put a strong, private password in SUPERADMIN_PASSWORD in backend/.env (never in Git), run the seed again, '
        + 'then remove it from .env after the first sign-in.');
    }
    await knex('users').insert({
      full_name: process.env.SUPERADMIN_NAME || 'System Administrator',
      username,
      password_hash: await bcrypt.hash(password, 12),
      role: 'super',
      school_id: null,
      must_change_password: true,
    });
    console.log(`Super Admin created: username "${username}". Sign in and choose a new password.`);
  }
};
