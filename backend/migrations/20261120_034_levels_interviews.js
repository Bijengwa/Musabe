// 2026-11-20 (late): classes from built-in levels, run by the Academic Master; admission interviews.
// - classes.level: the built-in level (src/lib/levels.js), e.g. P1, F4. Old classes are matched by their names;
//   any that do not match keep level NULL until the Academic Master picks the level.
// - classes.curriculum: new | old | school (the change period: F4 2027 still old, F1-F3 new).
// - Role Academic Secretary (Assistant Director's office).
// - admission_interviews: applicants, exam centre, previous school, marks, result, parent contacts, date.
//   Kept for follow-up after the child joins (students.interview_id). Never deleted.
const { ROLES, ADMIN_ROLES, SCHOOL_ROLES } = require('../src/auth/roles');
const { guessLevel, LEVEL_KEYS } = require('../src/lib/levels');
const list = (a) => a.map((x) => `'${x}'`).join(',');

async function roleChecks(knex, roles, admin, school) {
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_chk');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_school_chk');
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN (${list(roles)}))`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_school_chk CHECK (
    (role IN (${list(admin)}) AND school_id IS NULL) OR (role IN (${list(school)}) AND school_id IS NOT NULL))`);
  await knex.raw('ALTER TABLE user_roles DROP CONSTRAINT user_roles_chk');
  await knex.raw(`ALTER TABLE user_roles ADD CONSTRAINT user_roles_chk CHECK (role IN (${list(roles)}) AND (
    (role IN (${list(admin)}) AND school_id IS NULL) OR (role IN (${list(school)}) AND school_id IS NOT NULL)))`);
}

exports.up = async (knex) => {
  await roleChecks(knex, Object.keys(ROLES), ADMIN_ROLES, SCHOOL_ROLES);

  await knex.schema.alterTable('classes', (t) => { t.string('level', 10); t.string('curriculum', 6); });
  for (const c of await knex('classes').select('id', 'name', 'short_name')) {
    const level = guessLevel(c);
    if (level) await knex('classes').where({ id: c.id }).update({ level });
  }
  await knex.raw(`ALTER TABLE classes ADD CONSTRAINT classes_level_chk CHECK (
    (level IS NULL OR level IN (${list(LEVEL_KEYS)})) AND (curriculum IS NULL OR curriculum IN ('new','old','school')))`);

  await knex.schema.createTable('admission_interviews', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.integer('year').notNullable();                       // the year the child would join, e.g. 2027
    t.string('level', 10);                                 // class applied for (built-in level)
    t.string('first_name', 40).notNullable();
    t.string('middle_name', 40);
    t.string('last_name', 40).notNullable();
    t.string('full_name', 130).notNullable();
    t.string('sex', 1).notNullable();
    t.string('exam_centre', 80);
    t.string('previous_school', 120);
    t.date('interview_date');
    t.jsonb('marks').notNullable().defaultTo('[]');        // [{ subject, marks, outOf }]
    t.decimal('total', 7, 2);
    t.decimal('out_of', 7, 2);
    t.string('result', 8).notNullable().defaultTo('waiting');  // passed | failed | reserve | absent | waiting
    t.string('parent_name', 120);
    t.string('parent_phone', 10);
    t.string('parent_phone2', 10);
    t.string('note', 200);
    t.integer('student_id').references('id').inTable('students');
    t.integer('created_by').references('id').inTable('users');
    t.integer('updated_by').references('id').inTable('users');
    t.timestamps(true, true);
    t.index(['school_id', 'year']);
  });
  await knex.raw(`ALTER TABLE admission_interviews ADD CONSTRAINT admission_interviews_chk CHECK (
    sex IN ('M','F') AND result IN ('passed','failed','reserve','absent','waiting')
    AND (level IS NULL OR level IN (${list(LEVEL_KEYS)}))
    AND (parent_phone IS NULL OR parent_phone ~ '^0[67][0-9]{8}$') AND (parent_phone2 IS NULL OR parent_phone2 ~ '^0[67][0-9]{8}$'))`);
  await knex.raw('CREATE UNIQUE INDEX admission_interviews_student_uq ON admission_interviews (student_id) WHERE student_id IS NOT NULL');
  await knex.raw('CREATE TRIGGER admission_interviews_no_delete BEFORE DELETE ON admission_interviews FOR EACH ROW EXECUTE FUNCTION musabe_no_delete()');
  await knex.schema.alterTable('students', (t) => { t.integer('interview_id').references('id').inTable('admission_interviews'); });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('students', (t) => { t.dropColumn('interview_id'); });
  await knex.schema.dropTableIfExists('admission_interviews');
  await knex.raw('ALTER TABLE classes DROP CONSTRAINT classes_level_chk');
  await knex.schema.alterTable('classes', (t) => { t.dropColumn('level'); t.dropColumn('curriculum'); });
  await knex('users').where('role', 'secretary').update({ active: false, role: 'adirector' });
  await knex('user_roles').where('role', 'secretary').update({ active: false, role: 'adirector' });
  await roleChecks(knex, Object.keys(ROLES).filter((r) => r !== 'secretary'), ADMIN_ROLES.filter((r) => r !== 'secretary'), SCHOOL_ROLES);
};
