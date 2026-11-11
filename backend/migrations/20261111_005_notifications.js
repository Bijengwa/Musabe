// Notifications: when each person last opened the bell. Newer activity counts as unread.
exports.up = (knex) => knex.schema.alterTable('users', (t) => {
  t.timestamp('notif_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
});
exports.down = (knex) => knex.schema.alterTable('users', (t) => t.dropColumn('notif_seen_at'));
