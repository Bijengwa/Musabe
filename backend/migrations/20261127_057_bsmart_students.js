// 057 (2026-11-27): the B-SMART "Student details" report is the first import. It is compared with our students.
// A file of this kind is kept as the reference (kind 'students'); nothing in our students is changed by it.
exports.up = async (knex) => {
  await knex.raw('ALTER TABLE bsmart_files DROP CONSTRAINT IF EXISTS bsmart_files_chk');
  await knex.raw(`ALTER TABLE bsmart_files ADD CONSTRAINT bsmart_files_chk CHECK (kind IN ('students','fees','payments') AND status IN ('pending','approved','discarded'))`);
  await knex.schema.alterTable('bsmart_files', (t) => { t.string('kind', 10).notNullable().alter(); });
};
exports.down = async (knex) => {
  await knex('bsmart_files').where({ kind: 'students' }).del();
  await knex.raw('ALTER TABLE bsmart_files DROP CONSTRAINT IF EXISTS bsmart_files_chk');
  await knex.raw(`ALTER TABLE bsmart_files ADD CONSTRAINT bsmart_files_chk CHECK (kind IN ('fees','payments') AND status IN ('pending','approved','discarded'))`);
};
