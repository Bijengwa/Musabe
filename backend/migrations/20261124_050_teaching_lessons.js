// 050 (2026-11-24): teachers' daily work.
// - New school role: Discipline Master / Mistress (a teacher who got the post, still teaches). New office role: HR.
// - lesson_records: after every lesson the teacher writes what was done (taught a topic, quiz, discussion, test,
//   revision, practical, homework, or was absent). Never deleted; a wrong record is corrected by a new one (correction_of).
// - topic_coverage: a syllabus topic marked "done" for a class stream and subject (from a lesson record).
// - school_tests: the Academic Master decides a test for one class level (all streams) of the school.
// - There are two terms a year: the new tables accept only term 1 or 2.
const { ROLES, ADMIN_ROLES, SCHOOL_ROLES } = require('../src/auth/roles');
const list = (a) => a.map((x) => `'${x}'`).join(',');

async function roleChecks(knex, roles, adminRoles, schoolRoles) {
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_chk');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_school_chk');
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN (${list(roles)}))`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_school_chk CHECK (
    (role IN (${list(adminRoles)}) AND school_id IS NULL) OR (role IN (${list(schoolRoles)}) AND school_id IS NOT NULL))`);
  await knex.raw('ALTER TABLE user_roles DROP CONSTRAINT user_roles_chk');
  await knex.raw(`ALTER TABLE user_roles ADD CONSTRAINT user_roles_chk CHECK (role IN (${list(roles)}) AND (
    (role IN (${list(adminRoles)}) AND school_id IS NULL) OR (role IN (${list(schoolRoles)}) AND school_id IS NOT NULL)))`);
}

exports.up = async (knex) => {
  await roleChecks(knex, Object.keys(ROLES), ADMIN_ROLES, SCHOOL_ROLES);

  await knex.schema.createTable('lesson_records', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.integer('teacher_id').notNullable().references('id').inTable('users');
    t.integer('class_id').notNullable().references('id').inTable('classes');
    t.integer('subject_id').notNullable().references('id').inTable('academic_subjects');
    t.date('day').notNullable();
    t.integer('period');                       // timetable period, when the lesson came from the timetable
    t.integer('term').notNullable();
    t.integer('year').notNullable();
    t.string('kind', 12).notNullable();        // taught, quiz, discussion, test, revision, practical, homework, absent
    t.integer('topic_id').references('id').inTable('syllabus_topics');
    t.boolean('topic_done').notNullable().defaultTo(false);
    t.string('title', 200);                    // what was done, in the teacher's words
    t.integer('understanding');                // 0-100: how well the class understood (optional)
    t.string('absent_reason', 200);
    t.integer('school_test_id');               // set when this lesson was the school-wide test
    t.integer('correction_of').references('id').inTable('lesson_records');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['school_id', 'teacher_id', 'day']);
    t.index(['class_id', 'subject_id']);
  });
  await knex.raw(`ALTER TABLE lesson_records ADD CONSTRAINT lesson_records_chk CHECK (
    kind IN ('taught','quiz','discussion','test','revision','practical','homework','absent') AND term BETWEEN 1 AND 2
    AND (understanding IS NULL OR understanding BETWEEN 0 AND 100)
    AND (kind <> 'absent' OR absent_reason IS NOT NULL) AND (topic_done = false OR topic_id IS NOT NULL))`);
  await knex.raw('CREATE TRIGGER lesson_records_no_delete BEFORE DELETE ON lesson_records FOR EACH ROW EXECUTE FUNCTION musabe_no_delete()');
  await knex.raw('CREATE TRIGGER lesson_records_no_update BEFORE UPDATE ON lesson_records FOR EACH ROW EXECUTE FUNCTION musabe_no_delete()');

  await knex.schema.createTable('topic_coverage', (t) => {
    t.increments('id');
    t.integer('class_id').notNullable().references('id').inTable('classes');
    t.integer('subject_id').notNullable().references('id').inTable('academic_subjects');
    t.integer('topic_id').notNullable().references('id').inTable('syllabus_topics');
    t.integer('lesson_id').notNullable().references('id').inTable('lesson_records');
    t.integer('done_by').notNullable().references('id').inTable('users');
    t.date('done_on').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE UNIQUE INDEX topic_coverage_uq ON topic_coverage (class_id, subject_id, topic_id)');

  await knex.schema.createTable('school_tests', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.string('level', 10).notNullable();        // the class level (P3, F2 ...): every stream of it sits the same test
    t.integer('subject_id').references('id').inTable('academic_subjects');   // empty = all subjects
    t.string('title', 160).notNullable();
    t.date('test_day').notNullable();
    t.integer('term').notNullable();
    t.integer('year').notNullable();
    t.string('note', 300);
    t.boolean('active').notNullable().defaultTo(true);     // cancelled tests stay (active = false)
    t.integer('created_by').notNullable().references('id').inTable('users');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['school_id', 'test_day']);
  });
  await knex.raw('ALTER TABLE school_tests ADD CONSTRAINT school_tests_term_chk CHECK (term BETWEEN 1 AND 2)');
  await knex.raw('CREATE TRIGGER school_tests_no_delete BEFORE DELETE ON school_tests FOR EACH ROW EXECUTE FUNCTION musabe_no_delete()');
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('school_tests');
  await knex.schema.dropTableIfExists('topic_coverage');
  await knex.schema.dropTableIfExists('lesson_records');
  const without = (a, x) => a.filter((r) => !x.includes(r));
  await roleChecks(knex, without(Object.keys(ROLES), ['disc', 'hr']), without(ADMIN_ROLES, ['hr']), without(SCHOOL_ROLES, ['disc']));
};
