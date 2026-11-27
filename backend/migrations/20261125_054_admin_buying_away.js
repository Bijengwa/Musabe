// 054 (2026-11-25):
// - Buying that starts at the administration (car spares, things that go to no school): a requisition may have NO school (school_id NULL).
// - "Away": the Manager (or the Assistant Manager) marks himself away. Money approval goes to the Manager; when he is away, to the
//   Assistant Manager; when both are away, to the Finance Manager.
exports.up = async (knex) => {
  await knex.raw('ALTER TABLE requisitions ALTER COLUMN school_id DROP NOT NULL');
  await knex.schema.alterTable('users', (t) => { t.boolean('away').notNullable().defaultTo(false); });
  // A purchase for the administration (car spares...): no school, no delivery, no stock.
  await knex.schema.alterTable('purchases', (t) => { t.boolean('for_admin').notNullable().defaultTo(false); });
};
exports.down = async (knex) => {
  if (await knex('requisitions').whereNull('school_id').first()) throw new Error('Cannot roll back: some requisitions are for the administration (no school).');
  await knex.schema.alterTable('purchases', (t) => { t.dropColumn('for_admin'); });
  await knex.schema.alterTable('users', (t) => { t.dropColumn('away'); });
  await knex.raw('ALTER TABLE requisitions ALTER COLUMN school_id SET NOT NULL');
};
