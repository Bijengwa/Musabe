// Profile and personal settings: an email the person adds themselves,
// and their own preferences (look of the app), kept on the server so they follow them to every device.
exports.up = async (knex) => {
  await knex.schema.alterTable('users', (t) => {
    t.string('email', 120);
    t.jsonb('preferences').notNullable().defaultTo('{}');
  });
  await knex.raw('CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email)) WHERE email IS NOT NULL');
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS users_email_lower_uq');
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('preferences');
    t.dropColumn('email');
  });
};
