// Excel uploads of items and prices wait here until the person who uploaded them checks and approves them.
// Nothing reaches the items list before approval. The file itself is kept, so it is checked again
// against today's prices at the moment of approval.
exports.up = async (knex) => {
  await knex.schema.createTable('item_imports', (t) => {
    t.increments('id');
    t.string('file_name', 200).notNullable();
    t.binary('file').notNullable();
    t.integer('uploaded_by').notNullable().references('id').inTable('users');
    t.string('status', 10).notNullable().defaultTo('pending'); // pending | approved | discarded
    t.jsonb('summary');                                        // counts at upload time, for the list
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('decided_at', { useTz: true });
    t.integer('decided_by').references('id').inTable('users');
    t.index(['status', 'created_at']);
  });
  await knex.raw(`ALTER TABLE item_imports ADD CONSTRAINT item_imports_status_chk CHECK (status IN ('pending','approved','discarded'))`);
};
exports.down = (knex) => knex.schema.dropTableIfExists('item_imports');
