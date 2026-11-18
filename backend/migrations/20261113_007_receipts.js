// Library step 2: selling and giving.
// Flow: parent pays at the bursar -> receipt -> takes the receipt to the library -> librarian gives the items.
//
// - receipts: one per payment. Numbers run per school without gaps (EM-000001, BS-000001, GS-000001).
//   The number comes from schools.last_receipt_no, raised inside the same transaction as the receipt,
//   so a failed sale gives the number back (no gaps) and two bursars never get the same number.
// - receipt_lines: what was paid for. The item name and price are copied, so a later price change
//   never changes an old receipt.
// - gives / give_lines: each time the library hands items over (a receipt can be given in parts).
//   Stock levels (next step) will read give_lines to take the given items out of stock.
//
// Money rule: nobody can cancel, delete or change a receipt. The database itself refuses it (triggers below).
// Only these change after the sale: receipts.status / given_at / late_alerted_at and receipt_lines.given_qty.
exports.up = async (knex) => {
  await knex.schema.alterTable('schools', (t) => {
    t.integer('last_receipt_no').notNullable().defaultTo(0);
  });

  await knex.schema.createTable('receipts', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('no').notNullable();                       // 1, 2, 3 ... per school
    t.string('number', 20).notNullable().unique();       // EM-000001
    t.integer('student_id');                             // later, when students are in the system (Step 1b)
    t.string('student_name', 120).notNullable();
    t.string('student_class', 40).notNullable();
    t.string('gender', 5);                               // boy | girl (needed for items priced by gender)
    t.string('payer_name', 120);
    t.string('payer_phone', 10);
    t.string('method', 10).notNullable();                // cash | bank | mobile
    t.string('reference', 60);                           // bank slip or mobile money number
    t.integer('total').notNullable();                    // TSh, always paid in full
    t.string('note', 200);
    t.string('client_key', 40).unique();                 // sent by the sell screen: a double click never makes two receipts
    t.string('status', 8).notNullable().defaultTo('waiting'); // waiting | part | given
    t.integer('sold_by').notNullable().references('id').inTable('users');
    t.timestamp('sold_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('given_at', { useTz: true });            // when the last item was given
    t.timestamp('late_alerted_at', { useTz: true });     // when the "waiting too long" alert went out
    t.unique(['school_id', 'no']);
    t.index(['school_id', 'sold_at']);
    t.index(['status', 'sold_at']);
  });
  await knex.raw(`ALTER TABLE receipts ADD CONSTRAINT receipts_chk CHECK (
    no > 0 AND total > 0 AND method IN ('cash','bank','mobile') AND status IN ('waiting','part','given')
    AND (gender IS NULL OR gender IN ('boy','girl')) AND (payer_phone IS NULL OR payer_phone ~ '^0[67][0-9]{8}$'))`);

  await knex.schema.createTable('receipt_lines', (t) => {
    t.increments('id');
    t.integer('receipt_id').notNullable().references('id').inTable('receipts').onDelete('RESTRICT');
    t.integer('item_id').notNullable().references('id').inTable('items').onDelete('RESTRICT');
    t.string('item_name', 80).notNullable();
    t.string('category', 20).notNullable();
    t.integer('unit_price').notNullable();
    t.integer('qty').notNullable();
    t.integer('amount').notNullable();
    t.integer('given_qty').notNullable().defaultTo(0);
    t.index(['receipt_id']);
    t.index(['item_id']);
  });
  await knex.raw(`ALTER TABLE receipt_lines ADD CONSTRAINT receipt_lines_chk CHECK (
    unit_price > 0 AND qty > 0 AND amount = unit_price * qty AND given_qty >= 0 AND given_qty <= qty)`);

  await knex.schema.createTable('gives', (t) => {
    t.increments('id');
    t.integer('receipt_id').notNullable().references('id').inTable('receipts').onDelete('RESTRICT');
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.string('collected_by', 120);                       // who took the items (parent, student)
    t.string('note', 200);
    t.integer('given_by').notNullable().references('id').inTable('users');
    t.timestamp('at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['receipt_id']);
    t.index(['school_id', 'at']);
  });
  await knex.schema.createTable('give_lines', (t) => {
    t.increments('id');
    t.integer('give_id').notNullable().references('id').inTable('gives').onDelete('RESTRICT');
    t.integer('receipt_line_id').notNullable().references('id').inTable('receipt_lines').onDelete('RESTRICT');
    t.integer('item_id').notNullable().references('id').inTable('items').onDelete('RESTRICT');
    t.integer('qty').notNullable();
    t.index(['give_id']);
    t.index(['item_id']);
  });
  await knex.raw('ALTER TABLE give_lines ADD CONSTRAINT give_lines_qty_chk CHECK (qty > 0)');

  // The database refuses to delete or change money records, whoever asks.
  await knex.raw(`
    CREATE FUNCTION musabe_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Receipts and given items are never deleted (%).', TG_TABLE_NAME; END $$;

    CREATE FUNCTION musabe_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF (NEW.school_id, NEW.no, NEW.number, NEW.student_id, NEW.student_name, NEW.student_class, NEW.gender,
          NEW.payer_name, NEW.payer_phone, NEW.method, NEW.reference, NEW.total, NEW.note, NEW.client_key, NEW.sold_by, NEW.sold_at)
         IS DISTINCT FROM
         (OLD.school_id, OLD.no, OLD.number, OLD.student_id, OLD.student_name, OLD.student_class, OLD.gender,
          OLD.payer_name, OLD.payer_phone, OLD.method, OLD.reference, OLD.total, OLD.note, OLD.client_key, OLD.sold_by, OLD.sold_at) THEN
        RAISE EXCEPTION 'A receipt cannot be changed after it is written.';
      END IF;
      RETURN NEW;
    END $$;

    CREATE FUNCTION musabe_receipt_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF (NEW.receipt_id, NEW.item_id, NEW.item_name, NEW.category, NEW.unit_price, NEW.qty, NEW.amount)
         IS DISTINCT FROM (OLD.receipt_id, OLD.item_id, OLD.item_name, OLD.category, OLD.unit_price, OLD.qty, OLD.amount) THEN
        RAISE EXCEPTION 'A receipt line cannot be changed after it is written.';
      END IF;
      IF NEW.given_qty < OLD.given_qty THEN RAISE EXCEPTION 'Given items cannot be taken back.'; END IF;
      RETURN NEW;
    END $$;

    CREATE FUNCTION musabe_no_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Given items cannot be changed (%).', TG_TABLE_NAME; END $$;

    CREATE TRIGGER receipts_no_delete BEFORE DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER receipt_lines_no_delete BEFORE DELETE ON receipt_lines FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER gives_no_delete BEFORE DELETE ON gives FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER give_lines_no_delete BEFORE DELETE ON give_lines FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER receipts_guard BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION musabe_receipt_guard();
    CREATE TRIGGER receipt_lines_guard BEFORE UPDATE ON receipt_lines FOR EACH ROW EXECUTE FUNCTION musabe_receipt_line_guard();
    CREATE TRIGGER gives_no_update BEFORE UPDATE ON gives FOR EACH ROW EXECUTE FUNCTION musabe_no_update();
    CREATE TRIGGER give_lines_no_update BEFORE UPDATE ON give_lines FOR EACH ROW EXECUTE FUNCTION musabe_no_update();
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('give_lines');
  await knex.schema.dropTableIfExists('gives');
  await knex.schema.dropTableIfExists('receipt_lines');
  await knex.schema.dropTableIfExists('receipts');
  await knex.raw(`DROP FUNCTION IF EXISTS musabe_no_delete(); DROP FUNCTION IF EXISTS musabe_receipt_guard();
    DROP FUNCTION IF EXISTS musabe_receipt_line_guard(); DROP FUNCTION IF EXISTS musabe_no_update();`);
  await knex.schema.alterTable('schools', (t) => t.dropColumn('last_receipt_no'));
};
