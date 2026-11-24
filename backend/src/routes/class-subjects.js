// A class and its subjects (2026-11-23). Opened from Students -> Classes -> click a class.
// - The subjects of a class come from its level and curriculum (academic_subjects, built in from src/lib/subjects.js).
//   P 1 PINK and P 1 BLUE share the subject list of PRIMARY ONE; each stream has its own subject teachers (class_subjects).
// - Each subject shows its built-in syllabus: main competence -> specific competence (topic) -> learning activities,
//   with the number of periods in the year.
// Everyone who sees Classes looks; the Academic Master (classlist: f) changes subjects and assigns teachers.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES, pageAccess } = require('../auth/roles');
const { publish } = require('../realtime');
const { CURRICULA, levelOf } = require('../lib/levels');
const { ensureSchoolSubjects } = require('../lib/subjects');

const router = express.Router();
router.use(requireAuth);

const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const classLabel = (c) => [c.short_name || c.name, c.stream].filter(Boolean).join(' ');
const clean = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const TEACHING_ROLES = ['teacher', 'acad', 'head'];
const OWN = new Set(['ICT', 'KUANDIKA', 'FRENCH', 'CHINESE']); // the school's own subjects (no government syllabus)

// Teachers of a school: main role, or an extra role, of Subject Teacher, Academic Master or Head Master.
async function teachersOf(schoolId) {
  const rows = await db('users').where({ school_id: schoolId, active: true }).whereIn('role', TEACHING_ROLES)
    .union((q) => q.select('u.id', 'u.full_name', 'r.role').from('user_roles as r').join('users as u', 'u.id', 'r.user_id')
      .where({ 'r.school_id': schoolId, 'r.active': true, 'u.active': true }).whereIn('r.role', TEACHING_ROLES))
    .select('id', 'full_name', 'role');
  const seen = new Set();
  return rows.filter((u) => !seen.has(u.id) && seen.add(u.id)).sort((a, b) => a.full_name.localeCompare(b.full_name))
    .map((u) => ({ id: u.id, name: u.full_name, fullName: u.full_name, role: ROLES[u.role]?.label || u.role }));
}

async function classOf(req, id) {
  const c = await db('classes').where({ id: Number(id) || 0 }).first();
  if (!c || (!allSchools(req.user) && c.school_id !== req.user.school_id)) throw new HttpError(404, 'Class not found.');
  return c;
}
async function subjectOf(req, id) {
  const s = await db('academic_subjects').where({ id: Number(id) || 0 }).first();
  if (!s || (!allSchools(req.user) && s.school_id !== req.user.school_id)) throw new HttpError(404, 'Subject not found.');
  return s;
}
// Built-in subjects are put in the first time a school's class is opened (a school added after the migration).
async function ensureSubjects(schoolId) {
  const any = await db('academic_subjects').where({ school_id: schoolId, built_in: true }).first('id');
  if (any) return;
  const sc = await db('schools').where({ id: schoolId }).first('code');
  if (sc) await ensureSchoolSubjects(db, schoolId, sc.code);
}

// Topics of a subject at a level, filtered to its parts of the syllabus ('4' = all of 4.x, '3.3' = only 3.3).
async function topicsFor(subject, level) {
  if (!subject.syllabus_ref) return { syllabus: null, topics: [] };
  const sy = await db('syllabi').where({ ref: subject.syllabus_ref }).first();
  if (!sy) return { syllabus: null, topics: [] };
  const lv = ['BABY', 'PP1', 'PP2'].includes(level) ? 'PP' : level;
  let topics = await db('syllabus_topics').where({ syllabus_id: sy.id, level: lv }).orderBy('sn');
  const parts = Array.isArray(subject.syllabus_parts) ? subject.syllabus_parts : [];
  if (parts.length) {
    topics = topics.filter((t) => parts.some((p) => (p.includes('.') ? t.no === p : (t.main_no || '').split('.')[0] === p)));
  }
  return { syllabus: sy, topics };
}
const syllabusOut = (sy) => sy && { ref: sy.ref, title: sy.title, source: sy.source_file, language: sy.language };

