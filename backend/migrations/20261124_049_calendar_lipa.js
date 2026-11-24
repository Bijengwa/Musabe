// 049 (2026-11-24): school calendar (terms, holidays, June program for the pupils who stay) and lipa numbers for mobile money.
// - school_terms: the Head Master writes each term (opens, closes, short break, study days). Changes are audited.
// - school_holidays: the Head Master declares a holiday. Then he opens a program for the classes that stay at school.
// - holiday_programs / holiday_program_classes / holiday_program_items: who stays and what they do each day.
// - lipa_numbers: the mobile-money lipa numbers of a school. The parent sees them in the app and says "I paid" with the transaction number;
//   the Accountant checks the money and marks the control number paid (bills.claim_*).
exports.up = async (knex) => {
  await knex.schema.createTable('school_terms', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.integer('year').notNullable();
    t.integer('term').notNullable();
    t.date('opens_on').notNullable();
    t.date('closes_on').notNullable();
    t.date('break_from');
    t.date('break_to');
    t.integer('study_days');
    t.integer('set_by').notNullable().references('id').inTable('users');
    t.timestamp('set_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['school_id', 'year', 'term']);
  });
  await knex.raw(`ALTER TABLE school_terms ADD CONSTRAINT school_terms_chk CHECK (term BETWEEN 1 AND 3 AND closes_on > opens_on AND (study_days IS NULL OR study_days BETWEEN 1 AND 300)
    AND ((break_from IS NULL AND break_to IS NULL) OR (break_from IS NOT NULL AND break_to IS NOT NULL AND break_from >= opens_on AND break_to <= closes_on AND break_to >= break_from)))`);

  await knex.schema.createTable('school_holidays', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.integer('year').notNullable();
    t.string('name', 80).notNullable();
    t.date('from_date').notNullable();
    t.date('to_date').notNullable();
    t.integer('declared_by').notNullable().references('id').inTable('users');
    t.timestamp('declared_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['school_id', 'from_date']);
  });
  await knex.raw(`ALTER TABLE school_holidays ADD CONSTRAINT school_holidays_chk CHECK (to_date >= from_date)`);

  await knex.schema.createTable('holiday_programs', (t) => {
    t.increments('id');
    t.integer('holiday_id').notNullable().unique().references('id').inTable('school_holidays');
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.string('title', 120).notNullable();
    t.string('note', 500);
    t.string('status', 9).notNullable().defaultTo('draft');      // draft | published
    t.integer('created_by').notNullable().references('id').inTable('users');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('published_by').references('id').inTable('users');
    t.timestamp('published_at', { useTz: true });
  });
  await knex.raw(`ALTER TABLE holiday_programs ADD CONSTRAINT holiday_programs_chk CHECK (status IN ('draft','published'))`);
  await knex.schema.createTable('holiday_program_classes', (t) => {
    t.integer('program_id').notNullable().references('id').inTable('holiday_programs');
    t.integer('class_id').notNullable().references('id').inTable('classes');
    t.primary(['program_id', 'class_id']);
  });
  await knex.schema.createTable('holiday_program_items', (t) => {
    t.increments('id');
    t.integer('program_id').notNullable().references('id').inTable('holiday_programs');
    t.date('day').notNullable();
    t.string('start_time', 5).notNullable();
    t.string('end_time', 5).notNullable();
    t.string('activity', 160).notNullable();
    t.integer('class_id').references('id').inTable('classes');   // empty = every class in the program
    t.integer('teacher_id').references('id').inTable('users');
    t.string('place', 80);
    t.integer('created_by').notNullable().references('id').inTable('users');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['program_id', 'day']);
  });
  await knex.raw(`ALTER TABLE holiday_program_items ADD CONSTRAINT hpi_chk CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_time > start_time)`);

  await knex.schema.createTable('lipa_numbers', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.string('network', 10).notNullable();                         // mpesa | tigo | airtel | halo | azam | other
    t.string('number', 20).notNullable();
    t.string('account_name', 80).notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('created_by').notNullable().references('id').inTable('users');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['school_id', 'network', 'number']);
  });
  await knex.raw(`ALTER TABLE lipa_numbers ADD CONSTRAINT lipa_chk CHECK (network IN ('mpesa','tigo','airtel','halo','azam','other') AND number ~ '^[0-9]{5,12}$')`);

  await knex.schema.alterTable('bills', (t) => {
    t.string('claim_network', 10);
    t.string('claim_ref', 60);
    t.timestamp('claim_at', { useTz: true });
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('bills', (t) => { ['claim_network', 'claim_ref', 'claim_at'].forEach((c) => t.dropColumn(c)); });
  for (const t of ['lipa_numbers', 'holiday_program_items', 'holiday_program_classes', 'holiday_programs', 'school_holidays', 'school_terms']) await knex.schema.dropTableIfExists(t);
};
