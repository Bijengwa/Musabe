// 051 (2026-11-24): class timetable as a grid.
// - timetable_periods: the periods (and their clock times) of each class stream for a term. Empty until the Academic
//   Master / Mistress writes them: every class has its own times (P4 and P7 are not like P1).
// - academic_timetable_entries: a box may now be an activity (ASSEMBLY, REVISION, BREAK ...) with no subject.
// The timetable is a plan, not a record: a new save replaces the old grid of that class and term.
exports.up = async (knex) => {
  await knex.schema.createTable('timetable_periods', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.integer('class_id').notNullable().references('id').inTable('classes');
    t.integer('year').notNullable();
    t.integer('term').notNullable();
    t.integer('period').notNullable();
    t.time('starts');
    t.time('ends');
    t.string('kind', 8).notNullable().defaultTo('lesson');   // lesson, break, lunch, other
  });
  await knex.raw(`ALTER TABLE timetable_periods ADD CONSTRAINT timetable_periods_chk CHECK (term BETWEEN 1 AND 2 AND period BETWEEN 1 AND 12 AND kind IN ('lesson','break','lunch','other'))`);
  await knex.raw('CREATE UNIQUE INDEX timetable_periods_uq ON timetable_periods (class_id, year, term, period)');
  await knex.raw('ALTER TABLE academic_timetable_entries ALTER COLUMN subject_id DROP NOT NULL');
  await knex.raw('ALTER TABLE academic_timetable_entries ADD COLUMN activity varchar(40)');
  await knex.raw('ALTER TABLE academic_timetable_entries ADD CONSTRAINT academic_timetable_box_chk CHECK (subject_id IS NOT NULL OR activity IS NOT NULL)');
};

exports.down = async (knex) => {
  await knex.raw('ALTER TABLE academic_timetable_entries DROP CONSTRAINT academic_timetable_box_chk');
  await knex.raw('DELETE FROM academic_timetable_entries WHERE subject_id IS NULL');
  await knex.raw('ALTER TABLE academic_timetable_entries DROP COLUMN activity');
  await knex.raw('ALTER TABLE academic_timetable_entries ALTER COLUMN subject_id SET NOT NULL');
  await knex.schema.dropTableIfExists('timetable_periods');
};
