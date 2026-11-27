// 053 (2026-11-25): money for a requisition and the papers after the buying.
// - The Cashier gives the money against the Payment Requisition Form itself (Requisition payments). The amount given may be
//   equal to, more or less than the total written: the total is only an estimate. (No schema change: payment_requests.amount.)
// - After the buying: Mapokezi accepts the goods -> the Assistant Accountant checks -> the Manager (or Finance Manager) approves ->
//   the Cashier writes the Cheque / Cash Payment Voucher with the REAL amounts. Then the change is handed back and the goods go on.
exports.up = async (knex) => {
  await knex.schema.alterTable('purchases', (t) => {
    t.integer('acheck_by').references('id').inTable('users');       // Assistant Accountant checked it
    t.timestamp('acheck_at', { useTz: true });
    t.string('acheck_note', 300);
    t.integer('mgr_by').references('id').inTable('users');         // Manager / Finance Manager approved it
    t.timestamp('mgr_at', { useTz: true });
    t.string('mgr_note', 300);
    t.string('pay_method', 10);                                     // cash | cheque (Cheque / Cash Payment Voucher)
    t.string('cheque_no', 40);
    t.bigInteger('actual_amount');                                  // what the goods really cost (confirmed quantity x cost)
  });
  await knex.raw(`ALTER TABLE purchases ADD CONSTRAINT purchases_pay_method_chk CHECK (pay_method IS NULL OR pay_method IN ('cash','cheque'))`);
};
exports.down = async (knex) => {
  await knex.raw('ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_pay_method_chk');
  await knex.schema.alterTable('purchases', (t) => { ['acheck_by', 'acheck_at', 'acheck_note', 'mgr_by', 'mgr_at', 'mgr_note', 'pay_method', 'cheque_no', 'actual_amount'].forEach((c) => t.dropColumn(c)); });
};
