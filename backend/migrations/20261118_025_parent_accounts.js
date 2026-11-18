// Parents' mobile app (2026-11-18).
//
// A parent is NOT a staff account. There is no username and no password:
// - The school decides who is a parent: the phone number on the student's record (students.parent_phone),
//   typed by the School Admin or loaded from the Excel class list.
// - The parent opens the app, types that phone number and gets a 6-digit code by SMS. The code proves the phone is theirs.
// - One phone = one parent account. Every student (in any of the three schools) with that phone shows in the app,
//   so a parent with children in Boys Secondary and English Medium sees all of them in one place.
// - A child that does not show: the parent sends a request from the app; the School Admin of that school checks it
//   and puts the phone on the student's record.
//
// parents          the account (made the first time the code is right)
// parent_sessions  one per phone the parent signed in on; the app keeps a random token, the database only its hash
// parent_codes     sign-in codes (hash only), 10 minutes, 5 tries, 3 sends in 15 minutes per phone
// parent_requests  "my child is missing" requests to the School Admin
// student_guardians a second parent / guardian the School Admin linked to a student (after a request)
exports.up = async (knex) => {
  await knex.schema.createTable('parents', (t) => {
    t.increments('id');
    t.string('phone', 10).notNullable().unique();          // 0754123456
    t.string('full_name', 120);
    t.string('locale', 2).notNullable().defaultTo('sw');   // sw | en
    t.boolean('active').notNullable().defaultTo(true);     // switched off by the school: cannot sign in
    t.bigInteger('notices_seen').notNullable().defaultTo(0); // last parent_notices.id the parent has seen
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_login_at', { useTz: true });
  });
  await knex.raw(`ALTER TABLE parents ADD CONSTRAINT parents_chk CHECK (phone ~ '^0[67][0-9]{8}$' AND locale IN ('sw','en'))`);

  await knex.schema.createTable('parent_sessions', (t) => {
    t.string('id', 64).primary();                          // sha256 of the token the app keeps
    t.integer('parent_id').notNullable().references('id').inTable('parents').onDelete('CASCADE');
    t.string('device', 80);
    t.string('ip', 64);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.index(['parent_id']);
  });

  await knex.schema.createTable('parent_codes', (t) => {
    t.increments('id');
    t.string('phone', 10).notNullable();
    t.string('code_hash', 64).notNullable();               // sha256 of phone + code
    t.integer('attempts').notNullable().defaultTo(0);
    t.string('ip', 64);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('used_at', { useTz: true });
    t.index(['phone', 'created_at']);
  });

  await knex.schema.createTable('parent_requests', (t) => {
    t.increments('id');
    t.integer('parent_id').notNullable().references('id').inTable('parents').onDelete('RESTRICT');
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.string('child_name', 120).notNullable();
    t.string('admission_no', 20);
    t.string('class_name', 40);
    t.string('relation', 12).notNullable();                // mother | father | guardian
    t.string('note', 200);
    t.string('status', 10).notNullable().defaultTo('pending'); // pending | done | rejected
    t.integer('student_id').references('id').inTable('students');
    t.string('answer', 200);
    t.integer('decided_by').references('id').inTable('users');
    t.timestamp('decided_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['school_id', 'status']);
    t.index(['parent_id']);
  });
  await knex.raw(`ALTER TABLE parent_requests ADD CONSTRAINT parent_requests_chk CHECK (
    status IN ('pending','done','rejected') AND relation IN ('mother','father','guardian'))`);

  // A second parent / guardian added by the School Admin after a request (the first parent is students.parent_phone).
  await knex.schema.createTable('student_guardians', (t) => {
    t.increments('id');
    t.integer('student_id').notNullable().references('id').inTable('students').onDelete('RESTRICT');
    t.integer('parent_id').notNullable().references('id').inTable('parents').onDelete('RESTRICT');
    t.string('relation', 12).notNullable();
    t.integer('request_id').references('id').inTable('parent_requests');
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('added_by').notNullable().references('id').inTable('users');
    t.timestamp('added_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('removed_by').references('id').inTable('users');
    t.timestamp('removed_at', { useTz: true });
    t.index(['parent_id']);
  });
  await knex.raw(`ALTER TABLE student_guardians ADD CONSTRAINT student_guardians_chk CHECK (relation IN ('mother','father','guardian'))`);
  await knex.raw('CREATE UNIQUE INDEX student_guardians_uq ON student_guardians (student_id, parent_id) WHERE active');

  // Finding a parent's children by phone must be quick.
  await knex.raw('CREATE INDEX IF NOT EXISTS students_parent_phone_idx ON students (parent_phone) WHERE parent_phone IS NOT NULL');
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS students_parent_phone_idx');
  await knex.schema.dropTableIfExists('student_guardians');
  await knex.schema.dropTableIfExists('parent_requests');
  await knex.schema.dropTableIfExists('parent_codes');
  await knex.schema.dropTableIfExists('parent_sessions');
  await knex.schema.dropTableIfExists('parents');
};
