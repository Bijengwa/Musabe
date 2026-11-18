// Signatures (2026-11-18). A person signs a paper in the system with a signing PIN; the picture of their drawn signature
// (kept in My profile) goes on the paper. Every signature is sealed: a code made from the paper's numbers and the earlier
// signatures, so changing a number afterwards breaks the seal. Signatures are history: never changed, never deleted.
exports.up = async (knex) => {
  await knex.schema.alterTable('users', (t) => {
    t.text('signature_image');                       // PNG data URL of the drawn signature
    t.string('signing_pin_hash', 100);               // bcrypt of the signing PIN (4-6 digits), not the password
    t.integer('pin_fails').notNullable().defaultTo(0);
    t.timestamp('pin_locked_until', { useTz: true });
  });
  await knex.schema.createTable('signatures', (t) => {
    t.increments('id');
    t.string('doc_type', 20).notNullable();          // requisition | voucher | ...
    t.integer('doc_id').notNullable();
    t.string('step', 20).notNullable();              // applicant, acad, head, store, manager, prepared, authorized, paid, payee ...
    t.integer('user_id').references('id').inTable('users');   // NULL for a payee who is not a user
    t.string('user_name', 120).notNullable();
    t.string('role', 20);
    t.text('image');
    t.boolean('acting').notNullable().defaultTo(false);
    t.string('note', 200);
    t.string('content_hash', 64).notNullable();      // sha256 of the paper's numbers at this moment
    t.string('prev_mac', 64);                        // the seal of the signature before this one on the same paper
    t.string('mac', 64).notNullable();               // HMAC over everything above (server secret)
    t.timestamp('signed_at', { useTz: true }).notNullable();
    t.string('ip', 64);
    t.index(['doc_type', 'doc_id']);
  });
  await knex.schema.createTable('sign_codes', (t) => {  // SMS code asked for a big amount
    t.increments('id');
    t.integer('user_id').notNullable().references('id').inTable('users');
    t.string('doc_type', 20).notNullable();
    t.integer('doc_id').notNullable();
    t.string('code_hash', 64).notNullable();
    t.integer('attempts').notNullable().defaultTo(0);
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('used_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`CREATE TRIGGER signatures_no_update BEFORE UPDATE ON signatures FOR EACH ROW EXECUTE FUNCTION musabe_history_guard()`);
  await knex.raw(`CREATE TRIGGER signatures_no_delete BEFORE DELETE ON signatures FOR EACH ROW EXECUTE FUNCTION musabe_history_guard()`);
};
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('sign_codes');
  await knex.raw('DROP TRIGGER IF EXISTS signatures_no_update ON signatures; DROP TRIGGER IF EXISTS signatures_no_delete ON signatures');
  await knex.schema.dropTableIfExists('signatures');
  await knex.schema.alterTable('users', (t) => { ['signature_image', 'signing_pin_hash', 'pin_fails', 'pin_locked_until'].forEach((c) => t.dropColumn(c)); });
};
