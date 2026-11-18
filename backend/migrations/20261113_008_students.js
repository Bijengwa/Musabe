// Step 1b: classes and students.
// - classes: each school names its own classes and streams (e.g. "PRIMARY TWO" + stream "A", "FORM ONE" + "EAST").
//   The system does not decide stream names. A class can be switched off but not deleted.
// - students: the school's Admission No. is the student's number (unique in each school).
//   PREM number (NECTA) is kept when there is one. Students are never deleted: a student who leaves is marked "left",
//   because receipts and (later) marks point to them.
// - student_imports: an Excel class list waits here until the School Admin checks it and approves it.
// - receipts.student_id now points to a real student (the bursar picks the student from the list).
exports.up = async (knex) => {
  await knex.schema.createTable('classes', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.string('name', 40).notNullable();        // PRIMARY TWO, FORM ONE ... as the school writes it
    t.string('stream', 30);                    // A, B, EAST ... or empty (the school decides)
    t.integer('sort').notNullable().defaultTo(0); // order in lists (lower first)
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('created_by').references('id').inTable('users');
    t.timestamps(true, true);
    t.index(['school_id', 'sort']);
  });
  await knex.raw(`CREATE UNIQUE INDEX classes_name_uq ON classes (school_id, lower(name), lower(coalesce(stream, '')))`);

  await knex.schema.createTable('students', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.string('admission_no', 20).notNullable();
    t.string('prem_no', 20);
    t.string('first_name', 40).notNullable();
    t.string('middle_name', 40);
    t.string('last_name', 40).notNullable();
    t.string('full_name', 130).notNullable(); // FIRST MIDDLE LAST, kept for search and receipts
    t.string('sex', 1).notNullable();         // M | F
    t.integer('class_id').references('id').inTable('classes').onDelete('RESTRICT');
    t.string('parent_name', 120);
    t.string('parent_phone', 10);
    t.string('status', 6).notNullable().defaultTo('active'); // active | left
    t.string('note', 200);
    t.integer('created_by').references('id').inTable('users');
    t.integer('updated_by').references('id').inTable('users');
    t.timestamps(true, true);
    t.index(['school_id', 'class_id']);
  });
  await knex.raw(`CREATE UNIQUE INDEX students_adm_uq ON students (school_id, lower(admission_no))`);
  await knex.raw(`CREATE INDEX students_name_idx ON students (school_id, lower(full_name))`);
  await knex.raw(`ALTER TABLE students ADD CONSTRAINT students_chk CHECK (
    sex IN ('M','F') AND status IN ('active','left') AND (parent_phone IS NULL OR parent_phone ~ '^0[67][0-9]{8}$'))`);

  await knex.schema.createTable('student_imports', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('class_id').notNullable().references('id').inTable('classes').onDelete('RESTRICT');
    t.string('file_name', 200).notNullable();
    t.binary('file').notNullable();
    t.string('status', 10).notNullable().defaultTo('pending'); // pending | approved | discarded
    t.jsonb('summary');
    t.integer('uploaded_by').notNullable().references('id').inTable('users');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('decided_by').references('id').inTable('users');
    t.timestamp('decided_at', { useTz: true });
    t.index(['school_id', 'status']);
  });

  await knex.raw('ALTER TABLE receipts ADD CONSTRAINT receipts_student_fk FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT');
  await knex.raw('CREATE INDEX receipts_student_idx ON receipts (student_id)');
};

exports.down = async (knex) => {
  await knex.raw('ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_student_fk');
  await knex.raw('DROP INDEX IF EXISTS receipts_student_idx');
  await knex.schema.dropTableIfExists('student_imports');
  await knex.schema.dropTableIfExists('students');
  await knex.schema.dropTableIfExists('classes');
};
