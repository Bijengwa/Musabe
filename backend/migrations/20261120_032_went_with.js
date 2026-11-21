// 2026-11-20: the store-keeper and the Assistant Manager sometimes go to the market together. One of them holds the money
// and signs as the buyer; the other is written as "Went with" and signs too. Mapokezi checks only after both have signed.
exports.up = async (knex) => {
  await knex.schema.alterTable('purchases', (t) => {
    t.integer('went_with').references('id').inTable('users');
    t.timestamp('went_with_signed_at', { useTz: true });
  });
};
exports.down = async (knex) => {
  await knex.schema.alterTable('purchases', (t) => { t.dropColumn('went_with_signed_at'); t.dropColumn('went_with'); });
};
