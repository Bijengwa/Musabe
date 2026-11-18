// The school does not use the PREM number: the column is removed. The Admission No. stays the student's number.
// A "PREM NUMBER" column in an uploaded class list is now simply ignored (like the fee columns).
exports.up = (knex) => knex.schema.alterTable('students', (t) => { t.dropColumn('prem_no'); });
exports.down = (knex) => knex.schema.alterTable('students', (t) => { t.string('prem_no', 20); });
