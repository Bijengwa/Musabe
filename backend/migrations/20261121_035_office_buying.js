// 2026-11-21: the office buying work that was still missing.
// - Requisitions: the Assistant Accountant checks a requisition (prices, price list) before the Manager / Finance Manager
//   approves the money (new step "check"). A requisition may point to the supplier's price list / proforma.
// - Suppliers: one list, with payment terms (cash, weekly, monthly...). Price lists / proforma invoices (photo of the hard
//   copy + the prices typed). LPO (Local Purchase Order): prepared by the procurement (Assistant Manager / store-keeper),
//   certified by the Head of Accounts (Accountant), authorised by the Manager (or the Finance Manager when he is away).
// - Buying on credit: a purchase may be on credit (from an LPO or a supplier with terms). Supplier debts = credit goods
//   confirmed - payments made to the supplier.
// - Mapokezi: goods that came WITHOUT a receipt are marked with the reason; the Finance Manager, the Manager and the
//   Director are told (not their assistants).
// - Purchases: the accountant office / Cashier confirm; then the store-keeper sends the goods to the school (with QR).
//   Two steps now, not one click.
// - Work agreements (Makubaliano ya Malipo ya Kazi) with instalments, and vehicles with their responsible driver.
// Nothing here is ever deleted.
const ORD = ['acad', 'head', 'store', 'check', 'manager', 'approved', 'buying', 'arrived', 'sent', 'done'];
const list = (a) => a.map((x) => `'${x}'`).join(',');

function guard(knex, ord, withCheck) {
  return knex.raw(`
    CREATE OR REPLACE FUNCTION musabe_requisition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE ord text[] := ARRAY[${list(ord)}];
    BEGIN
      IF OLD.status IN ('done','rejected','withdrawn','closed') THEN RAISE EXCEPTION 'This requisition is finished and cannot be changed.'; END IF;
      IF NEW.status = 'closed' AND OLD.status NOT IN ('approved','buying') THEN RAISE EXCEPTION 'Only a requisition being bought can be closed with the money given back.'; END IF;
      IF NEW.status NOT IN ('rejected','withdrawn','closed') AND array_position(ord, NEW.status) < array_position(ord, OLD.status)
         AND NOT (OLD.status = 'sent' AND NEW.status IN ('approved','arrived'))
         AND NOT (OLD.status = 'buying' AND NEW.status = 'approved') THEN
        RAISE EXCEPTION 'A requisition cannot go back a step.';
      END IF;
      IF (NEW.school_id, NEW.requested_by, NEW.requested_at, NEW.purpose, NEW.number) IS DISTINCT FROM (OLD.school_id, OLD.requested_by, OLD.requested_at, OLD.purpose, OLD.number)
         OR (OLD.acad_by IS NOT NULL AND NEW.acad_by IS DISTINCT FROM OLD.acad_by)
         OR (OLD.head_by IS NOT NULL AND NEW.head_by IS DISTINCT FROM OLD.head_by)
         OR (OLD.store_by IS NOT NULL AND NEW.store_by IS DISTINCT FROM OLD.store_by)
         ${withCheck ? 'OR (OLD.check_by IS NOT NULL AND NEW.check_by IS DISTINCT FROM OLD.check_by)' : ''}
         OR (OLD.manager_by IS NOT NULL AND NEW.manager_by IS DISTINCT FROM OLD.manager_by) THEN
        RAISE EXCEPTION 'A signed requisition cannot be changed.';
      END IF;
      RETURN NEW;
    END $$;`);
}
const PRICE_LIST_GUARD = `
    CREATE FUNCTION musabe_price_list_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.photo IS NOT NULL OR (NEW.number, NEW.supplier_id, NEW.kind, NEW.ref_no, NEW.doc_date, NEW.valid_until, NEW.note, NEW.created_by, NEW.created_at)
         IS DISTINCT FROM (OLD.number, OLD.supplier_id, OLD.kind, OLD.ref_no, OLD.doc_date, OLD.valid_until, OLD.note, OLD.created_by, OLD.created_at) THEN
        RAISE EXCEPTION 'A price list is never changed (only its photo is added once).';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER price_lists_guard BEFORE UPDATE ON price_lists FOR EACH ROW EXECUTE FUNCTION musabe_price_list_guard();`;
