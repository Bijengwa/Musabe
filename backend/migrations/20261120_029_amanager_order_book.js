// Recovery migration for an existing database migration named 20261120_029_amanager_order_book.
// The orders and order_lines tables were created in an earlier local checkout.
// This no-op keeps Knex migration history and source files in sync without changing existing data.
exports.up = async function up() {};
exports.down = async function down() {};
