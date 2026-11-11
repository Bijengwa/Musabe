// Safe to run more than once: it only adds what is missing.
require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');

const SCHOOLS = [
  { code: 'pre', name: 'Musabe English Medium School', short_name: 'English Medium', levels: 'Nursery & Primary', receipt_prefix: 'EM' },
  { code: 'boys', name: 'Musabe Boys Secondary School', short_name: 'Boys Secondary', levels: 'Form I–IV', receipt_prefix: 'BS' },
  { code: 'girls', name: 'Musabe Girls Secondary School', short_name: 'Girls Secondary', levels: 'Form I–IV', receipt_prefix: 'GS' },
];

exports.seed = async (knex) => {
  for (const s of SCHOOLS) {
    await knex('schools').insert(s).onConflict('code').ignore();
  }

  const username = process.env.SUPERADMIN_USERNAME || 'superadmin';
  const exists = await knex('users').whereRaw('lower(username) = ?', [username.toLowerCase()]).first();
  if (!exists) {
    const password = process.env.SUPERADMIN_PASSWORD || 'Musabe@2026';
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
