// 047 (2026-11-24): school fees (Finance Office).
// - fee_lines: the fee structure. The Finance Manager writes lines (school, year, term, class level, day/boarding, name, amount);
//   the Manager or the Director approves them. An approved line is never changed: a new amount is a NEW line that takes over
//   when it is approved (the old one is closed, with the date).
// - fee_payments: what the Bursar receives for a student (cash, bank slip, mobile money). The Accountant confirms each one.
//   Numbers run per school: BS/FEE.0001. Never deleted.
// - students.residence: day | boarding (decides which fees apply).
exports.up = async (knex) => {
  await knex.schema.alterTable('students', (t) => { t.string('residence', 8); });
  await knex.raw(`ALTER TABLE students ADD CONSTRAINT students_residence_chk CHECK (residence IS NULL OR residence IN ('day','boarding'))`);

  await knex.schema.createTable('fee_lines', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.integer('year').notNullable();
    t.integer('term').notNullable().defaultTo(0);              // 0 = whole year, 1 to 3 = that term
    t.string('level', 10);                                      // class level key (P1, F2 ...); NULL = every class of the school
    t.string('residence', 8).notNullable().defaultTo('all');   // all | day | boarding
    t.string('name', 60).notNullable();                         // TUITION, BOARDING, EXAMS ...
    t.integer('amount').notNullable();
    t.string('status', 10).notNullable().defaultTo('draft');   // draft | approved | withdrawn | closed
    t.integer('created_by').notNullable().references('id').inTable('users');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('approved_by').references('id').inTable('users');
    t.timestamp('approved_at', { useTz: true });
    t.integer('closed_by_line').references('id').inTable('fee_lines');   // the line that took over
    t.timestamp('closed_at', { useTz: true });
    t.index(['school_id', 'year', 'status']);
  });
  await knex.raw(`ALTER TABLE fee_lines ADD CONSTRAINT fee_lines_chk CHECK (amount > 0 AND term BETWEEN 0 AND 3 AND year BETWEEN 2020 AND 2100
    AND residence IN ('all','day','boarding') AND status IN ('draft','approved','withdrawn','closed'))`);

  await knex.schema.createTable('fee_payments', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.integer('seq').notNullable();
    t.string('number', 30).notNullable();
    t.integer('student_id').notNullable().references('id').inTable('students');
    t.string('student_name', 130).notNullable();
    t.integer('year').notNullable();
    t.integer('term').notNullable().defaultTo(0);
    t.integer('amount').notNullable();
    t.string('method', 8).notNullable();                        // cash | bank | mobile
    t.string('reference', 60);                                  // bank slip or mobile money transaction number
    t.date('paid_on').notNullable();
    t.string('payer', 120);
    t.string('note', 200);
    t.string('status', 10).notNullable().defaultTo('recorded'); // recorded | confirmed
    t.integer('received_by').notNullable().references('id').inTable('users');
    t.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('confirmed_by').references('id').inTable('users');
    t.timestamp('confirmed_at', { useTz: true });
    t.index(['school_id', 'student_id', 'year']);
    t.index(['school_id', 'status']);
  });
  await knex.raw(`ALTER TABLE fee_payments ADD CONSTRAINT fee_payments_chk CHECK (amount > 0 AND method IN ('cash','bank','mobile') AND status IN ('recorded','confirmed'))`);
  await knex.raw('CREATE UNIQUE INDEX fee_payments_seq_uq ON fee_payments (school_id, seq)');
  await knex.raw('CREATE UNIQUE INDEX fee_payments_number_uq ON fee_payments (number)');
  // The same bank slip or mobile money number cannot be used twice in one school.
  await knex.raw(`CREATE UNIQUE INDEX fee_payments_ref_uq ON fee_payments (school_id, upper(reference)) WHERE reference IS NOT NULL AND method <> 'cash'`);
  await knex.raw(`CREATE FUNCTION musabe_fee_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Fee payments are never deleted.'; END IF;
      IF (NEW.school_id, NEW.number, NEW.student_id, NEW.year, NEW.term, NEW.amount, NEW.method, NEW.reference, NEW.paid_on, NEW.received_by)
         IS DISTINCT FROM (OLD.school_id, OLD.number, OLD.student_id, OLD.year, OLD.term, OLD.amount, OLD.method, OLD.reference, OLD.paid_on, OLD.received_by) THEN
        RAISE EXCEPTION 'A fee payment cannot be changed after it is written.';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER fee_payments_guard BEFORE UPDATE OR DELETE ON fee_payments FOR EACH ROW EXECUTE FUNCTION musabe_fee_payment_guard();`);
};

exports.down = async (knex) => {
  await knex.raw('DROP TRIGGER IF EXISTS fee_payments_guard ON fee_payments; DROP FUNCTION IF EXISTS musabe_fee_payment_guard()');
  await knex.schema.dropTableIfExists('fee_payments');
  await knex.schema.dropTableIfExists('fee_lines');
  await knex.raw('ALTER TABLE students DROP CONSTRAINT IF EXISTS students_residence_chk');
  await knex.schema.alterTable('students', (t) => t.dropColumn('residence'));
};
