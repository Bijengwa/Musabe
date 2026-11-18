// Money for an approved requisition (2026-11-17). When the Manager approves a school requisition, a "float" payment
// request is made for it at once: the Cashier gives the store-keeper the money to buy, and Mapokezi is told that
// goods are coming to be checked. A float is a payment request with kind = 'float' and the requisition it is for.
exports.up = async (knex) => {
  await knex.schema.alterTable('payment_requests', (t) => {
    t.string('kind', 10).notNullable().defaultTo('general');            // general | float
    t.integer('requisition_id').references('id').inTable('requisitions'); // set when kind = float
    t.bigInteger('est_amount');                                          // what the requisition costs, about
  });
  await knex.raw('ALTER TABLE payment_requests DROP CONSTRAINT IF EXISTS payment_requests_chk');
  await knex.raw(`ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_chk CHECK (
    status IN ('pending','paid','rejected') AND kind IN ('general','float')
    AND ((kind = 'general' AND amount > 0) OR (kind = 'float' AND amount >= 0 AND requisition_id IS NOT NULL)))`);
  // One float per requisition.
  await knex.raw(`CREATE UNIQUE INDEX payment_requests_one_float ON payment_requests (requisition_id) WHERE kind = 'float'`);
};
exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS payment_requests_one_float');
  await knex.raw('ALTER TABLE payment_requests DROP CONSTRAINT IF EXISTS payment_requests_chk');
  await knex.schema.alterTable('payment_requests', (t) => { t.dropColumn('est_amount'); t.dropColumn('requisition_id'); t.dropColumn('kind'); });
  await knex.raw(`ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_chk CHECK (amount > 0 AND status IN ('pending','paid','rejected'))`);
};
