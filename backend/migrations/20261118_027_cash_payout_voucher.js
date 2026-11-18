// The Requested Cash Payout Voucher (2026-11-18), as on the paper: Date, Cheque No., Name of payee, S/NO | DETAIL | AMOUNT, TOTAL
// (with what it is for), Total in words, Prepared by, Authorized by, Signature of payee.
// Flow of an internal payment: the Assistant Accountant prepares it -> the Financial Officer authorizes (or rejects) -> the Cashier pays;
// the payee signs on the screen. Money to buy for a requisition (a float) is authorized by the Manager when he signs the requisition.
exports.up = async (knex) => {
  await knex.schema.alterTable('payment_requests', (t) => {
    t.string('payee_name', 120);
    t.string('cheque_no', 40);
    t.integer('authorized_by').references('id').inTable('users');
    t.timestamp('authorized_at', { useTz: true });
    t.string('authorize_note', 300);
  });
  await knex.raw('ALTER TABLE payment_requests ALTER COLUMN approved_by_name DROP NOT NULL');
  await knex.schema.createTable('payment_lines', (t) => {
    t.increments('id');
    t.integer('payment_id').notNullable().references('id').inTable('payment_requests');
    t.integer('sn').notNullable();
    t.string('detail', 200).notNullable();
    t.bigInteger('amount').notNullable();
    t.unique(['payment_id', 'sn']);
  });
  await knex.raw('ALTER TABLE payment_requests DROP CONSTRAINT IF EXISTS payment_requests_chk');
  await knex.raw(`ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_chk CHECK (
    status IN ('review','pending','paid','rejected') AND kind IN ('general','float')
    AND ((kind = 'general' AND amount > 0) OR (kind = 'float' AND amount >= 0 AND requisition_id IS NOT NULL)))`);
  // Old requests already approved by name outside the system keep working: their authorizer is the name written.
};
exports.down = async (knex) => {
  await knex.raw(`UPDATE payment_requests SET status = 'pending' WHERE status = 'review'`);
  await knex.raw('ALTER TABLE payment_requests DROP CONSTRAINT IF EXISTS payment_requests_chk');
  await knex.raw(`ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_chk CHECK (
    status IN ('pending','paid','rejected') AND kind IN ('general','float')
    AND ((kind = 'general' AND amount > 0) OR (kind = 'float' AND amount >= 0 AND requisition_id IS NOT NULL)))`);
  await knex.schema.dropTableIfExists('payment_lines');
  await knex.schema.alterTable('payment_requests', (t) => { ['payee_name', 'cheque_no', 'authorized_by', 'authorized_at', 'authorize_note'].forEach((c) => t.dropColumn(c)); });
};
