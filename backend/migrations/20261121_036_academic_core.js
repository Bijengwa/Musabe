exports.up = async (knex) => {
  await knex.schema.createTable('academic_subjects', (t) => {
    t.increments('id'); t.integer('school_id').references('id').inTable('schools').onDelete('RESTRICT');
    t.string('name', 80).notNullable(); t.string('code', 30); t.string('stage', 10).notNullable().defaultTo('primary');
    t.boolean('active').notNullable().defaultTo(true); t.integer('created_by').notNullable().references('id').inTable('users');
    t.timestamps(true, true); t.index(['school_id', 'stage']);
  });
  await knex.raw("ALTER TABLE academic_subjects ADD CONSTRAINT academic_subjects_stage_chk CHECK (stage IN ('pre','primary','secondary'))");
  await knex.raw("CREATE UNIQUE INDEX academic_subjects_name_uq ON academic_subjects (coalesce(school_id,0), lower(name), stage) ");

  await knex.schema.createTable('class_subjects', (t) => {
    t.increments('id'); t.integer('class_id').notNullable().references('id').inTable('classes').onDelete('RESTRICT');
    t.integer('subject_id').notNullable().references('id').inTable('academic_subjects').onDelete('RESTRICT');
    t.integer('teacher_id').references('id').inTable('users').onDelete('RESTRICT'); t.boolean('active').notNullable().defaultTo(true);
    t.integer('created_by').notNullable().references('id').inTable('users'); t.timestamps(true, true);
  });
  await knex.raw('CREATE UNIQUE INDEX class_subjects_uq ON class_subjects (class_id, subject_id)');

  await knex.schema.createTable('academic_timetable_entries', (t) => {
    t.increments('id'); t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('class_id').notNullable().references('id').inTable('classes').onDelete('RESTRICT');
    t.integer('subject_id').notNullable().references('id').inTable('academic_subjects').onDelete('RESTRICT');
    t.integer('teacher_id').references('id').inTable('users').onDelete('RESTRICT'); t.integer('year').notNullable(); t.integer('term').notNullable();
    t.integer('day').notNullable(); t.integer('period').notNullable(); t.string('room', 60); t.string('note', 200);
    t.integer('created_by').notNullable().references('id').inTable('users'); t.integer('updated_by').references('id').inTable('users');
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE academic_timetable_entries ADD CONSTRAINT academic_timetable_day_chk CHECK (day BETWEEN 1 AND 7 AND term BETWEEN 1 AND 3 AND period BETWEEN 1 AND 12)`);
  await knex.raw('CREATE UNIQUE INDEX academic_timetable_slot_uq ON academic_timetable_entries (school_id, year, term, class_id, day, period)');

  await knex.schema.createTable('academic_lesson_plans', (t) => {
    t.increments('id'); t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('class_id').notNullable().references('id').inTable('classes').onDelete('RESTRICT');
    t.integer('subject_id').notNullable().references('id').inTable('academic_subjects').onDelete('RESTRICT');
    t.integer('teacher_id').notNullable().references('id').inTable('users').onDelete('RESTRICT'); t.integer('year').notNullable(); t.integer('term').notNullable();
    t.integer('week').notNullable(); t.date('lesson_date'); t.string('topic', 200).notNullable(); t.text('objectives'); t.text('activities'); t.text('resources');
    t.string('status', 12).notNullable().defaultTo('draft'); t.integer('reviewed_by').references('id').inTable('users'); t.timestamp('reviewed_at', {useTz:true});
    t.integer('created_by').notNullable().references('id').inTable('users'); t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE academic_lesson_plans ADD CONSTRAINT academic_lesson_plan_status_chk CHECK (status IN ('draft','submitted','approved','rejected'))`);

  await knex.schema.createTable('academic_syllabus_topics', (t) => {
    t.increments('id'); t.integer('subject_id').notNullable().references('id').inTable('academic_subjects').onDelete('RESTRICT');
    t.string('level', 10).notNullable(); t.integer('term').notNullable(); t.integer('sn').notNullable(); t.string('name', 200).notNullable();
    t.boolean('active').notNullable().defaultTo(true); t.integer('created_by').notNullable().references('id').inTable('users'); t.timestamps(true, true);
  });
  await knex.raw('CREATE UNIQUE INDEX academic_syllabus_topic_uq ON academic_syllabus_topics (subject_id, level, term, sn)');

  await knex.schema.createTable('academic_syllabus_progress', (t) => {
    t.increments('id'); t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('class_id').notNullable().references('id').inTable('classes').onDelete('RESTRICT'); t.integer('subject_id').notNullable().references('id').inTable('academic_subjects').onDelete('RESTRICT');
    t.integer('topic_id').notNullable().references('id').inTable('academic_syllabus_topics').onDelete('RESTRICT'); t.integer('teacher_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.integer('year').notNullable(); t.integer('term').notNullable(); t.date('taught_date'); t.string('status', 12).notNullable().defaultTo('not_started');
    t.decimal('coverage',5,2).notNullable().defaultTo(0); t.string('note',300); t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE academic_syllabus_progress ADD CONSTRAINT academic_syllabus_status_chk CHECK (status IN ('not_started','in_progress','completed') AND coverage BETWEEN 0 AND 100)`);
  await knex.raw('CREATE UNIQUE INDEX academic_syllabus_progress_uq ON academic_syllabus_progress (class_id, subject_id, topic_id, year, term)');

  await knex.schema.createTable('academic_exam_papers', (t) => {
    t.increments('id'); t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('class_id').notNullable().references('id').inTable('classes').onDelete('RESTRICT'); t.integer('subject_id').notNullable().references('id').inTable('academic_subjects').onDelete('RESTRICT');
    t.integer('teacher_id').references('id').inTable('users').onDelete('RESTRICT'); t.integer('year').notNullable(); t.integer('term').notNullable();
    t.string('title', 160).notNullable(); t.date('exam_date'); t.decimal('total_marks',7,2).notNullable().defaultTo(0);
    t.string('status', 14).notNullable().defaultTo('draft'); t.integer('created_by').notNullable().references('id').inTable('users');
    t.integer('submitted_by').references('id').inTable('users'); t.timestamp('submitted_at',{useTz:true}); t.integer('released_by').references('id').inTable('users'); t.timestamp('released_at',{useTz:true});
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE academic_exam_papers ADD CONSTRAINT academic_exam_status_chk CHECK (status IN ('draft','marks_pending','submitted','revision','released'))`);

  await knex.schema.createTable('academic_exam_questions', (t) => {
    t.increments('id'); t.integer('paper_id').notNullable().references('id').inTable('academic_exam_papers').onDelete('CASCADE');
    t.integer('sn').notNullable(); t.string('name', 120); t.decimal('max_marks',7,2).notNullable(); t.string('topic',160);
  });
  await knex.raw('CREATE UNIQUE INDEX academic_exam_questions_uq ON academic_exam_questions (paper_id, sn)');

  await knex.schema.createTable('academic_exam_marks', (t) => {
    t.increments('id'); t.integer('paper_id').notNullable().references('id').inTable('academic_exam_papers').onDelete('CASCADE');
    t.integer('student_id').notNullable().references('id').inTable('students').onDelete('RESTRICT'); t.jsonb('question_marks').notNullable().defaultTo('{}');
    t.decimal('total',7,2).notNullable().defaultTo(0); t.decimal('percent',7,2).notNullable().defaultTo(0); t.string('grade',10);
    t.integer('entered_by').notNullable().references('id').inTable('users'); t.integer('corrected_by').references('id').inTable('users'); t.timestamp('corrected_at',{useTz:true});
    t.timestamps(true, true);
  });
  await knex.raw('CREATE UNIQUE INDEX academic_exam_marks_uq ON academic_exam_marks (paper_id, student_id)');

  await knex.schema.createTable('academic_mark_corrections', (t) => {
    t.increments('id'); t.integer('mark_id').notNullable().references('id').inTable('academic_exam_marks').onDelete('CASCADE');
    t.integer('question_sn').notNullable(); t.decimal('old_marks',7,2).notNullable(); t.decimal('new_marks',7,2).notNullable();
    t.string('reason',300).notNullable(); t.integer('corrected_by').notNullable().references('id').inTable('users'); t.timestamp('created_at',{useTz:true}).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('academic_primary_report_cards', (t) => {
    t.increments('id'); t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('class_id').notNullable().references('id').inTable('classes').onDelete('RESTRICT'); t.integer('student_id').notNullable().references('id').inTable('students').onDelete('RESTRICT');
    t.integer('year').notNullable(); t.integer('term').notNullable(); t.jsonb('subjects').notNullable().defaultTo('[]'); t.decimal('total',9,2).notNullable().defaultTo(0);
    t.decimal('average',7,2).notNullable().defaultTo(0); t.integer('position'); t.integer('out_of'); t.string('grade',10); t.string('teacher_remark',300);
    t.string('head_remark',300); t.string('status',10).notNullable().defaultTo('draft'); t.integer('released_by').references('id').inTable('users'); t.timestamp('released_at',{useTz:true});
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE academic_primary_report_cards ADD CONSTRAINT academic_report_status_chk CHECK (status IN ('draft','ready','released'))`);
  await knex.raw('CREATE UNIQUE INDEX academic_primary_report_card_uq ON academic_primary_report_cards (school_id, class_id, student_id, year, term)');

  await knex.raw(`ALTER TABLE parent_notices DROP CONSTRAINT IF EXISTS parent_notices_chk`);
  await knex.raw(`ALTER TABLE parent_notices ADD CONSTRAINT parent_notices_chk CHECK (kind IN ('given','issued','returned','receipt','report'))`);
};

exports.down = async (knex) => {
  await knex.raw(`ALTER TABLE parent_notices DROP CONSTRAINT IF EXISTS parent_notices_chk`);
  await knex.raw(`ALTER TABLE parent_notices ADD CONSTRAINT parent_notices_chk CHECK (kind IN ('given','issued','returned','receipt'))`);
  await knex.schema.dropTableIfExists('academic_primary_report_cards'); await knex.schema.dropTableIfExists('academic_mark_corrections'); await knex.schema.dropTableIfExists('academic_exam_marks');
  await knex.schema.dropTableIfExists('academic_exam_questions'); await knex.schema.dropTableIfExists('academic_exam_papers'); await knex.schema.dropTableIfExists('academic_syllabus_progress');
  await knex.schema.dropTableIfExists('academic_syllabus_topics'); await knex.schema.dropTableIfExists('academic_lesson_plans'); await knex.schema.dropTableIfExists('academic_timetable_entries');
  await knex.schema.dropTableIfExists('class_subjects'); await knex.schema.dropTableIfExists('academic_subjects');
};
