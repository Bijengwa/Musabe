// 2026-11-20: Store books ("vitabu vya stoo") for the administration store-keeper.
// He makes his own folders (e.g. FOODS, CLEANING), and items inside (MCHELE in kg, SUKARI in kg, UNGA in bags...).
// For each item he writes, as in a paper ledger:
//   received  — came into the store (from whom)                       store goes up
//   sent      — went from the store to a place (e.g. Boys Kitchen)    store goes down, that place goes up
//   used      — used up at a place (or at the store)                  that place goes down
//   corrected — after counting: the real amount at a place            the difference is written, with a note
// Nothing is changed or deleted: a mistake is fixed with a new "corrected" line.
exports.up = async (knex) => {
  await knex.schema.createTable('store_folders', (t) => {
    t.increments('id');
    t.string('name', 60).notNullable().unique();
    t.string('note', 200);
    t.integer('created_by').references('id').inTable('users');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('store_book_items', (t) => {
    t.increments('id');
    t.integer('folder_id').notNullable().references('id').inTable('store_folders');
    t.string('name', 80).notNullable();
    t.string('unit', 20).notNullable();
    t.decimal('reorder_level', 14, 3);            // tell when the store has this much or less
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('created_by').references('id').inTable('users');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['folder_id', 'name']);
  });
  await knex.schema.createTable('store_book_entries', (t) => {
    t.bigIncrements('id');
    t.integer('item_id').notNullable().references('id').inTable('store_book_items');
    t.string('kind', 12).notNullable();           // received, sent, used, corrected
    t.date('on_date').notNullable();
    t.decimal('qty', 14, 3).notNullable();        // always > 0, except "corrected" (+ or -)
    t.string('place', 60).notNullable();          // STORE for the store itself, else e.g. "BOYS KITCHEN"
    t.string('party', 120);                       // received from (supplier) / given to (person)
    t.string('note', 300);
    t.integer('by').references('id').inTable('users');
    t.timestamp('at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['item_id', 'on_date']);
  });
  await knex.raw(`ALTER TABLE store_book_entries ADD CONSTRAINT store_book_entries_chk CHECK (
    kind IN ('received','sent','used','corrected') AND (kind = 'corrected' OR qty > 0) AND qty <> 0)`);
  await knex.raw(`
    CREATE FUNCTION musabe_book_lock() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Store book lines are never changed or deleted (%): write a "corrected" line instead.', TG_TABLE_NAME; END $$;
    CREATE TRIGGER store_book_entries_no_change BEFORE UPDATE OR DELETE ON store_book_entries FOR EACH ROW EXECUTE FUNCTION musabe_book_lock();
    CREATE TRIGGER store_book_items_no_delete BEFORE DELETE ON store_book_items FOR EACH ROW EXECUTE FUNCTION musabe_book_lock();
    CREATE TRIGGER store_folders_no_delete BEFORE DELETE ON store_folders FOR EACH ROW EXECUTE FUNCTION musabe_book_lock();`);
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('store_book_entries');
  await knex.schema.dropTableIfExists('store_book_items');
  await knex.schema.dropTableIfExists('store_folders');
  await knex.raw('DROP FUNCTION IF EXISTS musabe_book_lock()');
};
