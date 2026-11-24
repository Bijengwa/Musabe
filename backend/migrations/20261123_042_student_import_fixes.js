// 2026-11-23: one wrong row no longer means throwing away the whole class list.
// On the review page a row can be corrected (or skipped) before Approve; the corrections are kept here,
// by Excel row number: { "12": { firstName: ..., guardians: [...] }, "40": { skip: true } }.
exports.up = async (knex) => {
  await knex.schema.alterTable('student_imports', (t) => { t.jsonb('fixes').notNullable().defaultTo('{}'); });
};
exports.down = async (knex) => {
  await knex.schema.alterTable('student_imports', (t) => { t.dropColumn('fixes'); });
};
