// The buying flow (owner, 2026-11-18): the buyer (store-keeper / Assistant Manager, on the phone) fills what he bought and SIGNS ->
// Mapokezi checks the goods and signs -> the form goes to the Cashier, the buyer gives back what is left of the money, the Cashier signs.
// Then QR labels go on each item and the goods go to the school.
exports.up = async (knex) => {
  await knex.schema.alterTable('purchases', (t) => {
    t.integer('float_id').references('id').inTable('payment_requests');   // the money the Cashier gave for this buying
    t.bigInteger('balance_expected');                                    // money given less the goods Mapokezi found
    t.bigInteger('returned_amount');                                     // what the buyer really gave back
    t.string('settle_note', 300);
  });
};
exports.down = async (knex) => {
  await knex.schema.alterTable('purchases', (t) => { ['float_id', 'balance_expected', 'returned_amount', 'settle_note'].forEach((c) => t.dropColumn(c)); });
};
