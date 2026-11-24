// 044 (2026-11-23): read the built-in syllabi again after cleaning the text found by testing:
// letters cut off ("D evelop" -> "Develop"), words split at a line end ("pre- writing" -> "pre-writing"),
// and a few pre-primary cells that ran into the next column. Periods do not change.
const { loadSyllabi } = require('../src/lib/syllabi');

exports.up = async (knex) => { await loadSyllabi(knex, { replace: true }); };
exports.down = async () => { /* the cleaned text stays */ };
