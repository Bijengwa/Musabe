// 2026-11-20: the Assistant Manager role, and the Order Book.
// - Assistant Manager (amanager, administration): sent to buy, like the store-keeper; writes payment requisitions.
// - Order Book (the paper "ORDER": M/s ..., "Please supply following goods", Qty / Particulars, Name, Signature):
//   a place of a school (library, school store, academic office, kitchen...) orders from the store-keeper.
//     teacher        -> Academic Master (gives it, or sends it on to the store-keeper)          status acad
//     Academic Master -> store-keeper                                                            status keeper
//     librarian / School Store-keeper -> Head Master -> Manager -> store-keeper                  status head, manager, keeper
//     Head Master    -> Manager -> store-keeper
//   The store-keeper (or Assistant Manager) turns it into a payment requisition (status requisition), or rejects it.
//   An order moves forward only and is never deleted (database guard).
const { ROLES, ADMIN_ROLES, SCHOOL_ROLES } = require('../src/auth/roles');
const list = (a) => a.map((x) => `'${x}'`).join(',');

exports.up = async (knex) => {
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_chk');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_school_chk');
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN (${list(Object.keys(ROLES))}))`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_school_chk CHECK (
    (role IN (${list(ADMIN_ROLES)}) AND school_id IS NULL) OR
    (role IN (${list(SCHOOL_ROLES)}) AND school_id IS NOT NULL))`);

  await knex.schema.createTable('orders', (t) => {
    t.increments('id');
    t.string('number', 20).notNullable().unique();
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.string('place', 20).notNullable();               // library, store, academic, kitchen, office, other
    t.string('place_name', 80);                         // e.g. "Boys Kitchen"
    t.string('status', 20).notNullable();               // acad, head, manager, keeper, given, requisition, rejected, withdrawn
    t.integer('written_by').notNullable().references('id').inTable('users');
    t.string('written_role', 20).notNullable();
    t.string('note', 300);
    t.date('needed_by');
    t.integer('acad_by').references('id').inTable('users'); t.timestamp('acad_at', { useTz: true }); t.string('acad_note', 300);
    t.integer('head_by').references('id').inTable('users'); t.timestamp('head_at', { useTz: true });
    t.integer('manager_by').references('id').inTable('users'); t.timestamp('manager_at', { useTz: true }); t.string('manager_note', 300);
    t.integer('keeper_by').references('id').inTable('users'); t.timestamp('keeper_at', { useTz: true });
    t.integer('rejected_by').references('id').inTable('users'); t.timestamp('rejected_at', { useTz: true }); t.string('reject_reason', 300); t.string('rejected_step', 20);
    t.integer('requisition_id').references('id').inTable('requisitions');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['school_id', 'status']);
  });
  await knex.raw(`ALTER TABLE orders ADD CONSTRAINT orders_chk CHECK (
    status IN ('acad','head','manager','keeper','given','requisition','rejected','withdrawn')
    AND place IN ('library','store','academic','kitchen','office','other'))`);
  await knex.schema.createTable('order_lines', (t) => {
    t.increments('id');
    t.integer('order_id').notNullable().references('id').inTable('orders');
    t.integer('qty');                                   // may be empty, as on paper
    t.string('unit', 20);                               // kg, L, pcs, boxes...
    t.string('particulars', 200).notNullable();
    t.integer('approved_qty');                          // a signer may give fewer
    t.index('order_id');
  });
  await knex.raw(`
    CREATE FUNCTION musabe_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.status IN ('given','requisition','rejected','withdrawn') THEN
        RAISE EXCEPTION 'Order % was already decided and cannot be changed.', OLD.number;
      END IF;
      IF NEW.number <> OLD.number OR NEW.school_id <> OLD.school_id OR NEW.written_by <> OLD.written_by THEN
        RAISE EXCEPTION 'Order % cannot change its number, school or writer.', OLD.number;
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER orders_guard BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION musabe_order_guard();
    CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER order_lines_no_delete BEFORE DELETE ON order_lines FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
  `);
};

exports.down = async (knex) => {
  await knex.raw('DROP TABLE IF EXISTS order_lines; DROP TABLE IF EXISTS orders; DROP FUNCTION IF EXISTS musabe_order_guard()');
  await knex('users').where('role', 'amanager').update({ active: false, role: 'aacc' });
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_chk');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_school_chk');
  const R = Object.keys(ROLES).filter((r) => r !== 'amanager');
  const A = ADMIN_ROLES.filter((r) => r !== 'amanager');
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN (${list(R)}))`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_school_chk CHECK (
    (role IN (${list(A)}) AND school_id IS NULL) OR (role IN (${list(SCHOOL_ROLES)}) AND school_id IS NOT NULL))`);
};
