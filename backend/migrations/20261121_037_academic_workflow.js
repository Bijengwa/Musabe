exports.up = async (knex) => {
  await knex.schema.createTable('academic_teaching_logs', (t) => {
    t.increments('id'); t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.integer('class_id').notNullable().references('id').inTable('classes').onDelete('RESTRICT'); t.integer('subject_id').notNullable().references('id').inTable('academic_subjects').onDelete('RESTRICT');
    t.integer('topic_id').references('id').inTable('academic_syllabus_topics').onDelete('RESTRICT'); t.integer('teacher_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.integer('year').notNullable(); t.integer('term').notNullable(); t.date('taught_date').notNullable(); t.string('topic_name',200).notNullable(); t.decimal('understanding',5,2).notNullable().defaultTo(0);
    t.text('student_observation'); t.string('quiz_name',160); t.text('quiz_notes'); t.integer('created_by').notNullable().references('id').inTable('users'); t.timestamps(true,true);
  });
  await knex.raw(`ALTER TABLE academic_teaching_logs ADD CONSTRAINT academic_teaching_logs_chk CHECK (understanding BETWEEN 0 AND 100 AND term BETWEEN 1 AND 3)`);

  await knex.schema.createTable('academic_quizzes', (t) => {
    t.increments('id'); t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT'); t.integer('class_id').notNullable().references('id').inTable('classes').onDelete('RESTRICT');
    t.integer('subject_id').notNullable().references('id').inTable('academic_subjects').onDelete('RESTRICT'); t.integer('topic_id').references('id').inTable('academic_syllabus_topics').onDelete('RESTRICT');
    t.integer('teacher_id').notNullable().references('id').inTable('users').onDelete('RESTRICT'); t.integer('year').notNullable(); t.integer('term').notNullable(); t.string('title',160).notNullable();
    t.string('kind',12).notNullable().defaultTo('typed'); t.jsonb('questions').notNullable().defaultTo('[]'); t.integer('created_by').notNullable().references('id').inTable('users'); t.timestamps(true,true);
  });
  await knex.raw(`ALTER TABLE academic_quizzes ADD CONSTRAINT academic_quizzes_kind_chk CHECK (kind IN ('typed','document','typed_document'))`);

  await knex.schema.createTable('academic_quiz_documents', (t) => {
    t.increments('id'); t.integer('quiz_id').notNullable().references('id').inTable('academic_quizzes').onDelete('CASCADE'); t.string('mime',80).notNullable(); t.binary('data').notNullable();
    t.string('file_name',200).notNullable(); t.integer('uploaded_by').notNullable().references('id').inTable('users'); t.timestamp('uploaded_at',{useTz:true}).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('ALTER TABLE academic_quiz_documents ADD CONSTRAINT academic_quiz_documents_size_chk CHECK (octet_length(data) <= 10000000)');

  await knex.schema.createTable('academic_exam_timetable', (t) => {
    t.increments('id'); t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT'); t.integer('class_id').notNullable().references('id').inTable('classes').onDelete('RESTRICT');
    t.integer('subject_id').notNullable().references('id').inTable('academic_subjects').onDelete('RESTRICT'); t.integer('paper_id').references('id').inTable('academic_exam_papers').onDelete('SET NULL');
    t.integer('year').notNullable(); t.integer('term').notNullable(); t.string('title',160).notNullable(); t.date('exam_date').notNullable(); t.time('starts_at'); t.time('ends_at');
    t.string('venue',120); t.string('invigilator_ids',500); t.integer('created_by').notNullable().references('id').inTable('users'); t.timestamps(true,true);
  });
  await knex.raw(`ALTER TABLE academic_exam_timetable ADD CONSTRAINT academic_exam_timetable_chk CHECK (term BETWEEN 1 AND 3)`);
  await knex.raw('CREATE UNIQUE INDEX academic_exam_timetable_uq ON academic_exam_timetable (school_id, year, term, class_id, subject_id, exam_date)');

  await knex.schema.createTable('academic_mark_reviews', (t) => {
    t.increments('id'); t.integer('paper_id').notNullable().references('id').inTable('academic_exam_papers').onDelete('CASCADE'); t.integer('reviewer_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.string('status',12).notNullable(); t.string('note',500); t.timestamp('created_at',{useTz:true}).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE academic_mark_reviews ADD CONSTRAINT academic_mark_reviews_chk CHECK (status IN ('approved','returned'))`);
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('academic_mark_reviews'); await knex.schema.dropTableIfExists('academic_exam_timetable');
  await knex.schema.dropTableIfExists('academic_quiz_documents'); await knex.schema.dropTableIfExists('academic_quizzes'); await knex.schema.dropTableIfExists('academic_teaching_logs');
};
