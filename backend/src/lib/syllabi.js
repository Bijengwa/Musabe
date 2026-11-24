// Load the built-in syllabi (src/data/syllabus-2027-primary.json, made by scripts/syllabus/) into the database.
// syllabi -> syllabus_topics (specific competences) -> syllabus_items (learning activities). Read-only for the app.
const path = require('path');

async function loadSyllabi(knex, { replace = false } = {}) {
  const file = path.join(__dirname, '../data/syllabus-2027-primary.json');
  delete require.cache[require.resolve(file)];
  const data = require(file);
  for (const sy of data) {
    let row = await knex('syllabi').where({ ref: sy.ref }).first('id');
    if (row && !replace) continue;
    if (row) {
      // Nothing else points to topics or items yet, so they are simply read again.
      await knex('syllabus_items').whereIn('topic_id', knex('syllabus_topics').where({ syllabus_id: row.id }).select('id')).del();
      await knex('syllabus_topics').where({ syllabus_id: row.id }).del();
      await knex('syllabi').where({ id: row.id }).update({ title: sy.title, source_file: sy.source, language: sy.language });
    } else {
      [row] = await knex('syllabi').insert({ ref: sy.ref, title: sy.title, curriculum: 'new', source_file: sy.source, language: sy.language }).returning('id');
    }
    let sn = 0;
    for (const t of sy.topics) {
      const [topic] = await knex('syllabus_topics').insert({
        syllabus_id: row.id, level: t.level, sn: ++sn, main_no: t.mainNo || null, main_text: t.main || null,
        no: t.no || null, text: t.text || '', periods: t.periods || null,
      }).returning('id');
      if (t.items.length) await knex('syllabus_items').insert(t.items.map((it, i) => ({ topic_id: topic.id, sn: i + 1, text: it.text, periods: it.periods || null })));
    }
  }
}

module.exports = { loadSyllabi };
