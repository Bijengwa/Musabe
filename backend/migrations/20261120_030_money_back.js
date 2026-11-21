// Recovery migration: the database already contains the money-back schema changes.
// This no-op restores Knex file/history consistency without changing existing data.
exports.up = async function up() {};
exports.down = async function down() {};
