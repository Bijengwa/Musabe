// Two kinds of requisition (2026-11-17).
//   academic: stationery used in lessons (from the library): staff -> Academic Master -> Head Master -> administration store-keeper -> Manager
//   general:  everything else (uniforms, bed sheets, brooms...): staff -> the school's store-keeper (the librarian) -> Head Master -> ... same
// The first school step keeps the status name "acad" (its signer depends on the kind). Old requisitions are all "academic".
exports.up = async (knex) => {
  await knex.schema.alterTable('requisitions', (t) => { t.string('kind', 10).notNullable().defaultTo('academic'); });
  await knex.raw(`ALTER TABLE requisitions ADD CONSTRAINT requisitions_kind_chk CHECK (kind IN ('academic','general'))`);
  // A new requisition is "general" unless the applicant says it is for lessons.
  await knex.raw(`ALTER TABLE requisitions ALTER COLUMN kind DROP DEFAULT`);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION musabe_requisition_kind_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.kind IS DISTINCT FROM OLD.kind AND NOT OLD.returned THEN RAISE EXCEPTION 'The kind of a requisition cannot be changed after it is written.'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER requisitions_kind_guard BEFORE UPDATE ON requisitions FOR EACH ROW EXECUTE FUNCTION musabe_requisition_kind_guard();`);
};
exports.down = async (knex) => {
  await knex.raw('DROP TRIGGER IF EXISTS requisitions_kind_guard ON requisitions');
  await knex.raw('DROP FUNCTION IF EXISTS musabe_requisition_kind_guard()');
  await knex.raw('ALTER TABLE requisitions DROP CONSTRAINT requisitions_kind_chk');
  await knex.schema.alterTable('requisitions', (t) => { t.dropColumn('kind'); });
};
