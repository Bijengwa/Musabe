// Money going out: payment requisitions (2026-11-17). First slice of the Money-going-out module — one request,
// approved by name outside the system (the Director, the Manager...), then paid by the Cashier, who checks that
// approval before paying. Floats and vouchers for purchases come next (needs the purchases flow finished first).
exports.up = async (knex) => {
  await knex.schema.createTable('payment_requests', (t) => {
    t.increments('id');
    t.string('number', 20);                         // PRQ.0001
    t.string('purpose', 300).notNullable();          // what it is for (e.g. "Part payment: contractor agreement with X")
    t.bigInteger('amount').notNullable();
    t.string('approved_by_name', 120).notNullable(); // who approved it outside the system, e.g. "Director Mr. Daniel Musabe"
    t.string('contract_ref', 80);                    // optional: which contract/agreement this is a part-payment against
    t.integer('requested_by').notNullable().references('id').inTable('users');
    t.timestamp('requested_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('status', 10).notNullable().defaultTo('pending'); // pending | paid | rejected
    t.integer('paid_by').references('id').inTable('users');
    t.timestamp('paid_at', { useTz: true });
    t.string('pay_note', 300);
    t.index(['status']);
  });
  await knex.raw(`ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_chk CHECK (
    amount > 0 AND status IN ('pending','paid','rejected'))`);
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('payment_requests');
};
