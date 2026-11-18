// Classes get a short name, as the school writes it: PRIMARY ONE = P 1, FORM ONE = F 1.
// - Lists are sorted by the number in the short name (P 1, P 2 ... P 7), so the "order" field is removed.
// - Receipts and lists show the short name (+ stream), e.g. "P 2 A".
// - students.import_id: which Excel upload added the student (shown on the student's page).
exports.up = async (knex) => {
  await knex.schema.alterTable('classes', (t) => { t.string('short_name', 12); });
  // A first short name from the full name; the School Admin changes it to P 1, F 1 ... on the Classes page.
  await knex.raw('UPDATE classes SET short_name = left(name, 12)');
  // Two classes whose names start the same: keep them apart by their number.
  await knex.raw(`UPDATE classes c SET short_name = left(c.name, 7) || ' #' || c.id
    WHERE EXISTS (SELECT 1 FROM classes o WHERE o.school_id = c.school_id AND o.id < c.id
      AND lower(o.short_name) = lower(c.short_name) AND lower(coalesce(o.stream,'')) = lower(coalesce(c.stream,'')))`);
  await knex.raw('ALTER TABLE classes ALTER COLUMN short_name SET NOT NULL');
  await knex.raw(`CREATE UNIQUE INDEX classes_short_uq ON classes (school_id, lower(short_name), lower(coalesce(stream, '')))`);
  await knex.raw('DROP INDEX IF EXISTS classes_school_id_sort_index');
  await knex.schema.alterTable('classes', (t) => { t.dropColumn('sort'); });
  await knex.schema.alterTable('students', (t) => {
    t.integer('import_id').references('id').inTable('student_imports').onDelete('RESTRICT');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('students', (t) => { t.dropColumn('import_id'); });
  await knex.schema.alterTable('classes', (t) => { t.integer('sort').notNullable().defaultTo(0); });
  await knex.raw('DROP INDEX IF EXISTS classes_short_uq');
  await knex.schema.alterTable('classes', (t) => { t.dropColumn('short_name'); });
};
