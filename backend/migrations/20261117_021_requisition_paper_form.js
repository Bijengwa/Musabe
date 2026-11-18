// The requisition becomes the paper "PAYMENT REQUISITION FORM" (2026-11-17).
// - Details of request are the applicant's own words (free text). No link to the item list, no unit.
//   The store-keeper links or creates the stock item only when he buys / receives the goods.
// - Department requesting and Name of applicant, as on the paper.
// - Only the applicant changes what was written (words, amount@). Every signer may only change a QUANTITY, or send it
//   back to the applicant ("returned") with a reason. While it is returned nobody can sign it, and it stays at the same step.
// - The database guard allows the written words (purpose, department, applicant) to change only while it is returned.
exports.up = async (knex) => {
  await knex.schema.alterTable('requisitions', (t) => {
    t.string('department', 80);                                   // old rows: NULL = the school
    t.string('applicant_name', 100);                              // old rows: NULL = the user who asked
    t.boolean('returned').notNullable().defaultTo(false);
    t.integer('returned_by').references('id').inTable('users');
    t.timestamp('returned_at', { useTz: true });
    t.string('returned_note', 300);
  });
  await knex.raw('ALTER TABLE requisition_lines ALTER COLUMN item_name TYPE varchar(200)');
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
      IF OLD.returned AND NEW.returned AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('rejected','withdrawn') THEN
        RAISE EXCEPTION 'This requisition was sent back to the applicant. It cannot move before it is corrected.';
      END IF;
      IF (NEW.school_id, NEW.requested_by, NEW.requested_at, NEW.number) IS DISTINCT FROM (OLD.school_id, OLD.requested_by, OLD.requested_at, OLD.number)
         OR (NOT OLD.returned AND (NEW.purpose, NEW.department, NEW.applicant_name) IS DISTINCT FROM (OLD.purpose, OLD.department, OLD.applicant_name))
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
  if (await knex('requisitions').where('returned', true).first()) throw new Error('Cannot roll back: some requisitions are sent back to their applicants.');
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
  await knex.schema.alterTable('requisitions', (t) => { t.dropColumn('returned_note'); t.dropColumn('returned_at'); t.dropColumn('returned_by'); t.dropColumn('returned'); t.dropColumn('applicant_name'); t.dropColumn('department'); });
};
