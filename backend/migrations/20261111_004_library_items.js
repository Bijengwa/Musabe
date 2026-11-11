// Library step 2a: items and prices.
// - One list of items for all schools (uniforms, books, exercise books, stationery, other).
// - Each school has its own price for an item, or does not sell it.
// - Some items (e.g. Special Uniform) cost a different amount for boys and girls.
// - Every price change is kept in item_price_changes (receipts will also keep the price they were sold at).
// - schools.students: who the school teaches, so the right gender prices are asked for.
const CATEGORIES = ['uniform', 'book', 'exercise_book', 'stationery', 'other'];

exports.up = async (knex) => {
  await knex.schema.alterTable('schools', (t) => {
    t.string('students', 6).notNullable().defaultTo('mixed'); // mixed | boys | girls
  });
  await knex.raw(`ALTER TABLE schools ADD CONSTRAINT schools_students_chk CHECK (students IN ('mixed','boys','girls'))`);
  await knex('schools').where({ code: 'boys' }).update({ students: 'boys' });
  await knex('schools').where({ code: 'girls' }).update({ students: 'girls' });

  await knex.schema.createTable('items', (t) => {
    t.increments('id');
    t.string('name', 80).notNullable();
    t.string('category', 20).notNullable();
    t.boolean('gender_priced').notNullable().defaultTo(false); // different price for boys and girls
    t.boolean('active').notNullable().defaultTo(true);          // false = no longer sold anywhere (kept for history)
    t.integer('created_by').references('id').inTable('users');
    t.timestamps(true, true);
  });
  await knex.raw('CREATE UNIQUE INDEX items_name_lower_uq ON items (lower(name))');
  await knex.raw(`ALTER TABLE items ADD CONSTRAINT items_category_chk CHECK (category IN (${CATEGORIES.map((c) => `'${c}'`).join(',')}))`);

  // Price of an item in one school. No row = not sold in that school.
  await knex.schema.createTable('item_prices', (t) => {
    t.integer('item_id').notNullable().references('id').inTable('items').onDelete('CASCADE');
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('price');        // TZS, when the price is the same for everyone
    t.integer('price_boys');   // TZS, when gender_priced
    t.integer('price_girls');
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('updated_by').references('id').inTable('users');
    t.primary(['item_id', 'school_id']);
  });
  await knex.raw(`ALTER TABLE item_prices ADD CONSTRAINT item_prices_positive_chk CHECK (
    (price IS NULL OR price > 0) AND (price_boys IS NULL OR price_boys > 0) AND (price_girls IS NULL OR price_girls > 0))`);

  await knex.schema.createTable('item_price_changes', (t) => {
    t.bigIncrements('id');
    t.integer('item_id').notNullable().references('id').inTable('items').onDelete('CASCADE');
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.jsonb('old_price');   // { price, boys, girls } or null when it started being sold
    t.jsonb('new_price');   // same, or null when it stopped being sold
    t.integer('changed_by').references('id').inTable('users');
    t.timestamp('at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['item_id', 'at']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('item_price_changes');
  await knex.schema.dropTableIfExists('item_prices');
  await knex.schema.dropTableIfExists('items');
  await knex.raw('ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_students_chk');
  await knex.schema.alterTable('schools', (t) => t.dropColumn('students'));
};

