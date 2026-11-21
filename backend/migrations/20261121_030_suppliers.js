// Reconciles supplier support with databases that already have the advanced schema.
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('suppliers'))) {
    await knex.schema.createTable('suppliers', (t) => {
      t.increments('id');
      t.string('name', 120).notNullable();
      t.boolean('active').notNullable().defaultTo(true);
      t.integer('created_by').notNullable().references('id').inTable('users').onDelete('RESTRICT');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }
  if (!(await knex.schema.hasColumn('purchases', 'supplier_id'))) {
    await knex.schema.alterTable('purchases', (t) => {
      t.integer('supplier_id').references('id').inTable('suppliers').onDelete('RESTRICT');
    });
  }
};
exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('purchases', 'supplier_id')) {
    await knex.schema.alterTable('purchases', (t) => t.dropColumn('supplier_id'));
  }
};
