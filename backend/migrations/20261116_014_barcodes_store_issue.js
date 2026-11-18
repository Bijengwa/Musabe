// Barcodes, the main store, issuing by scanning, purchases and the weekly stock check (2026-11-16).
//
// Everything bought and used in the schools has a barcode and is given out by scanning it:
// - Things that do not come back (uniform, reams, rice): ONE code per item. System code MI000012, and the maker's own
//   barcode can be added (item_barcodes).
// - Things that come back (text books, laboratory instruments): EVERY PIECE has its own code MC000345 (item_copies),
//   so the system knows who has which one.
// - People: every student (MS000123) and staff account (MU000045) has an ID code, scanned when receiving and returning.
//   These codes are made from the row id, so nothing is stored for them.
//
// Main store: the store-keeper buys from the shops and writes a purchase; the Accountant or the Assistant Accountant
// confirms it; only then it is in the main store stock. Main store rows have school_id NULL in stock_levels,
// stock_moves, issues, stock_counts and item_copies.
//
// Issues: what is given out and not sold (books for a term, instruments for a lesson, food to the kitchen).
// Weekly check: the keeper counts, the accountant office confirms, differences correct the stock ("count" move).
const CATEGORIES = ['uniform', 'book', 'exercise_book', 'stationery', 'laboratory', 'food', 'cleaning', 'equipment', 'other'];
const OLD_CATEGORIES = ['uniform', 'book', 'exercise_book', 'stationery', 'other'];
const ROLES = ['super', 'director', 'adirector', 'manager', 'fm', 'afm', 'acc', 'aacc', 'storekeeper', 'sadmin', 'head', 'acad', 'teacher', 'bursar', 'librarian'];
const ADMIN = ['super', 'director', 'adirector', 'manager', 'fm', 'afm', 'acc', 'aacc', 'storekeeper'];
const SCHOOL = ['sadmin', 'head', 'acad', 'teacher', 'bursar', 'librarian'];
const list = (a) => a.map((x) => `'${x}'`).join(',');

