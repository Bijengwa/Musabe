// Subjects of each class level, built into the system (2026-11-23).
//
// The subject list comes from the school's own subject sheets (P.1–P.7, PP.1, PP.2, Baby Class), so the names change
// from class to class as they do on paper: Numeracy (nursery) -> Arithmetic (P1–P2) -> Mathematics (P3–P7).
// Each subject may point to a built-in syllabus (src/data/syllabus-2027-primary.json, read from the TIE PDFs in
// docs/curriculum) and to the parts of it that belong to this subject:
//   parts: ['4']        = every specific competence under main competence 4.0
//   parts: ['3.3','3.4'] = only those specific competences
//   parts: []           = the whole syllabus for that level
// A subject with no syllabus (ICT, Kuandika, French in P2 …) is the school's own: the Academic Master types its topics.
//
// Curriculum keys stay as saved in classes.curriculum; the screens show them by year (see levels.js CURRICULA):
//   new = "2027 curriculum", old = "2026 and before curriculum", school = "School's own".
//
// P7 (2026 and before curriculum): Social Studies (SST) is one subject on the report, taught as two parts,
// Geography and History (they have their own periods on the timetable).

const PRE = 'PRE', STD12 = 'STD12';
const s = (name, short, syllabus = null, parts = [], extra = {}) => ({ name, short, syllabus, parts, ...extra });

const nursery = {
  BABY: { curriculum: 'school', subjects: [
    s('Numeracy Skills', 'NUM', PRE, ['6.1']),
    s('Reading Skills', 'READ', PRE, ['3.3']),
    s('Communication Skills', 'COMM', PRE, ['3.1', '3.2', '3.5']),
    s('Health Care', 'H/CARE', PRE, ['5.1', '5.2', '5.3', '5.7']),
  ] },
  PP1: { curriculum: 'school', subjects: [
    s('Numeracy Skills', 'NUM', PRE, ['6.1']),
    s('Communication Skills', 'COMM', PRE, ['3.1', '3.2', '3.5', '4']),
    s('Reading Skills', 'READ', PRE, ['3.3']),
    s('Kuandika Kiswahili', 'KUANDIKA'),
    s('Sports and Art', 'C.A.S', PRE, ['1', '2']),
    s('Environmental Care', 'ENV', PRE, ['5.4', '5.5', '5.6', '6.2']),
  ] },
  PP2: { curriculum: 'new', subjects: [
    s('Numeracy Skills', 'NUM', PRE, ['6.1', '6.3']),
    s('Communication Skills', 'COMM', PRE, ['3.1', '3.2', '3.5', '4']),
    s('Reading Skills', 'READ', PRE, ['3.3', '3.4']),
    s('Kuandika Kiswahili', 'KUANDIKA'),
    s('Health Care', 'H/CARE', PRE, ['5.1', '5.2', '5.3', '5.7']),
    s('Sports and Art', 'C.A.S', PRE, ['1', '2']),
    s('Environmental Care', 'ENV', PRE, ['5.4', '5.5', '5.6', '6.2']),
  ] },
};

const lower = (withFrench) => [
  s('Arithmetic', 'ARTH', STD12, ['4']),
  s('Reading', 'READ', STD12, ['1', '2']),
  s('Writing', 'WRIT', STD12, ['3']),
  s('Kusoma', 'KUSOMA', STD12, ['5']),
  s('Kuandika', 'KUANDIKA'),
  s('Environmental Care', 'ENV', STD12, ['7']),
  s('ICT', 'ICT'),
  s('Culture, Arts and Sports', 'C.A.S', STD12, ['6']),
  ...(withFrench ? [s('French', 'FRENCH')] : []),
];

const middle = (languages) => [
  s('Mathematics', 'MATHS', 'MATH'),
  s('Science', 'SCIE', 'SCI'),
  s('Kiswahili', 'KISW', 'KIS'),
  s('English', 'ENG', 'ENG'),
  s('Geography and Environment', 'GEO', 'GEO'),
  s('History of Tanzania and Ethics', 'HIST', 'HIST'),
  s('ICT', 'ICT'),
  s('Culture, Arts and Sports', 'C.A.S', 'CAS'),
  ...(languages ? [s('French', 'FRENCH', 'FRE'), s('Chinese', 'CHINESE', 'CHI')] : []),
];

const primary = {
  P1: { curriculum: 'new', subjects: lower(false) },
  P2: { curriculum: 'new', subjects: lower(true) },
  // P4 and P6: the French and Chinese columns are marked out on the school's sheet (to be confirmed).
  P3: { curriculum: 'new', subjects: middle(true) },
  P4: { curriculum: 'new', subjects: middle(false) },
  P5: { curriculum: 'new', subjects: middle(true) },
  P6: { curriculum: 'new', subjects: middle(false) },
  P7: { curriculum: 'old', subjects: [
    s('Mathematics', 'MATHS'),
    s('Science', 'SCIE'),
    s('Kiswahili', 'KISW'),
    s('English', 'ENG'),
    s('Social Studies', 'SST', null, [], { children: [s('Geography', 'GEO'), s('History', 'HIST')] }),
    s('Civic and Moral Education', 'CME'),
    s('ICT', 'ICT'),
    s('Vocational Skills', 'V/SK'),
  ] },
};

// Built-in lists by schools.code. Secondary schools come next (their subjects differ by form and curriculum).
const BY_SCHOOL = { pre: { ...nursery, ...primary } };

// Put the built-in subjects of a school into academic_subjects. Never changes a subject the school already has
// (same level, curriculum and name), so the Academic Master's own changes are kept. Returns the number added.
async function ensureSchoolSubjects(knex, schoolId, schoolCode) {
  const list = BY_SCHOOL[schoolCode];
  if (!list) return 0;
  let added = 0;
  const put = async (level, curriculum, sub, sn, parentId) => {
    const have = await knex('academic_subjects').where({ school_id: schoolId, level, curriculum })
      .whereRaw('lower(name) = lower(?)', [sub.name]).first('id');
    if (have) return have.id;
    const [row] = await knex('academic_subjects').insert({
      school_id: schoolId, name: sub.name, code: sub.short, short_name: sub.short, stage: level.startsWith('P') && !level.startsWith('PP') ? 'primary' : 'pre',
      level, curriculum, sn, parent_id: parentId || null, syllabus_ref: sub.syllabus || null,
      syllabus_parts: JSON.stringify(sub.parts || []), on_report: !parentId, built_in: true, active: true, created_by: null,
    }).returning('id');
    added++;
    return row.id;
  };
  for (const [level, def] of Object.entries(list)) {
    let sn = 0;
    for (const sub of def.subjects) {
      const id = await put(level, def.curriculum, sub, ++sn, null);
      let child = 0;
      for (const part of sub.children || []) await put(level, def.curriculum, part, sn * 10 + (++child), id);
    }
  }
  return added;
}

module.exports = { BY_SCHOOL, ensureSchoolSubjects };
