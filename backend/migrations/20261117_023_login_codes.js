// One account, one person at a time (2026-11-17).
// A successful sign-in ends every other session of that account. If the account is in use on another device right now
// (seen in the last few minutes), the new sign-in also needs a 6-digit code sent by SMS to the phone number of the
// account owner. The code is kept only as a hash, lives 5 minutes, allows 5 tries, and can be sent 3 times.
exports.up = async (knex) => {
  await knex.schema.createTable('login_codes', (t) => {
    t.increments('id');
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('challenge_hash', 64).notNullable().unique();      // sha256 of the random challenge the browser holds
    t.string('code_hash', 64).notNullable();                    // sha256 of user id + code
    t.boolean('remember').notNullable().defaultTo(false);
    t.string('ip', 64);
    t.string('user_agent', 255);
    t.string('reason', 10).notNullable().defaultTo('inuse');    // inuse | always
    t.integer('attempts').notNullable().defaultTo(0);
    t.integer('sends').notNullable().defaultTo(1);
    t.timestamp('sent_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('used_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
  });
};
exports.down = async (knex) => { await knex.schema.dropTableIfExists('login_codes'); };
