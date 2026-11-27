// 058 (2026-11-27): register the real students from B-SMART, and keep what B-SMART knows about each one.
// - bsmart_students: one row per student as B-SMART has him (class, academic year he was registered in, admission date, parent).
//   It is the copy of the B-SMART "Student details" report. Our own student record is made from it, and can have more (guardians, etc.).
// - bsmart_files.academic_year and bsmart_bills.academic_year: which B-SMART academic year a report / a control number belongs to
//   (for example "2026-2027" or "2027"). The Fee details report does not say it, so the person who uploads chooses it.
exports.up = async (knex) => {
  await knex.schema.createTable('bsmart_students', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.string('adm', 30).notNullable();
    t.string('student_name', 150).notNullable();
    t.string('class_text', 60);
    t.string('stream', 30);
    t.string('academic_year', 12);
    t.date('admitted_on');
    t.string('parent', 150);
    t.string('phone', 20);
    t.string('sex', 10);
    t.string('prem_no', 30);
    t.integer('student_id').references('id').inTable('students').onDelete('SET NULL');
    t.integer('file_id').references('id').inTable('bsmart_files');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE UNIQUE INDEX bsmart_students_uq ON bsmart_students (school_id, lower(adm))');
  await knex.schema.alterTable('bsmart_files', (t) => { t.string('academic_year', 12); });
  await knex.schema.alterTable('bsmart_bills', (t) => { t.string('academic_year', 12); });
};
exports.down = async (knex) => {
  await knex.schema.alterTable('bsmart_bills', (t) => { t.dropColumn('academic_year'); });
  await knex.schema.alterTable('bsmart_files', (t) => { t.dropColumn('academic_year'); });
  await knex.schema.dropTableIfExists('bsmart_students');
};
