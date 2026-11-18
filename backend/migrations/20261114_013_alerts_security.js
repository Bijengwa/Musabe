// Reminders and security (2026-11-14).
// - alerts_sent: each reminder (e.g. "delivery DLV.0003 not confirmed after 48 hours") is sent once. The key says what it was.
// - users.temp_password_expires_at: a temporary password works for TEMP_PASSWORD_HOURS only (72 by default).
// - Price history and the activity log can never be changed or deleted, not even by the owner account
//   (before: item_price_changes was deleted with its item, ON DELETE CASCADE).
exports.up = async (knex) => {
  await knex.schema.createTable('alerts_sent', (t) => {
    t.string('key', 120).primary();
    t.timestamp('at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('users', (t) => { t.timestamp('temp_password_expires_at', { useTz: true }); });

  await knex.raw('ALTER TABLE item_price_changes DROP CONSTRAINT IF EXISTS item_price_changes_item_id_foreign');
  await knex.raw(`ALTER TABLE item_price_changes ADD CONSTRAINT item_price_changes_item_id_foreign
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT`);

  await knex.raw(`
    CREATE FUNCTION musabe_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'History cannot be changed or deleted (%).', TG_TABLE_NAME; END $$;
    CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION musabe_history_guard();
    CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION musabe_history_guard();
    CREATE TRIGGER item_price_changes_no_update BEFORE UPDATE ON item_price_changes FOR EACH ROW EXECUTE FUNCTION musabe_history_guard();
    CREATE TRIGGER item_price_changes_no_delete BEFORE DELETE ON item_price_changes FOR EACH ROW EXECUTE FUNCTION musabe_history_guard();
  `);
};

exports.down = async (knex) => {
  await knex.raw(`
    DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log; DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
    DROP TRIGGER IF EXISTS item_price_changes_no_update ON item_price_changes; DROP TRIGGER IF EXISTS item_price_changes_no_delete ON item_price_changes;
    DROP FUNCTION IF EXISTS musabe_history_guard();
  `);
  await knex.raw('ALTER TABLE item_price_changes DROP CONSTRAINT IF EXISTS item_price_changes_item_id_foreign');
  await knex.raw(`ALTER TABLE item_price_changes ADD CONSTRAINT item_price_changes_item_id_foreign
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE`);
  await knex.schema.alterTable('users', (t) => t.dropColumn('temp_password_expires_at'));
  await knex.schema.dropTableIfExists('alerts_sent');
};
