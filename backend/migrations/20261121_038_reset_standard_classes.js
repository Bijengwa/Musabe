exports.up = async (knex) => {
  await knex.transaction(async (trx) => {
    // Destructive reset requested: remove all student-linked academic/identity data.
    if (await trx.schema.hasTable('academic_primary_report_cards')) await trx('academic_primary_report_cards').del();
    if (await trx.schema.hasTable('academic_exam_marks')) await trx('academic_exam_marks').del();
    if (await trx.schema.hasTable('parent_notices')) await trx('parent_notices').del();
    if (await trx.schema.hasTable('student_guardians')) await trx('student_guardians').del();
    if (await trx.schema.hasTable('photos')) await trx('photos').whereNotNull('student_id').del();
    if (await trx.schema.hasTable('id_cards')) await trx('id_cards').whereNotNull('student_id').del();
    if (await trx.schema.hasTable('admission_interviews')) {
      await trx('admission_interviews').whereNotNull('student_id').update({ student_id: null });
      await trx('students').update({ interview_id: null }).catch(() => {});
    }
    if (await trx.schema.hasColumn('receipts', 'student_id')) await trx('receipts').update({ student_id: null });
    if (await trx.schema.hasTable('issues')) await trx('issues').whereNotNull('student_id').update({ student_id: null });

    await trx('students').del();
    await trx('student_imports').del().catch(() => {});

    // Clear academic records that depend on classes.
    const classTables = ['academic_teaching_logs','academic_quizzes','academic_exam_timetable','academic_timetable_entries','academic_lesson_plans','academic_syllabus_progress','academic_exam_papers','academic_primary_report_cards','class_subjects'];
    for (const table of classTables) if (await trx.schema.hasTable(table)) await trx(table).del();

    await trx('classes').del();

    const levels = {
      pre: [
        ['BABY','BABY CLASS','BC','school'], ['PP1','PREP ONE','PP 1','school'], ['PP2','PREP TWO','PP 2','new'],
        ['P1','PRIMARY ONE','P 1','new'], ['P2','PRIMARY TWO','P 2','new'], ['P3','PRIMARY THREE','P 3','new'],
        ['P4','PRIMARY FOUR','P 4','new'], ['P5','PRIMARY FIVE','P 5','new'], ['P6','PRIMARY SIX','P 6','new'], ['P7','PRIMARY SEVEN','P 7','old'],
      ],
      secondary: [
        ['F1','FORM ONE','F 1','new'], ['F2','FORM TWO','F 2','new'], ['F3','FORM THREE','F 3','new'], ['F4','FORM FOUR','F 4','old'],
      ],
    };

    const schools = await trx('schools').select('id','code','active');
    for (const school of schools) {
      const code = String(school.code || '').toLowerCase();
      const list = code === 'pre' ? levels.pre : (code === 'boys' || code === 'girls' ? levels.secondary : []);
      for (let i = 0; i < list.length; i++) {
        const [level, name, shortName, curriculum] = list[i];
        await trx('classes').insert({ school_id: school.id, level, name, short_name: shortName, stream: null, curriculum, sort: i + 1, active: true });
      }
    }
  });
};

exports.down = async () => {
  throw new Error('Destructive standard-class reset cannot be rolled back. Restore from backup to undo this migration.');
};
