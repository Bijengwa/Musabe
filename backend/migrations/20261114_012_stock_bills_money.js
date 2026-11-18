// Library step 2 (rest): stock, deliveries, stock requests, damaged / lost, control numbers, daily money.
//
// Stock
// - stock_levels: how many of each item each school's library holds now (+ the reorder level).
// - stock_moves: every change, never edited or deleted. in = delivery confirmed, give = handed to a parent,
//   damage = damaged / lost approved. `balance` is the level after the move, so the history reads like a stock card.
// - deliveries: the finance office sends stock to a library; the librarian confirms each line (what really arrived).
//   Stock goes up only when the librarian confirms.
// - stock_requests: the librarian asks for stock; the finance office sends it (a delivery) or declines.
// - damages: the librarian reports damaged or lost items; only the Finance Manager or the Accountant approves.
//   Stock goes down only when approved.
//
// Control numbers (bills)
// - The bursar makes a control number for the items. The parent pays at the bank or by mobile money with it.
//   When the money is seen, the bursar or the accountant marks it paid: the receipt is written then
//   (same gap-free receipt book, method "control"). An unpaid control number can be cancelled; a receipt never.
//
// Daily money
// - The accountant checks each bursar's money for a day against the receipts and records it (never changed).
exports.up = async (knex) => {
  // ---------- Stock ----------
  await knex.schema.createTable('stock_levels', (t) => {
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('item_id').notNullable().references('id').inTable('items').onDelete('RESTRICT');
    t.integer('qty').notNullable().defaultTo(0);
    t.integer('reorder_level').notNullable().defaultTo(0); // at or below this, the item is "low"
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['school_id', 'item_id']);
  });
  await knex.raw('ALTER TABLE stock_levels ADD CONSTRAINT stock_levels_chk CHECK (qty >= 0 AND reorder_level >= 0)');

  await knex.schema.createTable('stock_moves', (t) => {
    t.bigIncrements('id');
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('item_id').notNullable().references('id').inTable('items').onDelete('RESTRICT');
    t.string('kind', 8).notNullable();          // in | give | damage
    t.integer('change').notNullable();          // + in, - out
    t.integer('balance').notNullable();         // level after this move
    t.string('ref', 20);                        // DLV.0003, REC.0012, DMG.0004
    t.integer('ref_id');
    t.string('note', 200);
    t.integer('by').references('id').inTable('users');
    t.timestamp('at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['school_id', 'item_id', 'at']);
    t.index(['school_id', 'at']);
  });
  await knex.raw(`ALTER TABLE stock_moves ADD CONSTRAINT stock_moves_chk CHECK (change <> 0 AND balance >= 0 AND kind IN ('in','give','damage'))`);

  await knex.schema.createTable('stock_requests', (t) => {
    t.increments('id');
    t.string('number', 20);                     // REQ.0001
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.string('note', 300);
    t.string('status', 10).notNullable().defaultTo('pending'); // pending | sent | declined | withdrawn
    t.integer('requested_by').notNullable().references('id').inTable('users');
    t.timestamp('requested_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('answered_by').references('id').inTable('users');
    t.timestamp('answered_at', { useTz: true });
    t.string('answer_note', 300);
    t.index(['school_id', 'status']);
  });
  await knex.raw(`ALTER TABLE stock_requests ADD CONSTRAINT stock_requests_chk CHECK (status IN ('pending','sent','declined','withdrawn'))`);
  await knex.schema.createTable('stock_request_lines', (t) => {
    t.increments('id');
    t.integer('request_id').notNullable().references('id').inTable('stock_requests').onDelete('CASCADE');
    t.integer('item_id').notNullable().references('id').inTable('items').onDelete('RESTRICT');
    t.string('item_name', 80).notNullable();
    t.integer('qty').notNullable();
    t.integer('sent_qty').notNullable().defaultTo(0);
    t.index(['request_id']);
  });
  await knex.raw('ALTER TABLE stock_request_lines ADD CONSTRAINT stock_request_lines_chk CHECK (qty > 0 AND sent_qty >= 0)');

  await knex.schema.createTable('deliveries', (t) => {
    t.increments('id');
    t.string('number', 20);                     // DLV.0001
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('request_id').references('id').inTable('stock_requests');
    t.string('note', 300);
    t.string('status', 10).notNullable().defaultTo('sent'); // sent | received | cancelled
    t.integer('sent_by').notNullable().references('id').inTable('users');
    t.timestamp('sent_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('received_at', { useTz: true });
    t.integer('cancelled_by').references('id').inTable('users');
    t.timestamp('cancelled_at', { useTz: true });
    t.index(['school_id', 'status']);
  });
  await knex.raw(`ALTER TABLE deliveries ADD CONSTRAINT deliveries_chk CHECK (status IN ('sent','received','cancelled'))`);
  await knex.schema.createTable('delivery_lines', (t) => {
    t.increments('id');
    t.integer('delivery_id').notNullable().references('id').inTable('deliveries').onDelete('RESTRICT');
    t.integer('item_id').notNullable().references('id').inTable('items').onDelete('RESTRICT');
    t.string('item_name', 80).notNullable();
    t.integer('qty').notNullable();             // sent
    t.integer('received_qty');                  // null until the librarian confirms this line
    t.string('note', 200);                      // e.g. "2 torn", "3 missing"
    t.integer('confirmed_by').references('id').inTable('users');
    t.timestamp('confirmed_at', { useTz: true });
    t.index(['delivery_id']);
  });
  await knex.raw(`ALTER TABLE delivery_lines ADD CONSTRAINT delivery_lines_chk CHECK (
    qty > 0 AND (received_qty IS NULL OR (received_qty >= 0 AND received_qty <= qty)))`);

  await knex.schema.createTable('damages', (t) => {
    t.increments('id');
    t.string('number', 20);                     // DMG.0001
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('item_id').notNullable().references('id').inTable('items').onDelete('RESTRICT');
    t.string('item_name', 80).notNullable();
    t.integer('qty').notNullable();
    t.string('kind', 8).notNullable();          // damaged | lost
    t.string('reason', 300).notNullable();
    t.string('status', 10).notNullable().defaultTo('pending'); // pending | approved | rejected
    t.integer('reported_by').notNullable().references('id').inTable('users');
    t.timestamp('reported_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('decided_by').references('id').inTable('users');
    t.timestamp('decided_at', { useTz: true });
    t.string('decision_note', 300);
    t.index(['school_id', 'status']);
  });
  await knex.raw(`ALTER TABLE damages ADD CONSTRAINT damages_chk CHECK (
    qty > 0 AND kind IN ('damaged','lost') AND status IN ('pending','approved','rejected'))`);

  // ---------- Control numbers ----------
  await knex.schema.alterTable('schools', (t) => { t.integer('last_bill_no').notNullable().defaultTo(0); });
  await knex.schema.createTable('bills', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('no').notNullable();
    t.string('control_no', 12).notNullable().unique();
    t.integer('student_id');
    t.string('student_name', 120).notNullable();
    t.string('student_class', 40).notNullable();
    t.string('gender', 5);
    t.string('payer_name', 120);
    t.string('payer_phone', 10);
    t.integer('total').notNullable();
    t.string('note', 200);
    t.string('client_key', 40).unique();
    t.string('status', 10).notNullable().defaultTo('pending'); // pending | paid | cancelled
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.integer('created_by').notNullable().references('id').inTable('users');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('paid_ref', 60);                   // bank / mobile money transaction number
    t.integer('paid_by').references('id').inTable('users');
    t.timestamp('paid_at', { useTz: true });
    t.integer('receipt_id');
    t.integer('cancelled_by').references('id').inTable('users');
    t.timestamp('cancelled_at', { useTz: true });
    t.string('cancel_reason', 200);
    t.unique(['school_id', 'no']);
    t.index(['school_id', 'status']);
  });
  await knex.raw(`ALTER TABLE bills ADD CONSTRAINT bills_chk CHECK (
    total > 0 AND status IN ('pending','paid','cancelled') AND control_no ~ '^[0-9]{12}$'
    AND (payer_phone IS NULL OR payer_phone ~ '^0[67][0-9]{8}$') AND (gender IS NULL OR gender IN ('boy','girl')))`);
  await knex.schema.createTable('bill_lines', (t) => {
    t.increments('id');
    t.integer('bill_id').notNullable().references('id').inTable('bills').onDelete('RESTRICT');
    t.integer('item_id').notNullable().references('id').inTable('items').onDelete('RESTRICT');
    t.string('item_name', 80).notNullable();
    t.string('category', 20).notNullable();
    t.integer('unit_price').notNullable();
    t.integer('qty').notNullable();
    t.integer('amount').notNullable();
    t.index(['bill_id']);
  });
  await knex.raw('ALTER TABLE bill_lines ADD CONSTRAINT bill_lines_chk CHECK (unit_price > 0 AND qty > 0 AND amount = unit_price * qty)');

  // Receipts: paid by control number, linked to the bill. The receipt guard now also locks bill_id.
  await knex.schema.alterTable('receipts', (t) => { t.integer('bill_id').unique().references('id').inTable('bills'); });
  await knex.raw('ALTER TABLE receipts DROP CONSTRAINT receipts_chk');
  await knex.raw(`ALTER TABLE receipts ADD CONSTRAINT receipts_chk CHECK (
    no > 0 AND total > 0 AND method IN ('cash','bank','mobile','control') AND status IN ('waiting','part','given')
    AND (gender IS NULL OR gender IN ('boy','girl')) AND (payer_phone IS NULL OR payer_phone ~ '^0[67][0-9]{8}$'))`);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION musabe_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF (NEW.school_id, NEW.no, NEW.number, NEW.student_id, NEW.student_name, NEW.student_class, NEW.gender,
          NEW.payer_name, NEW.payer_phone, NEW.method, NEW.reference, NEW.total, NEW.note, NEW.client_key, NEW.sold_by, NEW.sold_at, NEW.bill_id)
         IS DISTINCT FROM
         (OLD.school_id, OLD.no, OLD.number, OLD.student_id, OLD.student_name, OLD.student_class, OLD.gender,
          OLD.payer_name, OLD.payer_phone, OLD.method, OLD.reference, OLD.total, OLD.note, OLD.client_key, OLD.sold_by, OLD.sold_at, OLD.bill_id) THEN
        RAISE EXCEPTION 'A receipt cannot be changed after it is written.';
      END IF;
      RETURN NEW;
    END $$;`);

  // A paid bill stays paid: nothing on it changes, and it is never deleted.
  await knex.raw(`
    CREATE FUNCTION musabe_bill_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.status = 'paid' THEN RAISE EXCEPTION 'A paid control number cannot be changed.'; END IF;
      IF OLD.status = 'cancelled' THEN RAISE EXCEPTION 'A cancelled control number cannot be changed.'; END IF;
      IF (NEW.school_id, NEW.no, NEW.control_no, NEW.total, NEW.student_name, NEW.created_by, NEW.created_at)
         IS DISTINCT FROM (OLD.school_id, OLD.no, OLD.control_no, OLD.total, OLD.student_name, OLD.created_by, OLD.created_at) THEN
        RAISE EXCEPTION 'A control number cannot be changed after it is made.';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER bills_guard BEFORE UPDATE ON bills FOR EACH ROW EXECUTE FUNCTION musabe_bill_guard();
    CREATE TRIGGER bills_no_delete BEFORE DELETE ON bills FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER bill_lines_no_delete BEFORE DELETE ON bill_lines FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER bill_lines_no_update BEFORE UPDATE ON bill_lines FOR EACH ROW EXECUTE FUNCTION musabe_no_update();

    -- Stock history is never changed or deleted.
    CREATE TRIGGER stock_moves_no_delete BEFORE DELETE ON stock_moves FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER stock_moves_no_update BEFORE UPDATE ON stock_moves FOR EACH ROW EXECUTE FUNCTION musabe_no_update();

    -- A confirmed delivery line stays as confirmed.
    CREATE FUNCTION musabe_delivery_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF (NEW.delivery_id, NEW.item_id, NEW.qty) IS DISTINCT FROM (OLD.delivery_id, OLD.item_id, OLD.qty) THEN
        RAISE EXCEPTION 'A delivery line cannot be changed after it is sent.';
      END IF;
      IF OLD.received_qty IS NOT NULL THEN RAISE EXCEPTION 'This line is already confirmed.'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER delivery_lines_guard BEFORE UPDATE ON delivery_lines FOR EACH ROW EXECUTE FUNCTION musabe_delivery_line_guard();
    CREATE TRIGGER delivery_lines_no_delete BEFORE DELETE ON delivery_lines FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER deliveries_no_delete BEFORE DELETE ON deliveries FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER damages_no_delete BEFORE DELETE ON damages FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
  `);

  // ---------- Daily money ----------
  await knex.schema.createTable('money_checks', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('bursar_id').notNullable().references('id').inTable('users');
    t.date('day').notNullable();
    t.integer('receipts').notNullable();        // how many receipts that day
    t.bigInteger('system_total').notNullable(); // what the receipts say
    t.bigInteger('cash').notNullable();
    t.bigInteger('bank').notNullable();
    t.bigInteger('mobile').notNullable();
    t.bigInteger('control').notNullable();
    t.bigInteger('cash_counted').notNullable(); // cash the accountant received / saw banked
    t.string('bank_slip', 60);                  // slip of the cash banked
    t.string('note', 300);
    t.string('result', 6).notNullable();        // ok | short | over
    t.integer('checked_by').notNullable().references('id').inTable('users');
    t.timestamp('checked_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['bursar_id', 'day']);
    t.index(['school_id', 'day']);
  });
  await knex.raw(`ALTER TABLE money_checks ADD CONSTRAINT money_checks_chk CHECK (result IN ('ok','short','over') AND cash_counted >= 0)`);
  await knex.raw(`
    CREATE TRIGGER money_checks_no_delete BEFORE DELETE ON money_checks FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER money_checks_no_update BEFORE UPDATE ON money_checks FOR EACH ROW EXECUTE FUNCTION musabe_no_update();
  `);
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('money_checks');
  await knex.schema.alterTable('receipts', (t) => t.dropColumn('bill_id'));
  await knex.raw('ALTER TABLE receipts DROP CONSTRAINT receipts_chk');
  await knex.raw(`ALTER TABLE receipts ADD CONSTRAINT receipts_chk CHECK (
    no > 0 AND total > 0 AND method IN ('cash','bank','mobile') AND status IN ('waiting','part','given')
    AND (gender IS NULL OR gender IN ('boy','girl')) AND (payer_phone IS NULL OR payer_phone ~ '^0[67][0-9]{8}$'))`);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION musabe_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF (NEW.school_id, NEW.no, NEW.number, NEW.student_id, NEW.student_name, NEW.student_class, NEW.gender,
          NEW.payer_name, NEW.payer_phone, NEW.method, NEW.reference, NEW.total, NEW.note, NEW.client_key, NEW.sold_by, NEW.sold_at)
         IS DISTINCT FROM
         (OLD.school_id, OLD.no, OLD.number, OLD.student_id, OLD.student_name, OLD.student_class, OLD.gender,
          OLD.payer_name, OLD.payer_phone, OLD.method, OLD.reference, OLD.total, OLD.note, OLD.client_key, OLD.sold_by, OLD.sold_at) THEN
        RAISE EXCEPTION 'A receipt cannot be changed after it is written.';
      END IF;
      RETURN NEW;
    END $$;`);
  for (const t of ['bill_lines', 'bills', 'damages', 'delivery_lines', 'deliveries', 'stock_request_lines', 'stock_requests', 'stock_moves', 'stock_levels']) {
    await knex.schema.dropTableIfExists(t);
  }
  await knex.raw('DROP FUNCTION IF EXISTS musabe_bill_guard(); DROP FUNCTION IF EXISTS musabe_delivery_line_guard();');
  await knex.schema.alterTable('schools', (t) => t.dropColumn('last_bill_no'));
};
