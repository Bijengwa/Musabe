// Cashier and Mapokezi roles (agreed 2026-11-17): the Money going out module needs them before it can be built.
const { ROLES, ADMIN_ROLES, SCHOOL_ROLES } = require('../src/auth/roles');
const list = (a) => a.map((x) => `'${x}'`).join(',');

exports.up = async (knex) => {
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_chk');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_school_chk');
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK ( role IN (${list(Object.keys(ROLES))}))`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_school_chk CHECK (
    ( role IN (${list(ADMIN_ROLES)}) AND school_id IS NULL) OR
    ( role IN (${list(SCHOOL_ROLES)}) AND school_id IS NOT NULL))`);
};

exports.down = async (knex) => {
  await knex('users').where('role', 'in', ['cashier', 'mapokezi']).update({ active: false, role: 'aacc' }); // no such role before: switched off
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_chk');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_school_chk');
  const ROLES_OLD = Object.keys(ROLES).filter((r) => r !== 'cashier' && r !== 'mapokezi');
  const ADMIN_OLD = ADMIN_ROLES.filter((r) => r !== 'cashier' && r !== 'mapokezi');
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN (${list(ROLES_OLD)}))`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_school_chk CHECK (
    (role IN (${list(ADMIN_OLD)}) AND school_id IS NULL) OR
    (role IN (${list(SCHOOL_ROLES)}) AND school_id IS NOT NULL))`);
};