// GET /api/class-subjects/class/:id — the class, its streams, its subjects with teacher and syllabus size.
router.get('/class/:id', requirePage('students'), async (req, res) => {
  const c = await classOf(req, req.params.id);
  await ensureSubjects(c.school_id);
  const lv = levelOf(c.level);
  const curriculum = c.curriculum || lv?.curriculum || null;
  const [counts] = await db('students').where({ class_id: c.id, status: 'active' })
    .select(db.raw('count(*) as n'), db.raw("count(*) filter (where sex='M') as boys"), db.raw("count(*) filter (where sex='F') as girls"));
  const streams = c.level ? await db('classes').where({ school_id: c.school_id, level: c.level }).orderBy('stream') : [c];
  const rows = c.level ? await db('academic_subjects').where({ school_id: c.school_id, level: c.level, curriculum }).orderBy('sn').orderBy('id') : [];
  const teachers = await db('class_subjects as cs').join('users as u', 'u.id', 'cs.teacher_id')
    .where({ 'cs.class_id': c.id, 'cs.active': true }).select('cs.subject_id', 'u.id', 'u.full_name');
  const tBy = new Map(teachers.map((t) => [t.subject_id, { id: t.id, name: t.full_name }]));
  const subjects = [];
  for (const s of rows) {
    const { syllabus, topics } = await topicsFor(s, c.level);
    const items = topics.length ? Number((await db('syllabus_items').whereIn('topic_id', topics.map((t) => t.id)).count('* as n'))[0].n) : 0;
    subjects.push({ id: s.id, name: s.name, shortName: s.short_name || s.code, sn: s.sn, parentId: s.parent_id, active: s.active,
      onReport: s.on_report, builtIn: s.built_in, syllabus: syllabusOut(syllabus), parts: s.syllabus_parts || [],
      // No syllabus: 'own' = the school's own subject; 'missing' = a government subject whose syllabus book is not loaded yet.
      noSyllabus: syllabus ? null : (curriculum === 'old' && !OWN.has(s.short_name) ? 'missing' : 'own'),
      topics: topics.length, activities: items, periods: topics.reduce((a, t) => a + (t.periods || 0), 0) || null,
      teacher: tBy.get(s.id) || null });
  }
  const canEdit = pageAccess(req.user.role, 'classlist') === 'f';
  const staff = canEdit ? await teachersOf(c.school_id) : [];
  res.json({
    class: { id: c.id, schoolId: c.school_id, level: c.level, name: c.name, shortName: c.short_name, stream: c.stream, label: classLabel(c),
      fullName: [c.name, c.stream].filter(Boolean).join(' '), curriculum, curriculumLabel: CURRICULA[curriculum] || null, active: c.active,
      students: Number(counts.n), boys: Number(counts.boys), girls: Number(counts.girls) },
    streams: streams.map((x) => ({ id: x.id, label: classLabel(x), stream: x.stream, active: x.active })),
    subjects, teachers: staff, canEdit,
  });
});

// GET /api/class-subjects/teachers?school=ID — teachers of a school, for the pickers on the Academics pages
// (the Academic Master cannot read the Staff list, so this gives only id, name and role).
router.get('/teachers', requirePage('academics'), async (req, res) => {
  const schoolId = allSchools(req.user) ? Number(req.query.school) : req.user.school_id;
  if (!schoolId) throw new HttpError(400, 'Choose a school first (top of the page).');
  res.json({ teachers: await teachersOf(schoolId) });
});

// GET /api/class-subjects/subject/:id/syllabus?class=ID — the syllabus of one subject for that class level.
router.get('/subject/:id/syllabus', requirePage('students'), async (req, res) => {
  const s = await subjectOf(req, req.params.id);
  const level = req.query.class ? (await classOf(req, req.query.class)).level : s.level;
  const { syllabus, topics } = await topicsFor(s, level);
  const items = topics.length ? await db('syllabus_items').whereIn('topic_id', topics.map((t) => t.id)).orderBy('sn') : [];
  const byTopic = new Map();
  for (const it of items) { if (!byTopic.has(it.topic_id)) byTopic.set(it.topic_id, []); byTopic.get(it.topic_id).push({ id: it.id, sn: it.sn, text: it.text, periods: it.periods }); }
  const parent = s.parent_id ? await db('academic_subjects').where({ id: s.parent_id }).first('name') : null;
  const parts = await db('academic_subjects').where({ parent_id: s.id }).orderBy('sn').select('id', 'name', 'short_name');
  res.json({
    subject: { id: s.id, name: s.name, shortName: s.short_name || s.code, level, parent: parent?.name || null,
      parts: parts.map((p) => ({ id: p.id, name: p.name, shortName: p.short_name })) },
    syllabus: syllabusOut(syllabus),
    topics: topics.map((t) => ({ id: t.id, mainNo: t.main_no, main: t.main_text, no: t.no, text: t.text, periods: t.periods, items: byTopic.get(t.id) || [] })),
  });
});

