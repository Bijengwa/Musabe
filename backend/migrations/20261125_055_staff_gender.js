// 055 (2026-11-25): gender of a staff member ('m' or 'f'). It gives the title (Mr. / Ms.) and the post name
// (Head Master / Head Mistress, Second Master / Mistress...). Empty for old accounts until the administrator sets it.
exports.up = async (knex) => {
  await knex.schema.alterTable('users', (t) => { t.string('gender', 1).nullable(); });
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_gender_check CHECK (gender IS NULL OR gender IN ('m', 'f'))`);
};
exports.down = async (knex) => {
  await knex.raw('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_gender_check');
  await knex.schema.alterTable('users', (t) => { t.dropColumn('gender'); });
};
