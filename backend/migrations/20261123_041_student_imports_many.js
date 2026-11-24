// 2026-11-23: bulk edit with Excel. One file can hold students of MANY classes (the whole school):
// each row goes to the class written in its "Class" column. Such an upload has no class of its own.
exports.up = async (knex) => {
  await knex.schema.alterTable('student_imports', (t) => { t.integer('class_id').nullable().alter(); });
};
exports.down = async (knex) => {
  await knex('student_imports').whereNull('class_id').del();
  await knex.schema.alterTable('student_imports', (t) => { t.integer('class_id').notNullable().alter(); });
};
