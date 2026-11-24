// 045 (2026-11-23): Teacher on Duty and roll call.
// - New school role: Second Master (Deputy Head Master). He appoints the Teacher(s) on Duty for each week.
// - duty_rosters: who is on duty in a school for a week (week = Monday to Sunday, saved by its Monday).
//   Removing an appointment keeps the row (active = false), so the history stays.
// - roll_calls + roll_call_marks: one roll call per class stream, per day, per session (morning / evening / night),
//   taken by the Teacher on Duty (or the Second Master). One mark per student: P present, A absent, L late,
//   S sick, R permission (ruhusa).
// - duty_reports: the Teacher on Duty's daily report; the Second Master or Head Master marks it as seen.
const { ROLES, ADMIN_ROLES, SCHOOL_ROLES } = require('../src/auth/roles');
const list = (a) => a.map((x) => `'${x}'`).join(',');

async function roleChecks(knex, roles, schoolRoles) {
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_chk');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_school_chk');
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN (${list(roles)}))`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_school_chk CHECK (
    (role IN (${list(ADMIN_ROLES)}) AND school_id IS NULL) OR (role IN (${list(schoolRoles)}) AND school_id IS NOT NULL))`);
  await knex.raw('ALTER TABLE user_roles DROP CONSTRAINT user_roles_chk');
  await knex.raw(`ALTER TABLE user_roles ADD CONSTRAINT user_roles_chk CHECK (role IN (${list(roles)}) AND (
    (role IN (${list(ADMIN_ROLES)}) AND school_id IS NULL) OR (role IN (${list(schoolRoles)}) AND school_id IS NOT NULL)))`);
}

exports.up = async (knex) => {
  await roleChecks(knex, Object.keys(ROLES), SCHOOL_ROLES);

  await knex.schema.createTable('duty_rosters', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.date('week_start').notNullable();
    t.integer('user_id').notNullable().references('id').inTable('users');
    t.string('note', 120);
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('appointed_by').notNullable().references('id').inTable('users');
    t.timestamp('appointed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('removed_by').references('id').inTable('users');
    t.timestamp('removed_at', { useTz: true });
    t.index(['school_id', 'week_start']);
  });
  await knex.raw('ALTER TABLE duty_rosters ADD CONSTRAINT duty_rosters_monday_chk CHECK (extract(isodow FROM week_start) = 1)');
  await knex.raw('CREATE UNIQUE INDEX duty_rosters_one_active ON duty_rosters (school_id, week_start, user_id) WHERE active');

  await knex.schema.createTable('roll_calls', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.integer('class_id').notNullable().references('id').inTable('classes');
    t.date('day').notNullable();
    t.string('session', 8).notNullable().defaultTo('morning');
    t.string('note', 300);
    t.integer('taken_by').notNullable().references('id').inTable('users');
    t.timestamp('taken_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('updated_by').references('id').inTable('users');
    t.timestamp('updated_at', { useTz: true });
    t.index(['school_id', 'day']);
  });
  await knex.raw(`ALTER TABLE roll_calls ADD CONSTRAINT roll_calls_session_chk CHECK (session IN ('morning','evening','night'))`);
  await knex.raw('CREATE UNIQUE INDEX roll_calls_one ON roll_calls (class_id, day, session)');

  await knex.schema.createTable('roll_call_marks', (t) => {
    t.increments('id');
    t.integer('roll_call_id').notNullable().references('id').inTable('roll_calls');
    t.integer('student_id').notNullable().references('id').inTable('students');
    t.string('status', 1).notNullable();
    t.string('note', 200);
    t.index(['student_id']);
  });
  await knex.raw(`ALTER TABLE roll_call_marks ADD CONSTRAINT roll_call_marks_chk CHECK (status IN ('P','A','L','S','R'))`);
  await knex.raw('CREATE UNIQUE INDEX roll_call_marks_one ON roll_call_marks (roll_call_id, student_id)');

  await knex.schema.createTable('duty_reports', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.date('day').notNullable();
    t.integer('written_by').notNullable().references('id').inTable('users');
    t.jsonb('fields').notNullable().defaultTo('{}');
    t.integer('seen_by').references('id').inTable('users');
    t.timestamp('seen_at', { useTz: true });
    t.string('seen_note', 500);
    t.timestamps(true, true);
  });
  await knex.raw('CREATE UNIQUE INDEX duty_reports_one ON duty_reports (school_id, day, written_by)');

  // History is kept: rows are never deleted (same guard as receipts).
  for (const t of ['duty_rosters', 'roll_calls', 'roll_call_marks', 'duty_reports']) {
    await knex.raw(`CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION musabe_no_delete()`);
  }
};

exports.down = async (knex) => {
  for (const t of ['duty_reports', 'roll_call_marks', 'roll_calls', 'duty_rosters']) await knex.schema.dropTableIfExists(t);
  await knex('users').where('role', 'second').update({ active: false, role: 'teacher' });
  await knex('user_roles').where('role', 'second').update({ active: false, role: 'teacher' });
  await roleChecks(knex, Object.keys(ROLES).filter((r) => r !== 'second'), SCHOOL_ROLES.filter((r) => r !== 'second'));
};
