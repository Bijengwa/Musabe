// 056 (2026-11-26): B-SMART Academia (CRDB). The school makes one control number per student there; the parent pays on it.
// The Finance Office uploads the two B-SMART reports (Fee details, Payments). Nothing is saved until a second look (approve).
// - bsmart_files: an uploaded report waits here (pending) until approved or discarded.
// - bsmart_bills: one control number, its student and its amount (the full-year fee as made in B-SMART).
// - bsmart_payments: one payment on a control number. Only added, never changed (the receipt number is unique per school).
// - students.bsmart_adm: the admission number B-SMART uses for the student, when it is not the same as ours.
exports.up = async (knex) => {
  await knex.schema.createTable('bsmart_files', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('year').notNullable();
    t.string('kind', 10).notNullable(); // fees | payments
    t.string('file_name', 200).notNullable();
    t.string('status', 10).notNullable().defaultTo('pending'); // pending | approved | discarded
    t.jsonb('rows').notNullable();
    t.jsonb('summary').notNullable();
    t.integer('uploaded_by').notNullable().references('id').inTable('users');
    t.integer('decided_by').references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('decided_at');
  });
  await knex.raw(`ALTER TABLE bsmart_files ADD CONSTRAINT bsmart_files_chk CHECK (kind IN ('fees','payments') AND status IN ('pending','approved','discarded'))`);

  await knex.schema.createTable('bsmart_bills', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('year').notNullable();
    t.string('control_no', 30).notNullable();
    t.string('bsmart_adm', 30).notNullable();
    t.string('student_name', 150).notNullable();
    t.string('class_text', 60);
    t.integer('amount').notNullable();
    t.date('made_on');
    t.integer('student_id').references('id').inTable('students').onDelete('SET NULL');
    t.integer('file_id').references('id').inTable('bsmart_files');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['school_id', 'control_no']);
    t.index(['school_id', 'year', 'student_id']);
  });
  await knex.raw('ALTER TABLE bsmart_bills ADD CONSTRAINT bsmart_bills_chk CHECK (amount >= 0)');

  await knex.schema.createTable('bsmart_payments', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('year').notNullable();
    t.string('control_no', 30).notNullable();
    t.string('bsmart_adm', 30);
    t.string('receipt_no', 40).notNullable();
    t.integer('amount').notNullable();
    t.date('paid_on');
    t.string('channel', 20);
    t.string('payer', 120);
    t.string('term', 20);
    t.integer('student_id').references('id').inTable('students').onDelete('SET NULL');
    t.integer('file_id').references('id').inTable('bsmart_files');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['school_id', 'receipt_no']);
    t.index(['school_id', 'year', 'student_id']);
    t.index(['school_id', 'control_no']);
  });
  await knex.raw('ALTER TABLE bsmart_payments ADD CONSTRAINT bsmart_payments_chk CHECK (amount > 0)');
  // Money rows are only added: no change, no delete (same guard as fee_payments).
  await knex.raw(`CREATE FUNCTION bsmart_payments_guard() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'B-SMART payments cannot be deleted'; END IF;
      IF NEW.control_no <> OLD.control_no OR NEW.amount <> OLD.amount OR NEW.receipt_no <> OLD.receipt_no OR NEW.school_id <> OLD.school_id THEN
        RAISE EXCEPTION 'B-SMART payments cannot be changed'; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql`);
  await knex.raw('CREATE TRIGGER bsmart_payments_guard BEFORE UPDATE OR DELETE ON bsmart_payments FOR EACH ROW EXECUTE FUNCTION bsmart_payments_guard()');

  await knex.schema.alterTable('students', (t) => { t.string('bsmart_adm', 30).nullable(); });
  await knex.raw(`CREATE INDEX students_bsmart_idx ON students (school_id, lower(bsmart_adm))`);
};
exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS students_bsmart_idx');
  await knex.schema.alterTable('students', (t) => { t.dropColumn('bsmart_adm'); });
  await knex.raw('DROP TRIGGER IF EXISTS bsmart_payments_guard ON bsmart_payments');
  await knex.raw('DROP FUNCTION IF EXISTS bsmart_payments_guard()');
  await knex.schema.dropTableIfExists('bsmart_payments');
  await knex.schema.dropTableIfExists('bsmart_bills');
  await knex.schema.dropTableIfExists('bsmart_files');
};
