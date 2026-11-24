// 052 (2026-11-24): fixed times and fixed parts of the class timetables.
// - timetable_layouts: for each school and class level (or group of levels, like Nursery PP1 & PP2): the periods with their
//   clock times and kind (lesson / break / lunch / other), and the fixed parts (PE on Wednesday, Religion on Friday ...).
//   The Academic Master / Mistress edits them; until she does, the starting layouts in src/lib/timetable-defaults.js are used.
// - Up to 14 periods a day (the boarding class has 13).
exports.up = async (knex) => {
  await knex.schema.createTable('timetable_layouts', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.string('group_key', 12).notNullable();
    t.integer('days').notNullable().defaultTo(5);
    t.jsonb('periods').notNullable().defaultTo('[]');
    t.jsonb('items').notNullable().defaultTo('[]');
    t.integer('updated_by').references('id').inTable('users');
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['school_id', 'group_key']);
  });
  await knex.raw('ALTER TABLE timetable_layouts ADD CONSTRAINT timetable_layouts_days_chk CHECK (days IN (5, 6))');
  await knex.raw('ALTER TABLE academic_timetable_entries DROP CONSTRAINT academic_timetable_day_chk');
  await knex.raw('ALTER TABLE academic_timetable_entries ADD CONSTRAINT academic_timetable_day_chk CHECK (day BETWEEN 1 AND 7 AND term BETWEEN 1 AND 3 AND period BETWEEN 1 AND 14)');
  await knex.raw('ALTER TABLE timetable_periods DROP CONSTRAINT timetable_periods_chk');
  await knex.raw(`ALTER TABLE timetable_periods ADD CONSTRAINT timetable_periods_chk CHECK (term BETWEEN 1 AND 2 AND period BETWEEN 1 AND 14 AND kind IN ('lesson','break','lunch','other'))`);
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('timetable_layouts');
};