exports.up = async (knex) => {
  // ---------- New account: Store-keeper (administration) ----------
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_chk');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_school_chk');
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN (${list(ROLES)}))`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_school_chk CHECK (
    (role IN (${list(ADMIN)}) AND school_id IS NULL) OR (role IN (${list(SCHOOL)}) AND school_id IS NOT NULL))`);

  // ---------- Items: unit, comes back or not, sold or only used ----------
  await knex.schema.alterTable('items', (t) => {
    t.string('unit', 12).notNullable().defaultTo('pc');        // pc, pair, kg, bag, litre, ream, box ...
    t.boolean('returnable').notNullable().defaultTo(false);    // true = comes back after use: every piece has its own barcode
    t.boolean('sellable').notNullable().defaultTo(true);       // false = bought and used by the school, never sold (no price needed)
  });
  await knex.raw('ALTER TABLE items DROP CONSTRAINT items_category_chk');
  await knex.raw(`ALTER TABLE items ADD CONSTRAINT items_category_chk CHECK (category IN (${list(CATEGORIES)}))`);

  // Extra barcodes of an item: the maker's own code printed on the packet (EAN, ISBN ...).
  await knex.schema.createTable('item_barcodes', (t) => {
    t.string('code', 40).primary();
    t.integer('item_id').notNullable().references('id').inTable('items').onDelete('RESTRICT');
    t.integer('added_by').references('id').inTable('users');
    t.timestamp('added_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['item_id']);
  });
  await knex.raw(`ALTER TABLE item_barcodes ADD CONSTRAINT item_barcodes_chk CHECK (code ~ '^[A-Za-z0-9./-]{4,40}$' AND code !~* '^M[ICSU][0-9]+$')`);

  // ---------- Stock: the main store is school_id NULL ----------
  await knex.raw('ALTER TABLE stock_levels DROP CONSTRAINT stock_levels_pkey');
  await knex.raw('ALTER TABLE stock_levels ALTER COLUMN school_id DROP NOT NULL');
  await knex.raw('CREATE UNIQUE INDEX stock_levels_school_item_uq ON stock_levels (school_id, item_id)');
  await knex.raw('CREATE UNIQUE INDEX stock_levels_main_uq ON stock_levels (item_id) WHERE school_id IS NULL');
  await knex.raw('ALTER TABLE stock_moves ALTER COLUMN school_id DROP NOT NULL');
  await knex.raw('ALTER TABLE stock_moves DROP CONSTRAINT stock_moves_chk');
  // buy = purchase confirmed (main store); send = sent from the main store to a library; issue / return = scanned out / back;
  // count = correction after a confirmed weekly check.
  await knex.raw(`ALTER TABLE stock_moves ADD CONSTRAINT stock_moves_chk CHECK (change <> 0 AND balance >= 0
    AND kind IN ('in','give','damage','buy','send','issue','return','count'))`);
  await knex.schema.alterTable('deliveries', (t) => { t.boolean('from_main').notNullable().defaultTo(false); }); // taken out of the main store when sent

  // ---------- Pieces of things that come back ----------
  await knex.schema.createTable('item_copies', (t) => {
    t.increments('id');                                        // the barcode is MC + this number
    t.integer('item_id').notNullable().references('id').inTable('items').onDelete('RESTRICT');
    t.integer('school_id').references('id').inTable('schools').onDelete('RESTRICT'); // NULL = main store
    t.string('status', 8).notNullable().defaultTo('in');       // in | out | damaged | lost
    t.integer('issue_line_id');                                // the open issue while it is out
    t.string('note', 200);
    t.integer('created_by').references('id').inTable('users');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['item_id', 'school_id', 'status']);
  });
  await knex.raw(`ALTER TABLE item_copies ADD CONSTRAINT item_copies_chk CHECK (status IN ('in','out','damaged','lost'))`);

  // ---------- Issues (given out, not sold) ----------
  await knex.schema.createTable('issues', (t) => {
    t.increments('id');
    t.string('number', 20);                                    // ISS.0001
    t.integer('school_id').references('id').inTable('schools').onDelete('RESTRICT'); // NULL = main store
    t.string('to_kind', 8).notNullable();                      // student | staff | dept
    t.integer('student_id').references('id').inTable('students');
    t.integer('staff_id').references('id').inTable('users');
    t.string('to_name', 120).notNullable();                    // copied, so the paper stays the same if the name changes
    t.string('to_detail', 80);                                 // class, role or place (e.g. KITCHEN)
    t.string('note', 200);
    t.string('client_key', 40).unique();
    t.integer('issued_by').notNullable().references('id').inTable('users');
    t.timestamp('at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['school_id', 'at']);
    t.index(['student_id']);
    t.index(['staff_id']);
  });
  await knex.raw(`ALTER TABLE issues ADD CONSTRAINT issues_chk CHECK (to_kind IN ('student','staff','dept')
    AND (to_kind <> 'student' OR student_id IS NOT NULL) AND (to_kind <> 'staff' OR staff_id IS NOT NULL))`);
  await knex.schema.createTable('issue_lines', (t) => {
    t.increments('id');
    t.integer('issue_id').notNullable().references('id').inTable('issues').onDelete('RESTRICT');
    t.integer('item_id').notNullable().references('id').inTable('items').onDelete('RESTRICT');
    t.string('item_name', 80).notNullable();
    t.string('unit', 12).notNullable();
    t.integer('qty').notNullable();
    t.integer('copy_id').references('id').inTable('item_copies'); // set for things that come back (qty is then 1)
    t.string('returned', 8);                                   // null = still out; good | damaged | lost
    t.timestamp('returned_at', { useTz: true });
    t.integer('returned_to').references('id').inTable('users');
    t.string('return_note', 200);
    t.index(['issue_id']);
    t.index(['copy_id']);
    t.index(['item_id']);
  });
  await knex.raw(`ALTER TABLE issue_lines ADD CONSTRAINT issue_lines_chk CHECK (qty > 0 AND (copy_id IS NULL OR qty = 1)
    AND (returned IS NULL OR returned IN ('good','damaged','lost')))`);

  // ---------- Purchases (store-keeper buys, accountant office confirms) ----------
  await knex.schema.createTable('purchases', (t) => {
    t.increments('id');
    t.string('number', 20);                                    // PUR.0001
    t.string('supplier', 120).notNullable();
    t.string('invoice_no', 60);
    t.date('bought_on').notNullable();
    t.string('note', 300);
    t.bigInteger('total').notNullable();
    t.string('status', 10).notNullable().defaultTo('pending'); // pending | confirmed | rejected
    t.integer('created_by').notNullable().references('id').inTable('users');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('decided_by').references('id').inTable('users');
    t.timestamp('decided_at', { useTz: true });
    t.string('decision_note', 300);
    t.index(['status']);
  });
  await knex.raw(`ALTER TABLE purchases ADD CONSTRAINT purchases_chk CHECK (status IN ('pending','confirmed','rejected') AND total >= 0)`);
  await knex.schema.createTable('purchase_lines', (t) => {
    t.increments('id');
    t.integer('purchase_id').notNullable().references('id').inTable('purchases').onDelete('RESTRICT');
    t.integer('item_id').notNullable().references('id').inTable('items').onDelete('RESTRICT');
    t.string('item_name', 80).notNullable();
    t.string('unit', 12).notNullable();
    t.integer('qty').notNullable();
    t.integer('unit_cost').notNullable();                      // TSh for one unit
    t.bigInteger('amount').notNullable();
    t.integer('confirmed_qty');                                // what the accountant really saw
    t.string('note', 200);
    t.index(['purchase_id']);
  });
  await knex.raw(`ALTER TABLE purchase_lines ADD CONSTRAINT purchase_lines_chk CHECK (qty > 0 AND unit_cost >= 0 AND amount = unit_cost::bigint * qty
    AND (confirmed_qty IS NULL OR (confirmed_qty >= 0 AND confirmed_qty <= qty)))`);

  // ---------- Weekly stock check ----------
  await knex.schema.createTable('stock_counts', (t) => {
    t.increments('id');
    t.string('number', 20);                                    // CNT.0001
    t.integer('school_id').references('id').inTable('schools').onDelete('RESTRICT'); // NULL = main store
    t.string('category', 20);                                  // e.g. food; NULL = every category
    t.date('week_start').notNullable();                        // Monday of the week
    t.string('note', 300);
    t.string('status', 10).notNullable().defaultTo('pending'); // pending | confirmed | rejected
    t.integer('counted_by').notNullable().references('id').inTable('users');
    t.timestamp('counted_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('decided_by').references('id').inTable('users');
    t.timestamp('decided_at', { useTz: true });
    t.string('decision_note', 300);
    t.index(['school_id', 'week_start']);
  });
  await knex.raw(`ALTER TABLE stock_counts ADD CONSTRAINT stock_counts_chk CHECK (status IN ('pending','confirmed','rejected'))`);
  await knex.schema.createTable('stock_count_lines', (t) => {
    t.increments('id');
    t.integer('count_id').notNullable().references('id').inTable('stock_counts').onDelete('RESTRICT');
    t.integer('item_id').notNullable().references('id').inTable('items').onDelete('RESTRICT');
    t.string('item_name', 80).notNullable();
    t.string('unit', 12).notNullable();
    t.integer('system_qty').notNullable();                     // what the system said at the moment of counting
    t.integer('counted_qty').notNullable();                    // what the keeper found
    t.string('note', 200);
    t.index(['count_id']);
  });
  await knex.raw('ALTER TABLE stock_count_lines ADD CONSTRAINT stock_count_lines_chk CHECK (system_qty >= 0 AND counted_qty >= 0)');

  // ---------- The database refuses to rewrite these records, whoever asks ----------
  await knex.raw(`
    CREATE FUNCTION musabe_decided_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.status <> 'pending' THEN RAISE EXCEPTION 'This record is already decided and cannot be changed (%).', TG_TABLE_NAME; END IF;
      RETURN NEW;
    END $$;
    CREATE FUNCTION musabe_issue_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF (NEW.issue_id, NEW.item_id, NEW.item_name, NEW.unit, NEW.qty, NEW.copy_id)
         IS DISTINCT FROM (OLD.issue_id, OLD.item_id, OLD.item_name, OLD.unit, OLD.qty, OLD.copy_id) THEN
        RAISE EXCEPTION 'An issued line cannot be changed after it is written.';
      END IF;
      IF OLD.returned IS NOT NULL THEN RAISE EXCEPTION 'This item was already returned.'; END IF;
      RETURN NEW;
    END $$;
    CREATE FUNCTION musabe_purchase_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF (NEW.purchase_id, NEW.item_id, NEW.item_name, NEW.unit, NEW.qty, NEW.unit_cost, NEW.amount)
         IS DISTINCT FROM (OLD.purchase_id, OLD.item_id, OLD.item_name, OLD.unit, OLD.qty, OLD.unit_cost, OLD.amount) THEN
        RAISE EXCEPTION 'A purchase line cannot be changed after it is written.';
      END IF;
      IF OLD.confirmed_qty IS NOT NULL THEN RAISE EXCEPTION 'This purchase line is already confirmed.'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER purchases_guard BEFORE UPDATE ON purchases FOR EACH ROW EXECUTE FUNCTION musabe_decided_guard();
    CREATE TRIGGER purchases_no_delete BEFORE DELETE ON purchases FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER purchase_lines_guard BEFORE UPDATE ON purchase_lines FOR EACH ROW EXECUTE FUNCTION musabe_purchase_line_guard();
    CREATE TRIGGER purchase_lines_no_delete BEFORE DELETE ON purchase_lines FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER stock_counts_guard BEFORE UPDATE ON stock_counts FOR EACH ROW EXECUTE FUNCTION musabe_decided_guard();
    CREATE TRIGGER stock_counts_no_delete BEFORE DELETE ON stock_counts FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER stock_count_lines_no_update BEFORE UPDATE ON stock_count_lines FOR EACH ROW EXECUTE FUNCTION musabe_no_update();
    CREATE TRIGGER stock_count_lines_no_delete BEFORE DELETE ON stock_count_lines FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER issues_no_update BEFORE UPDATE ON issues FOR EACH ROW EXECUTE FUNCTION musabe_no_update();
    CREATE TRIGGER issues_no_delete BEFORE DELETE ON issues FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER issue_lines_guard BEFORE UPDATE ON issue_lines FOR EACH ROW EXECUTE FUNCTION musabe_issue_line_guard();
    CREATE TRIGGER issue_lines_no_delete BEFORE DELETE ON issue_lines FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER item_copies_no_delete BEFORE DELETE ON item_copies FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER item_barcodes_no_update BEFORE UPDATE ON item_barcodes FOR EACH ROW EXECUTE FUNCTION musabe_no_update();
  `);
};

exports.down = async (knex) => {
  for (const t of ['stock_count_lines', 'stock_counts', 'purchase_lines', 'purchases', 'issue_lines', 'issues', 'item_copies', 'item_barcodes']) {
    await knex.schema.dropTableIfExists(t);
  }
  await knex.raw('DROP FUNCTION IF EXISTS musabe_decided_guard(); DROP FUNCTION IF EXISTS musabe_issue_line_guard(); DROP FUNCTION IF EXISTS musabe_purchase_line_guard();');
  await knex.schema.alterTable('deliveries', (t) => t.dropColumn('from_main'));
  // Main store rows and the new kinds of moves cannot stay in the old shape. Stock history is never deleted,
  // so the roll back stops here if there is any.
  const main = await knex('stock_moves').whereNull('school_id').orWhereIn('kind', ['buy', 'send', 'issue', 'return', 'count']).first();
  if (main) throw new Error('Cannot roll back: the main store or scanned issues already have stock history.');
  await knex('stock_levels').whereNull('school_id').del();
  await knex.raw('ALTER TABLE stock_moves DROP CONSTRAINT stock_moves_chk');
  await knex.raw(`ALTER TABLE stock_moves ADD CONSTRAINT stock_moves_chk CHECK (change <> 0 AND balance >= 0 AND kind IN ('in','give','damage'))`);
  await knex.raw('ALTER TABLE stock_moves ALTER COLUMN school_id SET NOT NULL');
  await knex.raw('DROP INDEX IF EXISTS stock_levels_main_uq; DROP INDEX IF EXISTS stock_levels_school_item_uq');
  await knex.raw('ALTER TABLE stock_levels ALTER COLUMN school_id SET NOT NULL');
  await knex.raw('ALTER TABLE stock_levels ADD PRIMARY KEY (school_id, item_id)');
  await knex.raw('ALTER TABLE items DROP CONSTRAINT items_category_chk');
  await knex.raw(`UPDATE items SET category = 'other' WHERE category NOT IN (${list(OLD_CATEGORIES)})`);
  await knex.raw(`ALTER TABLE items ADD CONSTRAINT items_category_chk CHECK (category IN (${list(OLD_CATEGORIES)}))`);
  await knex.schema.alterTable('items', (t) => { t.dropColumn('unit'); t.dropColumn('returnable'); t.dropColumn('sellable'); });
  await knex('users').where({ role: 'storekeeper' }).update({ active: false, role: 'aacc' }); // no such role before: switched off
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_chk');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_school_chk');
  const R = ROLES.filter((r) => r !== 'storekeeper'), A = ADMIN.filter((r) => r !== 'storekeeper');
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN (${list(R)}))`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_school_chk CHECK (
    (role IN (${list(A)}) AND school_id IS NULL) OR (role IN (${list(SCHOOL)}) AND school_id IS NOT NULL))`);
};
