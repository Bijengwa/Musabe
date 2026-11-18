// The printed receipt copies the school's paper receipt book.
// - Receipt numbers are REC.0001, REC.0002 ... and run separately in each school (each school has its own book),
//   so the number is unique per school, not across schools.
// - Each school keeps the text printed at the top and bottom of its receipt (Super Admin edits it on the Schools page).
const CONTACT = 'P.O. Box 5154, BUGANDO, MWANZA, TEL: +255 782 110494,\n+255 754 654545, +255 769 197 221\nEmail:musabeschools@yahoo.co.uk';
const TITLE = { boys: 'MUSABE BOYS SEC. SCHOOL', girls: 'MUSABE GIRLS SEC. SCHOOL', pre: 'MUSABE ENGLISH MEDIUM SCHOOL' };

exports.up = async (knex) => {
  await knex.schema.alterTable('schools', (t) => {
    t.string('receipt_title', 80);    // MUSABE BOYS SEC. SCHOOL
    t.text('receipt_contact');        // P.O. Box, phones, email (one line each)
    t.string('receipt_signer', 80);   // the "For:" line under the signature: ACCOUNTANT MUSABE MEDIUM
  });
  for (const s of await knex('schools')) {
    await knex('schools').where({ id: s.id }).update({
      receipt_title: TITLE[s.code] || s.name.toUpperCase(), receipt_contact: CONTACT, receipt_signer: 'ACCOUNTANT MUSABE MEDIUM',
    });
  }
  await knex.raw('ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_number_unique');
  await knex.raw('CREATE UNIQUE INDEX receipts_school_number_uq ON receipts (school_id, number)');
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS receipts_school_number_uq');
  await knex.raw('ALTER TABLE receipts ADD CONSTRAINT receipts_number_unique UNIQUE (number)');
  await knex.schema.alterTable('schools', (t) => { t.dropColumn('receipt_title'); t.dropColumn('receipt_contact'); t.dropColumn('receipt_signer'); });
};
