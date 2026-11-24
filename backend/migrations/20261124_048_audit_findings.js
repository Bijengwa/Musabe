// 048 (2026-11-24): Accountant office, internal audit.
// audit_findings: something the Accountant took from an automatic check and follows until he closes it with a written reason.
// audit_finding_notes: every note added to a finding. Nothing is deleted or changed.
exports.up = async (knex) => {
  await knex.schema.createTable('audit_findings', (t) => {
    t.increments('id');
    t.string('check_key', 30).notNullable();
    t.string('ref', 60).notNullable();                      // what the check pointed at, e.g. "money:12:2026-11-20"
    t.integer('school_id').references('id').inTable('schools');
    t.string('title', 200).notNullable();
    t.string('severity', 6).notNullable().defaultTo('medium');
    t.string('status', 6).notNullable().defaultTo('open');  // open | closed
    t.integer('opened_by').notNullable().references('id').inTable('users');
    t.timestamp('opened_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('closed_by').references('id').inTable('users');
    t.timestamp('closed_at', { useTz: true });
    t.string('close_note', 500);
    t.index(['status', 'school_id']);
  });
  await knex.raw(`ALTER TABLE audit_findings ADD CONSTRAINT audit_findings_chk CHECK (status IN ('open','closed') AND severity IN ('low','medium','high'))`);
  await knex.raw(`CREATE UNIQUE INDEX audit_findings_open_uq ON audit_findings (check_key, ref) WHERE status = 'open'`);
  await knex.schema.createTable('audit_finding_notes', (t) => {
    t.increments('id');
    t.integer('finding_id').notNullable().references('id').inTable('audit_findings');
    t.string('note', 500).notNullable();
    t.integer('by').notNullable().references('id').inTable('users');
    t.timestamp('at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['finding_id']);
  });
  await knex.raw(`CREATE TRIGGER audit_finding_notes_no_delete BEFORE DELETE ON audit_finding_notes FOR EACH ROW EXECUTE FUNCTION musabe_no_delete();
    CREATE TRIGGER audit_finding_notes_no_update BEFORE UPDATE ON audit_finding_notes FOR EACH ROW EXECUTE FUNCTION musabe_no_update();`);
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('audit_finding_notes');
  await knex.schema.dropTableIfExists('audit_findings');
};
