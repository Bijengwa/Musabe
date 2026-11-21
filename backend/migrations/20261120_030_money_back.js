// 2026-11-20: when Mapokezi rejects what was bought, the buyer either goes back to the market (a new buying form)
// or gives the money back to the Cashier. The Cashier records the money he received; the requisition is then "closed"
// (a final step, like done or rejected).
exports.up = async (knex) => {
  await knex.schema.alterTable('requisitions', (t) => {
    t.timestamp('money_back_asked_at', { useTz: true });   // the buyer says he will bring the money back
    t.bigInteger('money_back_amount');
    t.integer('money_back_by').references('id').inTable('users');   // the Cashier who received it
    t.timestamp('money_back_at', { useTz: true });
    t.string('money_back_note', 300);
  });
  await knex.raw('ALTER TABLE requisitions DROP CONSTRAINT requisitions_chk');
  await knex.raw(`ALTER TABLE requisitions ADD CONSTRAINT requisitions_chk CHECK (status IN
    ('acad','head','store','manager','approved','buying','arrived','sent','done','rejected','withdrawn','closed'))`);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION musabe_requisition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE ord text[] := ARRAY['acad','head','store','manager','approved','buying','arrived','sent','done'];
    BEGIN
      IF OLD.status IN ('done','rejected','withdrawn','closed') THEN RAISE EXCEPTION 'This requisition is finished and cannot be changed.'; END IF;
      IF NEW.status = 'closed' AND OLD.status NOT IN ('approved','buying') THEN RAISE EXCEPTION 'Only a requisition being bought can be closed with the money given back.'; END IF;
      IF NEW.status NOT IN ('rejected','withdrawn','closed') AND array_position(ord, NEW.status) < array_position(ord, OLD.status)
         AND NOT (OLD.status = 'sent' AND NEW.status IN ('approved','arrived'))
         AND NOT (OLD.status = 'buying' AND NEW.status = 'approved') THEN
        RAISE EXCEPTION 'A requisition cannot go back a step.';
      END IF;
      IF (NEW.school_id, NEW.requested_by, NEW.requested_at, NEW.purpose, NEW.number) IS DISTINCT FROM (OLD.school_id, OLD.requested_by, OLD.requested_at, OLD.purpose, OLD.number)
         OR (OLD.acad_by IS NOT NULL AND NEW.acad_by IS DISTINCT FROM OLD.acad_by)
         OR (OLD.head_by IS NOT NULL AND NEW.head_by IS DISTINCT FROM OLD.head_by)
         OR (OLD.store_by IS NOT NULL AND NEW.store_by IS DISTINCT FROM OLD.store_by)
         OR (OLD.manager_by IS NOT NULL AND NEW.manager_by IS DISTINCT FROM OLD.manager_by) THEN
        RAISE EXCEPTION 'A signed requisition cannot be changed.';
      END IF;
      RETURN NEW;
    END $$;`);
};

exports.down = async (knex) => {
  if (await knex('requisitions').where('status', 'closed').first()) throw new Error('Cannot roll back: some requisitions are closed with money given back.');
  await knex.raw('ALTER TABLE requisitions DROP CONSTRAINT requisitions_chk');
  await knex.raw(`ALTER TABLE requisitions ADD CONSTRAINT requisitions_chk CHECK (status IN
    ('acad','head','store','manager','approved','buying','arrived','sent','done','rejected','withdrawn'))`);
  await knex.schema.alterTable('requisitions', (t) => { ['money_back_asked_at', 'money_back_amount', 'money_back_by', 'money_back_at', 'money_back_note'].forEach((c) => t.dropColumn(c)); });
};
