// ID cards, two-person purchase checks, school requisitions (2026-11-16, second part).
//
// ID cards: every student and staff account has an ID (QR code). The School Admin (Super Admin for administration
// staff) records when the card is handed over: issued / not issued. A lost, damaged or returned card is closed with a
// reason; then a new card can be issued (card 2, 3 ...). Nothing is deleted.
//
// Purchases: one store-keeper buys, ANOTHER store-keeper counts the goods with the accountant office:
//   pending (written) -> checked (second store-keeper counted) -> confirmed (Accountant / Assistant Accountant) -> main store.
//
// Requisitions (RQN.0001): a school needs something (e.g. paper reams):
//   Academic Master asks -> Head Master signs -> store-keeper signs (checks stock, cost) -> Manager signs
//   -> store-keeper buys (purchase, checked as above) or sends from the main store -> librarian confirms -> done.
exports.up = async (knex) => {
  // ---------- ID cards ----------
  await knex.schema.createTable('id_cards', (t) => {
    t.increments('id');
    t.string('kind', 8).notNullable();                             // student | staff
    t.integer('student_id').references('id').inTable('students').onDelete('RESTRICT');
    t.integer('user_id').references('id').inTable('users').onDelete('RESTRICT');
    t.integer('school_id').references('id').inTable('schools').onDelete('RESTRICT'); // NULL = administration staff
    t.integer('card_no').notNullable();                            // 1st, 2nd ... card of this person
    t.integer('issued_by').notNullable().references('id').inTable('users');
    t.timestamp('issued_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('note', 200);
    t.timestamp('ended_at', { useTz: true });
    t.integer('ended_by').references('id').inTable('users');
    t.string('end_reason', 10);                                    // lost | damaged | returned | mistake
    t.string('end_note', 200);
    t.index(['school_id', 'kind']);
  });
  await knex.raw(`ALTER TABLE id_cards ADD CONSTRAINT id_cards_chk CHECK (
    ((kind = 'student' AND student_id IS NOT NULL AND user_id IS NULL) OR (kind = 'staff' AND user_id IS NOT NULL AND student_id IS NULL))
    AND card_no > 0 AND (end_reason IS NULL OR end_reason IN ('lost','damaged','returned','mistake'))
    AND ((ended_at IS NULL) = (end_reason IS NULL)))`);
  // One card in use per person.
  await knex.raw('CREATE UNIQUE INDEX id_cards_student_open ON id_cards (student_id) WHERE ended_at IS NULL AND student_id IS NOT NULL');
  await knex.raw('CREATE UNIQUE INDEX id_cards_user_open ON id_cards (user_id) WHERE ended_at IS NULL AND user_id IS NOT NULL');
  await knex.raw('CREATE UNIQUE INDEX id_cards_student_no ON id_cards (student_id, card_no) WHERE student_id IS NOT NULL');
  await knex.raw('CREATE UNIQUE INDEX id_cards_user_no ON id_cards (user_id, card_no) WHERE user_id IS NOT NULL');

  // ---------- Requisitions ----------
  await knex.schema.createTable('requisitions', (t) => {
    t.increments('id');
    t.string('number', 20);                                        // RQN.0001
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.string('purpose', 300).notNullable();
    t.date('needed_by');
    t.string('status', 10).notNullable().defaultTo('head');
    t.integer('requested_by').notNullable().references('id').inTable('users');
    t.timestamp('requested_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // The three signatures
    t.integer('head_by').references('id').inTable('users'); t.timestamp('head_at', { useTz: true }); t.string('head_note', 300);
    t.integer('store_by').references('id').inTable('users'); t.timestamp('store_at', { useTz: true }); t.string('store_note', 300);
    t.integer('manager_by').references('id').inTable('users'); t.timestamp('manager_at', { useTz: true }); t.string('manager_note', 300);
    t.integer('rejected_by').references('id').inTable('users'); t.timestamp('rejected_at', { useTz: true }); t.string('reject_reason', 300);
    t.integer('delivery_id').references('id').inTable('deliveries');
    t.timestamp('done_at', { useTz: true });
    t.index(['school_id', 'status']);
    t.index(['status']);
  });
  await knex.raw(`ALTER TABLE requisitions ADD CONSTRAINT requisitions_chk CHECK (status IN
    ('head','store','manager','approved','buying','arrived','sent','done','rejected','withdrawn'))`);
  await knex.schema.createTable('requisition_lines', (t) => {
    t.increments('id');
    t.integer('requisition_id').notNullable().references('id').inTable('requisitions').onDelete('RESTRICT');
    t.integer('item_id').references('id').inTable('items').onDelete('RESTRICT'); // the store-keeper links it if the teacher typed a new thing
    t.string('item_name', 80).notNullable();
    t.string('unit', 12).notNullable().defaultTo('pc');
    t.integer('qty').notNullable();
    t.integer('approved_qty');                                     // the Manager may give fewer
    t.integer('est_cost');                                         // cost of one, written by the store-keeper
    t.integer('in_store');                                         // main store stock when the store-keeper signed
    t.string('note', 200);
    t.index(['requisition_id']);
  });
  await knex.raw(`ALTER TABLE requisition_lines ADD CONSTRAINT requisition_lines_chk CHECK (qty > 0
    AND (approved_qty IS NULL OR (approved_qty >= 0 AND approved_qty <= qty)) AND (est_cost IS NULL OR est_cost >= 0))`);

  // ---------- Purchases: second store-keeper count ----------
  await knex.schema.alterTable('purchases', (t) => {
    t.integer('checked_by').references('id').inTable('users');
    t.timestamp('checked_at', { useTz: true });
    t.string('check_note', 300);
    t.integer('requisition_id').references('id').inTable('requisitions');
  });
  await knex.raw('ALTER TABLE purchases DROP CONSTRAINT purchases_chk');
  await knex.raw(`ALTER TABLE purchases ADD CONSTRAINT purchases_chk CHECK (status IN ('pending','checked','confirmed','rejected') AND total >= 0)`);
  await knex.schema.alterTable('deliveries', (t) => { t.integer('requisition_id').references('id').inTable('requisitions'); });

  // ---------- Database guards ----------
  await knex.raw(`
    -- Purchases move forward only: pending -> checked -> confirmed, or rejected. Decided = never changed.
    CREATE FUNCTION musabe_purchase_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.status IN ('confirmed','rejected') THEN RAISE EXCEPTION 'This record is already decided and cannot be changed (purchases).'; END IF;
      IF OLD.status = 'checked' AND NEW.status = 'pending' THEN RAISE EXCEPTION 'A checked purchase cannot go back.'; END IF;
      IF OLD.checked_by IS NOT NULL AND NEW.checked_by IS DISTINCT FROM OLD.checked_by THEN RAISE EXCEPTION 'The check of a purchase cannot be changed.'; END IF;
      IF (NEW.supplier, NEW.invoice_no, NEW.bought_on, NEW.total, NEW.created_by, NEW.number)
         IS DISTINCT FROM (OLD.supplier, OLD.invoice_no, OLD.bought_on, OLD.total, OLD.created_by, OLD.number) THEN
        RAISE EXCEPTION 'A purchase cannot be changed after it is written.';
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER purchases_guard ON purchases;
    CREATE TRIGGER purchases_guard BEFORE UPDATE ON purchases FOR EACH ROW EXECUTE FUNCTION musabe_purchase_guard();

    -- An ID card row is written once; later only closed once (lost / returned ...).
    CREATE FUNCTION musabe_id_card_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.ended_at IS NOT NULL THEN RAISE EXCEPTION 'This ID card is already closed.'; END IF;
      IF (NEW.kind, NEW.student_id, NEW.user_id, NEW.school_id, NEW.card_no, NEW.issued_by, NEW.issued_at, NEW.note)
         IS DISTINCT FROM (OLD.kind, OLD.student_id, OLD.user_id, OLD.school_id, OLD.card_no, OLD.issued_by, OLD.issued_at, OLD.note) THEN
        RAISE EXCEPTION 'An issued ID card cannot be changed, only closed.';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER id_cards_guard BEFORE UPDATE ON id_cards FOR EACH ROW EXECUTE FUNCTION musabe_id_card_guard();
    CREATE TRIGGER id_cards_no_delete BEFORE DELETE ON id_cards FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();

    -- A requisition never goes back, and a finished one is never changed.
    CREATE FUNCTION musabe_requisition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE ord text[] := ARRAY['head','store','manager','approved','buying','arrived','sent','done'];
    BEGIN
      IF OLD.status IN ('done','rejected','withdrawn') THEN RAISE EXCEPTION 'This requisition is finished and cannot be changed.'; END IF;
      IF NEW.status NOT IN ('rejected','withdrawn') AND array_position(ord, NEW.status) < array_position(ord, OLD.status)
         AND NOT (OLD.status = 'sent' AND NEW.status IN ('approved','arrived'))  -- a cancelled delivery: send again
         AND NOT (OLD.status = 'buying' AND NEW.status = 'approved') THEN      -- every purchase rejected: buy again
        RAISE EXCEPTION 'A requisition cannot go back a step.';
      END IF;
      IF (NEW.school_id, NEW.requested_by, NEW.requested_at, NEW.purpose, NEW.number) IS DISTINCT FROM (OLD.school_id, OLD.requested_by, OLD.requested_at, OLD.purpose, OLD.number)
         OR (OLD.head_by IS NOT NULL AND NEW.head_by IS DISTINCT FROM OLD.head_by)
         OR (OLD.store_by IS NOT NULL AND NEW.store_by IS DISTINCT FROM OLD.store_by)
         OR (OLD.manager_by IS NOT NULL AND NEW.manager_by IS DISTINCT FROM OLD.manager_by) THEN
        RAISE EXCEPTION 'A signed requisition cannot be changed.';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER requisitions_guard BEFORE UPDATE ON requisitions FOR EACH ROW EXECUTE FUNCTION musabe_requisition_guard();
    CREATE TRIGGER requisitions_no_delete BEFORE DELETE ON requisitions FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER requisition_lines_no_delete BEFORE DELETE ON requisition_lines FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
  `);
};

exports.down = async (knex) => {
  if (await knex('purchases').where('status', 'checked').first()) throw new Error('Cannot roll back: some purchases are checked but not confirmed.');
  await knex.raw(`
    DROP TRIGGER purchases_guard ON purchases;
    CREATE TRIGGER purchases_guard BEFORE UPDATE ON purchases FOR EACH ROW EXECUTE FUNCTION musabe_decided_guard();
    DROP FUNCTION musabe_purchase_guard();`);
  await knex.schema.alterTable('deliveries', (t) => t.dropColumn('requisition_id'));
  await knex.schema.alterTable('purchases', (t) => { t.dropColumn('requisition_id'); t.dropColumn('check_note'); t.dropColumn('checked_at'); t.dropColumn('checked_by'); });
  await knex.raw('ALTER TABLE purchases DROP CONSTRAINT purchases_chk');
  await knex.raw(`ALTER TABLE purchases ADD CONSTRAINT purchases_chk CHECK (status IN ('pending','confirmed','rejected') AND total >= 0)`);
  await knex.schema.dropTable('requisition_lines');
  await knex.schema.dropTable('requisitions');
  await knex.schema.dropTable('id_cards');
  await knex.raw('DROP FUNCTION IF EXISTS musabe_requisition_guard(); DROP FUNCTION IF EXISTS musabe_id_card_guard();');
};
