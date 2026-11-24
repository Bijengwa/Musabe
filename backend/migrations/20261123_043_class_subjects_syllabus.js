// 043 (2026-11-23): subjects of each class level + the built-in syllabus.
// - academic_subjects becomes the subject list of each class level: level, curriculum, short name, order,
//   a parent (P7 Social Studies = Geography + History), the built-in syllabus it follows, shown on the report or not.
//   Built-in subjects (from src/lib/subjects.js) have built_in = true and no created_by.
// - syllabi / syllabus_topics / syllabus_items: the official syllabi read from the TIE PDFs (docs/curriculum),
//   stored once for all schools. topic = specific competence (with its main competence), item = learning activity.
//   Read-only for the app.
// - class_subjects (already there) keeps the teacher of each subject in each stream.
const path = require('path');
const { ensureSchoolSubjects } = require('../src/lib/subjects');

async function loadSyllabi(knex) {
  const data = require(path.join(__dirname, '../src/data/syllabus-2027-primary.json'));
  for (const sy of data) {
    if (await knex('syllabi').where({ ref: sy.ref }).first('id')) continue;
    const [row] = await knex('syllabi').insert({ ref: sy.ref, title: sy.title, curriculum: 'new', source_file: sy.source, language: sy.language }).returning('id');
    let sn = 0;
    for (const t of sy.topics) {
      const [topic] = await knex('syllabus_topics').insert({
        syllabus_id: row.id, level: t.level, sn: ++sn, main_no: t.mainNo || null, main_text: t.main || null,
        no: t.no || null, text: t.text || '', periods: t.periods || null,
      }).returning('id');
      if (t.items.length) {
        await knex('syllabus_items').insert(t.items.map((it, i) => ({ topic_id: topic.id, sn: i + 1, text: it.text, periods: it.periods || null })));
      }
    }
  }
}

exports.up = async (knex) => {
  await knex.schema.createTable('syllabi', (t) => {
    t.increments('id');
    t.string('ref', 12).notNullable().unique();
    t.string('title', 160).notNullable();
    t.string('curriculum', 6).notNullable();
    t.string('source_file', 200);
    t.string('language', 4);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('syllabus_topics', (t) => {
    t.increments('id');
    t.integer('syllabus_id').notNullable().references('id').inTable('syllabi');
    t.string('level', 10).notNullable();
    t.integer('sn').notNullable();
    t.string('main_no', 10);
    t.text('main_text');
    t.string('no', 10);
    t.text('text').notNullable();
    t.integer('periods');
    t.index(['syllabus_id', 'level']);
  });
  await knex.schema.createTable('syllabus_items', (t) => {
    t.increments('id');
    t.integer('topic_id').notNullable().references('id').inTable('syllabus_topics');
    t.integer('sn').notNullable();
    t.text('text').notNullable();
    t.integer('periods');
    t.index(['topic_id']);
  });

  await knex.schema.alterTable('academic_subjects', (t) => {
    t.string('level', 10);
    t.string('curriculum', 6);
    t.string('short_name', 20);
    t.integer('sn');
    t.integer('parent_id').references('id').inTable('academic_subjects');
    t.string('syllabus_ref', 12);
    t.jsonb('syllabus_parts').notNullable().defaultTo('[]');
    t.boolean('on_report').notNullable().defaultTo(true);
    t.boolean('built_in').notNullable().defaultTo(false);
    t.integer('updated_by').references('id').inTable('users');
  });
  await knex.raw('ALTER TABLE academic_subjects ALTER COLUMN created_by DROP NOT NULL');
  await knex.raw(`ALTER TABLE academic_subjects ADD CONSTRAINT academic_subjects_cur_chk CHECK (curriculum IS NULL OR curriculum IN ('new','old','school'))`);
  // The same name is allowed in many classes (Mathematics P3 … P7), once per class level and curriculum.
  await knex.raw('DROP INDEX IF EXISTS academic_subjects_name_uq');
  await knex.raw(`CREATE UNIQUE INDEX academic_subjects_name_uq ON academic_subjects
    (coalesce(school_id,0), stage, coalesce(level,''), coalesce(curriculum,''), lower(name))`);
  await knex.raw('CREATE INDEX academic_subjects_level_idx ON academic_subjects (school_id, level, curriculum)');

  await loadSyllabi(knex);
  for (const sc of await knex('schools').select('id', 'code')) await ensureSchoolSubjects(knex, sc.id, sc.code);
};

exports.down = async (knex) => {
  // Built-in subjects that nothing points to are removed; the rest stay (their columns go).
  await knex.raw(`DELETE FROM academic_subjects a WHERE built_in AND parent_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM class_subjects c WHERE c.subject_id = a.id)`);
  await knex.raw(`DELETE FROM academic_subjects a WHERE built_in
    AND NOT EXISTS (SELECT 1 FROM class_subjects c WHERE c.subject_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM academic_subjects k WHERE k.parent_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM academic_timetable_entries e WHERE e.subject_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM academic_exam_papers p WHERE p.subject_id = a.id)`);
  await knex.raw('DROP INDEX IF EXISTS academic_subjects_level_idx');
  await knex.raw('DROP INDEX IF EXISTS academic_subjects_name_uq');
  await knex.raw('ALTER TABLE academic_subjects DROP CONSTRAINT IF EXISTS academic_subjects_cur_chk');
  await knex.schema.alterTable('academic_subjects', (t) => {
    for (const c of ['level', 'curriculum', 'short_name', 'sn', 'parent_id', 'syllabus_ref', 'syllabus_parts', 'on_report', 'built_in', 'updated_by']) t.dropColumn(c);
  });
  await knex.raw('CREATE UNIQUE INDEX academic_subjects_name_uq ON academic_subjects (coalesce(school_id,0), lower(name), stage)');
  await knex.schema.dropTableIfExists('syllabus_items');
  await knex.schema.dropTableIfExists('syllabus_topics');
  await knex.schema.dropTableIfExists('syllabi');
};
