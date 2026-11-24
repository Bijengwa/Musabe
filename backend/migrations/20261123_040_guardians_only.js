// 2026-11-23: ONE list of guardians per student.
// Before: the Students screen showed students.parent_name / parent_phone, while the Excel download showed
// student_guardians. Two different lists, so the screen and the download did not agree.
// Now only student_guardians is used (screen, Excel, bulk edit, Sell, ID card, parents' app).
// - The old parent on each student record becomes that student's first guardian (if not already in the list).
// - More relationships: grandfather, grandmother, uncle, aunt.
// - position: the order of the guardians (Guardian 1, 2, 3 ...).
// - students.parent_name and students.parent_phone are removed.
const RELATIONS = ['father', 'mother', 'brother', 'sister', 'grandfather', 'grandmother', 'uncle', 'aunt', 'guardian', 'other'];

exports.up = async (knex) => {
  await knex.schema.alterTable('student_guardians', (t) => { t.integer('position').notNullable().defaultTo(0); });
  await knex.raw('ALTER TABLE student_guardians DROP CONSTRAINT IF EXISTS student_guardians_relationship_chk');
  await knex.raw(`ALTER TABLE student_guardians ADD CONSTRAINT student_guardians_relationship_chk CHECK (relationship IN (${RELATIONS.map((r) => `'${r}'`).join(',')}))`);

  // Order of the guardians already saved: as they were added.
  await knex.raw(`UPDATE student_guardians g SET position = x.n
    FROM (SELECT id, row_number() OVER (PARTITION BY student_id ORDER BY id) AS n FROM student_guardians) x WHERE x.id = g.id`);

  if (await knex.schema.hasColumn('students', 'parent_phone')) {
    // The old parent comes first (position 0), unless the same phone is already in the list.
    const someone = await knex('users').orderBy('id').first('id');
    const rows = await knex('students as s').whereNotNull('s.parent_phone')
      .whereNotExists(knex('student_guardians as g').whereRaw('g.student_id = s.id AND g.phone = s.parent_phone'))
      .select('s.id', 's.school_id', 's.parent_name', 's.parent_phone', 's.created_by', 's.updated_by');
    for (let i = 0; i < rows.length; i += 500) {
      const part = rows.slice(i, i + 500).filter((s) => /^0[67]\d{8}$/.test(s.parent_phone));
      if (!part.length) continue;
      await knex('student_guardians').insert(part.map((s) => ({
        student_id: s.id, school_id: s.school_id, full_name: (s.parent_name || 'NAME NOT GIVEN').slice(0, 120), phone: s.parent_phone,
        relationship: 'guardian', position: 0, created_by: s.updated_by || s.created_by || someone?.id,
      })));
    }
    await knex.raw('DROP INDEX IF EXISTS students_parent_phone_idx');
    await knex.schema.alterTable('students', (t) => { t.dropColumn('parent_name'); t.dropColumn('parent_phone'); });
  }
  // Positions 0, 1, 2 ... with no gaps.
  await knex.raw(`UPDATE student_guardians g SET position = x.n - 1
    FROM (SELECT id, row_number() OVER (PARTITION BY student_id ORDER BY position, id) AS n FROM student_guardians) x WHERE x.id = g.id`);
  // The parents' app looks children up by phone.
  await knex.raw('CREATE INDEX IF NOT EXISTS student_guardians_phone_idx ON student_guardians (phone)');
  await knex.raw('CREATE INDEX IF NOT EXISTS student_guardians_school_phone_idx ON student_guardians (school_id, phone)');
};

exports.down = async (knex) => {
  await knex.schema.alterTable('students', (t) => { t.string('parent_name', 120); t.string('parent_phone', 10); });
  await knex.raw(`UPDATE students s SET parent_name = g.full_name, parent_phone = g.phone
    FROM (SELECT DISTINCT ON (student_id) student_id, full_name, phone FROM student_guardians ORDER BY student_id, position, id) g WHERE g.student_id = s.id`);
  await knex.raw('CREATE INDEX IF NOT EXISTS students_parent_phone_idx ON students (parent_phone) WHERE parent_phone IS NOT NULL');
  await knex.raw('DROP INDEX IF EXISTS student_guardians_phone_idx');
  await knex.raw('DROP INDEX IF EXISTS student_guardians_school_phone_idx');
  await knex.raw(`DELETE FROM student_guardians WHERE relationship NOT IN ('mother','father','brother','sister','guardian','other')`);
  await knex.raw('ALTER TABLE student_guardians DROP CONSTRAINT IF EXISTS student_guardians_relationship_chk');
  await knex.raw(`ALTER TABLE student_guardians ADD CONSTRAINT student_guardians_relationship_chk CHECK (relationship IN ('mother','father','brother','sister','guardian','other'))`);
  await knex.schema.alterTable('student_guardians', (t) => { t.dropColumn('position'); });
};
