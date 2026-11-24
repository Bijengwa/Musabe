// Reconciles supplier support with databases that already have the advanced schema.
// On a new, empty database it does nothing: migration 035 (office buying) makes the full suppliers table and
// purchases.supplier_id itself. (Before 2026-11-23 it made a small suppliers table here, and 035 then failed.)
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('suppliers'))) return;
  if (!(await knex.schema.hasColumn('purchases', 'supplier_id'))) {
    await knex.schema.alterTable('purchases', (t) => {
      t.integer('supplier_id').references('id').inTable('suppliers').onDelete('RESTRICT');
    });
  }
};
exports.down = async function down() {
  // purchases.supplier_id belongs to 035 (or was there before); nothing to undo here.
};