const noDelete = (t) => `CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION musabe_no_delete()`;

exports.up = async (knex) => {
  // ---------- Suppliers and price lists ----------
  await knex.schema.createTable('suppliers', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable();
    t.string('phone', 10);
    t.string('tin', 20);
    t.string('place', 120);
    t.string('terms', 8).notNullable().defaultTo('cash');   // cash | weekly | monthly | other
    t.string('terms_note', 200);
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('created_by').references('id').inTable('users');
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE suppliers ADD CONSTRAINT suppliers_chk CHECK (terms IN ('cash','weekly','monthly','other') AND (phone IS NULL OR phone ~ '^0[67][0-9]{8}$'))`);
  await knex.raw('CREATE UNIQUE INDEX suppliers_name_uq ON suppliers (lower(name))');

  await knex.schema.createTable('price_lists', (t) => {
    t.increments('id');
    t.string('number', 12).notNullable().unique();          // PRL.0001
    t.integer('supplier_id').notNullable().references('id').inTable('suppliers');
    t.string('kind', 9).notNullable();                       // pricelist | proforma
    t.string('ref_no', 40);                                  // the supplier's own number on the paper
    t.date('doc_date');
    t.date('valid_until');
    t.string('photo_mime', 20);
    t.binary('photo');                                       // the hard copy, photographed
    t.string('note', 300);
    t.integer('created_by').notNullable().references('id').inTable('users');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE price_lists ADD CONSTRAINT price_lists_chk CHECK (kind IN ('pricelist','proforma')
    AND (photo IS NULL OR (photo_mime IN ('image/jpeg','image/png','application/pdf') AND octet_length(photo) <= 3000000)))`);
  // The photo of the paper is added once, right after the price list is written; nothing else ever changes.
  await knex.raw(PRICE_LIST_GUARD);
  await knex.schema.createTable('price_list_lines', (t) => {
    t.increments('id');
    t.integer('price_list_id').notNullable().references('id').inTable('price_lists');
    t.string('item_name', 200).notNullable();
    t.string('unit', 20);
    t.bigInteger('unit_price').notNullable();
  });
  await knex.schema.alterTable('requisitions', (t) => {
    t.integer('price_list_id').references('id').inTable('price_lists');
    t.integer('check_by').references('id').inTable('users');
    t.timestamp('check_at', { useTz: true });
    t.string('check_note', 300);
  });

  // ---------- Requisitions: the Assistant Accountant's check before the money step ----------
  await knex.raw('ALTER TABLE requisitions DROP CONSTRAINT requisitions_chk');
  await knex.raw(`ALTER TABLE requisitions ADD CONSTRAINT requisitions_chk CHECK (status IN (${list(ORD)},'rejected','withdrawn','closed'))`);
  await guard(knex, ORD, true);

  // ---------- LPO ----------
  await knex.schema.createTable('lpos', (t) => {
    t.increments('id');
    t.string('number', 12).notNullable().unique();          // LPO.0001
    t.integer('supplier_id').notNullable().references('id').inTable('suppliers');
    t.integer('school_id').references('id').inTable('schools');   // "Ship to" (empty = the administration office)
    t.string('ship_to', 120);
    t.string('our_ref', 40);
    t.integer('price_list_id').references('id').inTable('price_lists');
    t.integer('requisition_id').references('id').inTable('requisitions');
    t.string('terms', 8).notNullable().defaultTo('cash');
    t.date('deliver_by');
    t.string('note', 300);
    t.bigInteger('total');
    // prepared -> certified (Head of Accounts) -> authorised (Manager / FM) -> delivered (goods came) | rejected | cancelled
    t.string('status', 10).notNullable().defaultTo('certify');
    t.integer('prepared_by').notNullable().references('id').inTable('users');
    t.timestamp('prepared_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('certified_by').references('id').inTable('users');
    t.timestamp('certified_at', { useTz: true });
    t.integer('authorised_by').references('id').inTable('users');
    t.timestamp('authorised_at', { useTz: true });
    t.integer('rejected_by').references('id').inTable('users');
    t.timestamp('rejected_at', { useTz: true });
    t.string('reject_reason', 300);
  });
  await knex.raw(`ALTER TABLE lpos ADD CONSTRAINT lpos_chk CHECK (status IN ('certify','authorise','authorised','delivered','rejected','cancelled')
    AND terms IN ('cash','weekly','monthly','other'))`);
  await knex.schema.createTable('lpo_lines', (t) => {
    t.increments('id');
    t.integer('lpo_id').notNullable().references('id').inTable('lpos');
    t.string('description', 200).notNullable();
    t.string('unit', 20);
    t.integer('qty').notNullable();
    t.bigInteger('rate');                                    // may be empty: the supplier fills Rate and Amount
  });
  await knex.raw(`
    CREATE FUNCTION musabe_lpo_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE ord text[] := ARRAY['certify','authorise','authorised','delivered'];
    BEGIN
      IF OLD.status IN ('delivered','rejected','cancelled') THEN RAISE EXCEPTION 'This LPO is finished and cannot be changed.'; END IF;
      IF NEW.status IN ('certify','authorise','authorised','delivered') AND array_position(ord, NEW.status) < array_position(ord, OLD.status) THEN
        RAISE EXCEPTION 'An LPO cannot go back a step.'; END IF;
      IF (NEW.number, NEW.supplier_id, NEW.prepared_by) IS DISTINCT FROM (OLD.number, OLD.supplier_id, OLD.prepared_by)
         OR (OLD.certified_by IS NOT NULL AND NEW.certified_by IS DISTINCT FROM OLD.certified_by)
         OR (OLD.authorised_by IS NOT NULL AND NEW.authorised_by IS DISTINCT FROM OLD.authorised_by) THEN
        RAISE EXCEPTION 'A signed LPO cannot be changed.'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER lpos_guard BEFORE UPDATE ON lpos FOR EACH ROW EXECUTE FUNCTION musabe_lpo_guard();`);

  // ---------- Purchases: supplier, LPO, credit, no receipt, sent by the store-keeper ----------
  await knex.schema.alterTable('purchases', (t) => {
    t.integer('supplier_id').references('id').inTable('suppliers');
    t.integer('lpo_id').references('id').inTable('lpos');
    t.boolean('on_credit').notNullable().defaultTo(false);
    t.boolean('no_receipt').notNullable().defaultTo(false);
    t.string('no_receipt_reason', 300);
    t.integer('sent_by').references('id').inTable('users');   // the store-keeper who sent it on to the school
  });
  await knex.schema.createTable('supplier_payments', (t) => {
    t.increments('id');
    t.integer('supplier_id').notNullable().references('id').inTable('suppliers');
    t.bigInteger('amount').notNullable();
    t.date('paid_on').notNullable();
    t.string('ref', 60);                                     // voucher no., cheque no., bank reference
    t.string('note', 300);
    t.integer('recorded_by').notNullable().references('id').inTable('users');
    t.timestamp('recorded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('ALTER TABLE supplier_payments ADD CONSTRAINT supplier_payments_chk CHECK (amount > 0)');

  // ---------- Work agreements (Makubaliano ya Malipo ya Kazi) ----------
  await knex.schema.createTable('contracts', (t) => {
    t.increments('id');
    t.string('number', 12).notNullable().unique();          // MKT.0001
    t.string('employer', 120).notNullable();                 // Jina la mtoa kazi
    t.string('contractor', 120).notNullable();               // Jina la mpewa kazi (kikundi)
    t.string('chairman', 120);                               // jina la mkiti
    t.string('phone', 10);
    t.string('work', 300).notNullable();                     // Aina ya kazi
    t.string('place', 150);                                  // Eneo la kufanyia kazi
    t.integer('school_id').references('id').inTable('schools');
    t.date('start_on');
    t.date('end_on');
    t.bigInteger('amount').notNullable();
    t.date('signed_on');                                     // signed on paper by the Director and the contractor
    t.string('director_name', 120);
    t.string('scan_mime', 20);
    t.binary('scan');                                        // the signed paper
    t.string('status', 9).notNullable().defaultTo('active'); // active | finished | stopped
    t.string('note', 300);
    t.integer('created_by').notNullable().references('id').inTable('users');
    t.integer('checked_by').references('id').inTable('users');   // Imekaguliwa na
    t.timestamp('checked_at', { useTz: true });
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE contracts ADD CONSTRAINT contracts_chk CHECK (amount > 0 AND status IN ('active','finished','stopped')
    AND (phone IS NULL OR phone ~ '^0[67][0-9]{8}$') AND (scan IS NULL OR (scan_mime IN ('image/jpeg','image/png','application/pdf') AND octet_length(scan) <= 3000000)))`);
  await knex.schema.createTable('contract_payments', (t) => {
    t.increments('id');
    t.integer('contract_id').notNullable().references('id').inTable('contracts');
    t.date('paid_on').notNullable();
    t.bigInteger('amount').notNullable();
    t.string('received_by', 120);                            // the payee who signs (Sahihi ya mlipwaji)
    t.string('ref', 60);                                     // voucher no.
    t.integer('recorded_by').notNullable().references('id').inTable('users');
    t.timestamp('recorded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('ALTER TABLE contract_payments ADD CONSTRAINT contract_payments_chk CHECK (amount > 0)');

  // ---------- Vehicles and their responsible driver ----------
  await knex.schema.createTable('vehicles', (t) => {
    t.increments('id');
    t.string('plate', 12).notNullable();
    t.string('make', 60);
    t.string('use', 120);                                    // school bus, lorry, office car...
    t.integer('school_id').references('id').inTable('schools');
    t.boolean('active').notNullable().defaultTo(true);
    t.string('note', 300);
    t.integer('created_by').references('id').inTable('users');
    t.timestamps(true, true);
  });
  await knex.raw('CREATE UNIQUE INDEX vehicles_plate_uq ON vehicles (upper(plate))');
  await knex.schema.createTable('vehicle_drivers', (t) => {
    t.increments('id');
    t.integer('vehicle_id').notNullable().references('id').inTable('vehicles');
    t.string('driver_name', 120).notNullable();
    t.string('phone', 10);
    t.string('licence_no', 30);
    t.date('from_on').notNullable();
    t.date('to_on');                                         // empty = still the driver
    t.integer('recorded_by').notNullable().references('id').inTable('users');
    t.timestamp('recorded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE vehicle_drivers ADD CONSTRAINT vehicle_drivers_chk CHECK (phone IS NULL OR phone ~ '^0[67][0-9]{8}$')`);
  await knex.raw('CREATE UNIQUE INDEX vehicle_drivers_one ON vehicle_drivers (vehicle_id) WHERE to_on IS NULL');

  for (const t of ['suppliers', 'price_lists', 'price_list_lines', 'lpos', 'lpo_lines', 'supplier_payments', 'contracts', 'contract_payments', 'vehicles', 'vehicle_drivers']) await knex.raw(noDelete(t));
};

exports.down = async (knex) => {
  if (await knex('requisitions').where('status', 'check').first()) throw new Error('Cannot roll back: some requisitions wait for the Assistant Accountant.');
  for (const t of ['vehicle_drivers', 'vehicles', 'contract_payments', 'contracts', 'supplier_payments']) await knex.schema.dropTableIfExists(t);
  await knex.schema.alterTable('purchases', (t) => { ['supplier_id', 'lpo_id', 'on_credit', 'no_receipt', 'no_receipt_reason', 'sent_by'].forEach((c) => t.dropColumn(c)); });
  await knex.raw('DROP TRIGGER IF EXISTS lpos_guard ON lpos; DROP FUNCTION IF EXISTS musabe_lpo_guard();');
  await knex.schema.dropTableIfExists('lpo_lines');
  await knex.schema.dropTableIfExists('lpos');
  const old = ORD.filter((s) => s !== 'check');
  await knex.raw('ALTER TABLE requisitions DROP CONSTRAINT requisitions_chk');
  await knex.raw(`ALTER TABLE requisitions ADD CONSTRAINT requisitions_chk CHECK (status IN (${list(old)},'rejected','withdrawn','closed'))`);
  await guard(knex, old, false);
  await knex.schema.alterTable('requisitions', (t) => { ['price_list_id', 'check_by', 'check_at', 'check_note'].forEach((c) => t.dropColumn(c)); });
  await knex.schema.dropTableIfExists('price_list_lines');
  await knex.raw('DROP TRIGGER IF EXISTS price_lists_guard ON price_lists; DROP FUNCTION IF EXISTS musabe_price_list_guard();');
  await knex.schema.dropTableIfExists('price_lists');
  await knex.schema.dropTableIfExists('suppliers');
};
