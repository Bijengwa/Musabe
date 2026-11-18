// 2026-11-18. Like the paper form, Qty and Amount@ may be left empty (the paper often has only the details and a TOTAL AMOUNT).
// - requisition_lines: qty may be empty; line_total = the TOTAL AMOUNT of the line (qty x amount@ when both are written, else what the
//   applicant wrote); approved_total = what the Manager approved (money to give); left_qty / used_qty = what is still left and what
//   was already used, written at the school (Academic Master with the librarian, or the school store-keeper).
// - New school role "sstore" (School Store-keeper): first signer of general requisitions.
const { ROLES, ADMIN_ROLES, SCHOOL_ROLES } = require('../src/auth/roles');
const list = (a) => a.map((x) => `'${x}'`).join(',');
exports.up = async (knex) => {
  await knex.raw('ALTER TABLE requisition_lines ALTER COLUMN qty DROP NOT NULL');
  await knex.schema.alterTable('requisition_lines', (t) => {
    t.integer('line_total'); t.integer('approved_total'); t.integer('left_qty'); t.integer('used_qty');
  });
  await knex.raw('UPDATE requisition_lines SET line_total = qty * est_cost WHERE qty IS NOT NULL AND est_cost IS NOT NULL');
  await knex.raw('UPDATE requisition_lines SET approved_total = COALESCE(approved_qty, qty) * est_cost WHERE est_cost IS NOT NULL AND qty IS NOT NULL AND approved_qty IS NOT NULL');
  await knex.raw('ALTER TABLE requisition_lines DROP CONSTRAINT requisition_lines_chk');
  await knex.raw(`ALTER TABLE requisition_lines ADD CONSTRAINT requisition_lines_chk CHECK ((qty IS NULL OR qty > 0)
    AND (approved_qty IS NULL OR (qty IS NOT NULL AND approved_qty >= 0 AND approved_qty <= qty))
    AND (est_cost IS NULL OR est_cost >= 0) AND (line_total IS NULL OR line_total >= 0) AND (approved_total IS NULL OR approved_total >= 0)
    AND (left_qty IS NULL OR left_qty >= 0) AND (used_qty IS NULL OR used_qty >= 0))`);
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_chk');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_school_chk');
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN (${list(Object.keys(ROLES))}))`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_school_chk CHECK (
    (role IN (${list(ADMIN_ROLES)}) AND school_id IS NULL) OR (role IN (${list(SCHOOL_ROLES)}) AND school_id IS NOT NULL))`);
};
exports.down = async (knex) => {
  if (await knex('users').where('role', 'sstore').first()) throw new Error('Cannot roll back: some accounts are School Store-keepers. Change or remove them first.');
  if (await knex('requisition_lines').whereNull('qty').first()) throw new Error('Cannot roll back: some requisition lines have no quantity.');
  await knex.raw('ALTER TABLE requisition_lines DROP CONSTRAINT requisition_lines_chk');
  await knex.schema.alterTable('requisition_lines', (t) => { t.dropColumn('used_qty'); t.dropColumn('left_qty'); t.dropColumn('approved_total'); t.dropColumn('line_total'); });
  await knex.raw('ALTER TABLE requisition_lines ALTER COLUMN qty SET NOT NULL');
  await knex.raw(`ALTER TABLE requisition_lines ADD CONSTRAINT requisition_lines_chk CHECK (qty > 0
    AND (approved_qty IS NULL OR (approved_qty >= 0 AND approved_qty <= qty)) AND (est_cost IS NULL OR est_cost >= 0))`);
  const OLD = Object.keys(ROLES).filter((r) => r !== 'sstore');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_chk');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_school_chk');
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN (${list(OLD)}))`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_school_chk CHECK (
    (role IN (${list(ADMIN_ROLES)}) AND school_id IS NULL) OR (role IN (${list(SCHOOL_ROLES.filter((r) => r !== 'sstore'))}) AND school_id IS NOT NULL))`);
};
