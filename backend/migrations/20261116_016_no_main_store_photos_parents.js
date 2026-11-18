// No main store, ID photos, parent notices (2026-11-16, third part).
//
// - There is no main store: what the store-keeper buys or orders lands at the office and goes to ONE school.
//   Purchases get the school; when the accountant office confirms the count, a delivery to that school's library is
//   made at once, and the librarian checks it and signs (stock goes up then).
//   A purchase can be an ORDER (goods not here yet): it waits as "ordered" until the goods arrive and are counted.
// - Things that come back (books, instruments) get one QR code per piece when they are sent; the store-keeper sticks
//   them on. They wait as "coming" until the librarian confirms the delivery.
// - ID cards carry the person's photo (uploaded by the School Admin).
// - Parent notices: every time a student receives something from the library (sold or issued) a notice is kept for the
//   parents' mobile app (to be built). sent_at stays empty until the app has delivered it.
// - Receipts remember lines sold while the library had none, to print "given when it arrives".
exports.up = async (knex) => {
  await knex.schema.alterTable('purchases', (t) => {
    t.integer('school_id').references('id').inTable('schools').onDelete('RESTRICT'); // the school it goes to (NULL only for old main-store purchases)
    t.boolean('ordered').notNullable().defaultTo(false);                            // true = an order: goods not here when written
    t.date('expected_on');
    t.integer('delivery_id').references('id').inTable('deliveries');                // made when confirmed
  });
  await knex.raw('ALTER TABLE purchases DROP CONSTRAINT purchases_chk');
  await knex.raw(`ALTER TABLE purchases ADD CONSTRAINT purchases_chk CHECK (status IN ('pending','checked','confirmed','rejected') AND total >= 0)`);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION musabe_purchase_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.status IN ('confirmed','rejected') AND NOT (OLD.status = 'confirmed' AND OLD.delivery_id IS NULL AND NEW.delivery_id IS NOT NULL
         AND (NEW.status, NEW.decided_by, NEW.decided_at) IS NOT DISTINCT FROM (OLD.status, OLD.decided_by, OLD.decided_at)) THEN
        RAISE EXCEPTION 'This record is already decided and cannot be changed (purchases).';
      END IF;
      IF OLD.status = 'checked' AND NEW.status = 'pending' THEN RAISE EXCEPTION 'A checked purchase cannot go back.'; END IF;
      IF OLD.checked_by IS NOT NULL AND NEW.checked_by IS DISTINCT FROM OLD.checked_by THEN RAISE EXCEPTION 'The check of a purchase cannot be changed.'; END IF;
      IF (NEW.supplier, NEW.invoice_no, NEW.bought_on, NEW.total, NEW.created_by, NEW.number, NEW.school_id, NEW.ordered)
         IS DISTINCT FROM (OLD.supplier, OLD.invoice_no, OLD.bought_on, OLD.total, OLD.created_by, OLD.number, OLD.school_id, OLD.ordered) THEN
        RAISE EXCEPTION 'A purchase cannot be changed after it is written.';
      END IF;
      RETURN NEW;
    END $$;`);

  await knex.schema.alterTable('item_copies', (t) => {
    t.integer('delivery_line_id').references('id').inTable('delivery_lines');
  });
  await knex.raw('ALTER TABLE item_copies DROP CONSTRAINT item_copies_chk');
  await knex.raw(`ALTER TABLE item_copies ADD CONSTRAINT item_copies_chk CHECK (status IN ('coming','in','out','damaged','lost'))`);

  await knex.schema.createTable('photos', (t) => {
    t.increments('id');
    t.integer('student_id').references('id').inTable('students').onDelete('RESTRICT');
    t.integer('user_id').references('id').inTable('users').onDelete('RESTRICT');
    t.string('mime', 20).notNullable();
    t.binary('data').notNullable();                                  // a small JPEG made by the browser (about 30 KB)
    t.integer('updated_by').notNullable().references('id').inTable('users');
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE photos ADD CONSTRAINT photos_chk CHECK ((student_id IS NULL) <> (user_id IS NULL) AND mime IN ('image/jpeg','image/png') AND octet_length(data) <= 400000)`);
  await knex.raw('CREATE UNIQUE INDEX photos_student_uq ON photos (student_id) WHERE student_id IS NOT NULL');
  await knex.raw('CREATE UNIQUE INDEX photos_user_uq ON photos (user_id) WHERE user_id IS NOT NULL');

  await knex.schema.createTable('parent_notices', (t) => {
    t.bigIncrements('id');
    t.integer('student_id').notNullable().references('id').inTable('students').onDelete('RESTRICT');
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.string('kind', 12).notNullable();                              // given (sold item collected) | issued | returned | receipt
    t.string('title', 120).notNullable();
    t.string('body', 500).notNullable();
    t.string('ref', 30);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('sent_at', { useTz: true });                         // set by the parents' app when delivered
    t.index(['student_id', 'created_at']);
    t.index(['sent_at']);
  });
  await knex.raw(`ALTER TABLE parent_notices ADD CONSTRAINT parent_notices_chk CHECK (kind IN ('given','issued','returned','receipt'))`);
  await knex.raw(`CREATE TRIGGER parent_notices_no_delete BEFORE DELETE ON parent_notices FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();`);

  await knex.schema.alterTable('receipt_lines', (t) => { t.boolean('out_of_stock').notNullable().defaultTo(false); });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('receipt_lines', (t) => t.dropColumn('out_of_stock'));
  await knex.schema.dropTable('parent_notices');
  await knex.schema.dropTable('photos');
  await knex.raw(`UPDATE item_copies SET status = 'in' WHERE status = 'coming'`).catch(() => {});
  await knex.raw('ALTER TABLE item_copies DROP CONSTRAINT item_copies_chk');
  await knex.raw(`ALTER TABLE item_copies ADD CONSTRAINT item_copies_chk CHECK (status IN ('in','out','damaged','lost'))`);
  await knex.schema.alterTable('item_copies', (t) => t.dropColumn('delivery_line_id'));
  await knex.raw(`
    CREATE OR REPLACE FUNCTION musabe_purchase_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.status IN ('confirmed','rejected') THEN RAISE EXCEPTION 'This record is already decided and cannot be changed (purchases).'; END IF;
      IF OLD.status = 'checked' AND NEW.status = 'pending' THEN RAISE EXCEPTION 'A checked purchase cannot go back.'; END IF;
      IF OLD.checked_by IS NOT NULL AND NEW.checked_by IS DISTINCT FROM OLD.checked_by THEN RAISE EXCEPTION 'The check of a purchase cannot be changed.'; END IF;
      IF (NEW.supplier, NEW.invoice_no, NEW.bought_on, NEW.total, NEW.created_by, NEW.number)
         IS DISTINCT FROM (OLD.supplier, OLD.invoice_no, OLD.bought_on, OLD.total, OLD.created_by, OLD.number) THEN
        RAISE EXCEPTION 'A purchase cannot be changed after it is written.';
      END IF;
      RETURN NEW;
    END $$;`);
  await knex.schema.alterTable('purchases', (t) => { t.dropColumn('delivery_id'); t.dropColumn('expected_on'); t.dropColumn('ordered'); t.dropColumn('school_id'); });
};