// PUT /api/class-subjects/class/:id/teacher { subjectId, teacherId | null } — the subject teacher of this stream.
router.put('/class/:id/teacher', requirePage('classlist', 'f'), async (req, res) => {
  const c = await classOf(req, req.params.id);
  const s = await subjectOf(req, req.body?.subjectId);
  if (s.school_id !== c.school_id || s.level !== c.level) throw new HttpError(400, 'This subject is not taught in this class.');
  const teacherId = req.body?.teacherId ? Number(req.body.teacherId) : null;
  let teacher = null;
  if (teacherId) {
    teacher = await db('users').where({ id: teacherId, school_id: c.school_id, active: true }).first('id', 'full_name', 'role');
    const extra = teacher ? null : await db('user_roles as r').join('users as u', 'u.id', 'r.user_id')
      .where({ 'r.user_id': teacherId, 'r.school_id': c.school_id, 'r.active': true, 'u.active': true }).whereIn('r.role', TEACHING_ROLES).first('u.id', 'u.full_name');
    teacher = teacher && TEACHING_ROLES.includes(teacher.role) ? teacher : extra;
    if (!teacher) throw new HttpError(400, 'Choose a teacher of this school.');
  }
  const have = await db('class_subjects').where({ class_id: c.id, subject_id: s.id }).first();
  if (have) await db('class_subjects').where({ id: have.id }).update({ teacher_id: teacher?.id || null, active: true, updated_at: db.fn.now() });
  else await db('class_subjects').insert({ class_id: c.id, subject_id: s.id, teacher_id: teacher?.id || null, active: true, created_by: req.user.id });
  await audit(req, 'class.teacher', `${classLabel(c)} ${s.name}: ${teacher ? teacher.full_name : 'no teacher'}`, { schoolId: c.school_id, detail: { classId: c.id, subjectId: s.id, teacherId: teacher?.id || null } });
  publish({ topics: ['class', 'academic'], schoolId: c.school_id });
  res.json({ ok: true, teacher: teacher ? { id: teacher.id, name: teacher.full_name } : null });
});

// POST /api/class-subjects/class/:id/subjects { name, shortName } — add a subject to the class level (all streams).
router.post('/class/:id/subjects', requirePage('classlist', 'f'), async (req, res) => {
  const c = await classOf(req, req.params.id);
  if (!c.level) throw new HttpError(400, 'Match this class to a fixed class level first.');
  const name = clean(req.body?.name, 80); const short = clean(req.body?.shortName, 20).toUpperCase();
  if (name.length < 2) throw new HttpError(400, 'Write the subject name.');
  const curriculum = c.curriculum || levelOf(c.level)?.curriculum || null;
  const twin = await db('academic_subjects').where({ school_id: c.school_id, level: c.level, curriculum }).whereRaw('lower(name) = lower(?)', [name]).first('id');
  if (twin) throw new HttpError(409, `${name} is already a subject of ${c.short_name}.`);
  const [{ max }] = await db('academic_subjects').where({ school_id: c.school_id, level: c.level, curriculum }).max('sn as max');
  const [row] = await db('academic_subjects').insert({ school_id: c.school_id, name, code: short || null, short_name: short || null,
    stage: ['BABY', 'PP1', 'PP2'].includes(c.level) ? 'pre' : c.level.startsWith('F') ? 'secondary' : 'primary',
    level: c.level, curriculum, sn: (Number(max) || 0) + 1, built_in: false, created_by: req.user.id }).returning('*');
  await audit(req, 'class.subject', `${c.short_name}: subject added: ${name}`, { schoolId: c.school_id, detail: { subjectId: row.id } });
  publish({ topics: ['class', 'academic'], schoolId: c.school_id });
  res.status(201).json({ subject: { id: row.id, name: row.name, shortName: row.short_name } });
});

// PATCH /api/class-subjects/subject/:id { name, shortName, active, onReport } — rename or switch a subject off.
router.patch('/subject/:id', requirePage('classlist', 'f'), async (req, res) => {
  const s = await subjectOf(req, req.params.id);
  const b = req.body || {};
  const ch = {};
  if (b.name !== undefined) { const n = clean(b.name, 80); if (n.length < 2) throw new HttpError(400, 'Write the subject name.'); ch.name = n; }
  if (b.shortName !== undefined) { ch.short_name = clean(b.shortName, 20).toUpperCase() || null; ch.code = ch.short_name; }
  if (b.active !== undefined) ch.active = !!b.active;
  if (b.onReport !== undefined) ch.on_report = !!b.onReport;
  if (!Object.keys(ch).length) return res.json({ ok: true });
  if (ch.name && ch.name.toLowerCase() !== s.name.toLowerCase()) {
    const twin = await db('academic_subjects').where({ school_id: s.school_id, level: s.level, curriculum: s.curriculum }).whereRaw('lower(name) = lower(?)', [ch.name]).whereNot('id', s.id).first('id');
    if (twin) throw new HttpError(409, `${ch.name} is already a subject of this class.`);
  }
  await db('academic_subjects').where({ id: s.id }).update({ ...ch, updated_by: req.user.id, updated_at: db.fn.now() });
  const what = [ch.name && ch.name !== s.name && `renamed to ${ch.name}`, ch.short_name !== undefined && ch.short_name !== s.short_name && `short name ${ch.short_name || 'none'}`,
    ch.active !== undefined && ch.active !== s.active && (ch.active ? 'switched on' : 'switched off'),
    ch.on_report !== undefined && ch.on_report !== s.on_report && (ch.on_report ? 'on the report' : 'not on the report')].filter(Boolean);
  if (what.length) await audit(req, 'class.subject', `${s.level} ${s.name}: ${what.join(', ')}`, { schoolId: s.school_id, detail: { subjectId: s.id } });
  publish({ topics: ['class', 'academic'], schoolId: s.school_id });
  res.json({ ok: true });
});

module.exports = router;
