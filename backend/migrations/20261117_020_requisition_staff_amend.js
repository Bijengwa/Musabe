// Requisitions from any staff member, and amendments before signing (2026-11-17).
// - A teacher, librarian or bursar can ask too. It goes to the Academic Master first, then the Head Master; the
//   administration (store-keeper, Manager) never sees it before both school signatures are on it.
//   New first step: status 'acad'. Requisitions written by the Academic Master or the Head Master skip it as before.
// - The Academic Master and the Head Master may amend what was asked (quantities, remove a thing, add a thing)
//   before signing. A line is never deleted: it is marked removed, and the first quantity is kept (orig_qty).
exports.up = async (knex) => {
  await knex.schema.alterTable('requisitions', (t) => {
    t.integer('acad_by').references('id').inTable('users'); t.timestamp('acad_at', { useTz: true }); t.string('acad_note', 300);
  });
  await knex.schema.alterTable('requisition_lines', (t) => {
    t.boolean('removed').notNullable().defaultTo(false);   // taken off by the Academic Master / Head Master
    t.integer('orig_qty');                                  // what was first asked, kept when someone changes the quantity
    t.integer('added_by').references('id').inTable('users'); // set on a thing added by a signer
  });
  await knex.raw('ALTER TABLE requisitions DROP CONSTRAINT requisitions_chk');
  await knex.raw(`ALTER TABLE requisitions ADD CONSTRAINT requisitions_chk CHECK (status IN
    ('acad','head','store','manager','approved','buying','arrived','sent','done','rejected','withdrawn'))`);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION musabe_requisition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE ord text[] := ARRAY['acad','head','store','manager','approved','buying','arrived','sent','done'];
    BEGIN
      IF OLD.status IN ('done','rejected','withdrawn') THEN RAISE EXCEPTION 'This requisition is finished and cannot be changed.'; END IF;
      IF NEW.status NOT IN ('rejected','withdrawn') AND array_position(ord, NEW.status) < array_position(ord, OLD.status)
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
  if (await knex('requisitions').where('status', 'acad').first()) throw new Error('Cannot roll back: some requisitions wait for the Academic Master.');
  await knex.schema.alterTable('requisition_lines', (t) => { t.dropColumn('added_by'); t.dropColumn('orig_qty'); t.dropColumn('removed'); });
  await knex.schema.alterTable('requisitions', (t) => { t.dropColumn('acad_note'); t.dropColumn('acad_at'); t.dropColumn('acad_by'); });
  await knex.raw('ALTER TABLE requisitions DROP CONSTRAINT requisitions_chk');
  await knex.raw(`ALTER TABLE requisitions ADD CONSTRAINT requisitions_chk CHECK (status IN
    ('head','store','manager','approved','buying','arrived','sent','done','rejected','withdrawn'))`);
};
