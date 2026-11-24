// Teachers' daily work and the Academic progress view (2026-11-24).
// - A teacher sees ONLY the classes and subjects given to him/her (class_subjects.teacher_id). Whoever holds a post
//   (Academic, Discipline, Second Master) and still teaches uses the same page for his/her own lessons. The Head Master
//   does not teach and has no "My teaching" page.
// - After every lesson the teacher writes what was done (lesson_records) and may mark a syllabus topic as done.
//   Records are never changed or deleted: a wrong one is corrected by a new record.
// - The Academic Master decides a test for one class level (all streams) of the school (school_tests).
// - "Academic progress" (oversight): the Academic Master, Head Master, offices and HR read the school's progress
//   from the start of the term, and each teacher's work (lessons written vs lessons on the timetable, absences,
//   syllabus covered).
// Two terms a year only.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES, pageAccess } = require('../auth/roles');
const { publish } = require('../realtime');
const D = require('../lib/duty');
const subjectsRouter = require('./class-subjects');

const router = express.Router();
router.use(requireAuth);

const KINDS = { taught: 'Taught a topic', quiz: 'Gave a quiz', discussion: 'Discussion', test: 'Test', revision: 'Revision', practical: 'Practical', homework: 'Homework / exercise', absent: 'I was absent' };
const clean = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const int = (v, min, max, name) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} is not valid.`); return n; };
const label = (c) => [c.short_name || c.name, c.stream].filter(Boolean).join(' ');
const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const dayName = (day) => { const w = new Date(`${day}T00:00:00Z`).getUTCDay(); return w === 0 ? 7 : w; }; // 1 Monday ... 7 Sunday
const TERM_COLS = [db.raw('opens_on::text as "opensOn"'), db.raw('closes_on::text as "closesOn"'), db.raw('break_from::text as "breakFrom"'), db.raw('break_to::text as "breakTo"')];

async function schoolOf(req) {
  if (!allSchools(req.user)) return req.user.school_id;
  const id = Number(req.query.school ?? req.body?.schoolId);
  if (!id) throw new HttpError(400, 'Choose a school first (top of the page).');
  if (!(await db('schools').where({ id }).first('id'))) throw new HttpError(404, 'School not found.');
  return id;
}

// The term a day belongs to. From the school calendar (the Head Master writes it); without it, January-June is term 1
// and July-December term 2.
async function termOf(schoolId, day) {
  const year = Number(day.slice(0, 4));
  const rows = await db('school_terms').where({ school_id: schoolId, year }).orderBy('term').select('term', ...TERM_COLS);
  const inside = rows.find((t) => day >= t.opensOn && day <= t.closesOn);
  if (inside) return { year, ...inside, fromCalendar: true };
  const next = rows.find((t) => t.opensOn > day);
  if (next) return { year, ...next, fromCalendar: true, notOpen: true };
  const last = rows[rows.length - 1];
  if (last) return { year, ...last, fromCalendar: true, over: true };
  return { year, term: Number(day.slice(5, 7)) <= 6 ? 1 : 2, fromCalendar: false };
}

// Days of a term when lessons were expected (Monday-Friday, not in the short break, not in a declared holiday).
async function teachingDays(schoolId, t, upTo) {
  if (!t.fromCalendar) return [];
  const holidays = await db('school_holidays').where({ school_id: schoolId, year: t.year }).select(db.raw('from_date::text as f'), db.raw('to_date::text as t'));
  const out = [];
  let d = t.opensOn;
  const end = upTo < t.closesOn ? upTo : t.closesOn;
  for (let n = 0; d <= end && n < 220; n++, d = D.addDays(d, 1)) {
    if (dayName(d) > 5) continue;
    if (t.breakFrom && d >= t.breakFrom && d <= t.breakTo) continue;
    if (holidays.some((h) => d >= h.f && d <= h.t)) continue;
    out.push(d);
  }
  return out;
}

// What this person teaches: class + subject pairs given to him/her.
async function mine(userId, schoolId) {
  return db('class_subjects as cs').join('classes as c', 'c.id', 'cs.class_id').join('academic_subjects as s', 's.id', 'cs.subject_id')
    .where({ 'cs.teacher_id': userId, 'cs.active': true, 'c.school_id': schoolId, 'c.active': true })
    .select('cs.class_id', 'cs.subject_id', 'c.level', 'c.name as class_name', 'c.short_name', 'c.stream', 's.name as subject', 's.syllabus_ref', 's.syllabus_parts')
    .orderBy('c.level').orderBy('c.stream').orderBy('s.sn');
}
const topicsOfPair = async (a) => (await subjectsRouter.topicsFor({ syllabus_ref: a.syllabus_ref, syllabus_parts: a.syllabus_parts }, a.level)).topics;
const pairLabel = (p) => label({ short_name: p.short_name, name: p.class_name, stream: p.stream });

// Records still standing (not replaced by a correction).
const standing = (q, alias = 'r') => q.whereNotExists(db('lesson_records as x').whereRaw(`x.correction_of = ${alias}.id`).select(db.raw('1')));

async function coverageOf(pairs) {
  const out = new Map();
  if (!pairs.length) return out;
  const done = await db('topic_coverage').whereIn('class_id', [...new Set(pairs.map((p) => p.class_id))]).select('class_id', 'subject_id', 'topic_id');
  for (const p of pairs) {
    const topics = await topicsOfPair(p);
    const ids = new Set(topics.map((t) => t.id));
    const d = done.filter((x) => x.class_id === p.class_id && x.subject_id === p.subject_id && ids.has(x.topic_id));
    out.set(`${p.class_id}:${p.subject_id}`, { total: topics.length, done: d.length, doneIds: new Set(d.map((x) => x.topic_id)), topics });
  }
  return out;
}

// ---------- My teaching: the home of a teacher ----------
// GET /api/teaching/me
router.get('/me', requirePage('teaching'), async (req, res) => {
  const schoolId = req.user.school_id;
  if (!schoolId) throw new HttpError(400, 'This page is for teachers of a school.');
  const day = D.today();
  const t = await termOf(schoolId, day);
  const pairs = await mine(req.user.id, schoolId);
  const cov = await coverageOf(pairs);
  const counts = pairs.length ? await db('students').whereIn('class_id', pairs.map((p) => p.class_id)).where({ status: 'active' }).groupBy('class_id').select('class_id').count('* as n') : [];
  const nBy = new Map(counts.map((c) => [c.class_id, Number(c.n)]));
  const last = pairs.length ? await standing(db('lesson_records as r').where({ teacher_id: req.user.id, year: t.year, term: t.term }).groupBy('class_id', 'subject_id').select('class_id', 'subject_id').select(db.raw('max(day)::text as day'))) : [];
  const lastBy = new Map(last.map((l) => [`${l.class_id}:${l.subject_id}`, l.day]));
  const others = pairs.length ? await db('class_subjects as cs').join('academic_subjects as s', 's.id', 'cs.subject_id').leftJoin('users as u', 'u.id', 'cs.teacher_id')
    .whereIn('cs.class_id', pairs.map((p) => p.class_id)).where('cs.active', true).select('cs.class_id', 's.name as subject', 's.sn', 'u.full_name as teacher', 'u.id as teacher_id').orderBy('s.sn') : [];
  const assignments = pairs.map((p) => {
    const c = cov.get(`${p.class_id}:${p.subject_id}`);
    return { classId: p.class_id, subjectId: p.subject_id, className: pairLabel(p), level: p.level, subject: p.subject,
      students: nBy.get(p.class_id) || 0, topics: c.total, topicsDone: c.done, percent: c.total ? Math.round((c.done / c.total) * 100) : null,
      lastLesson: lastBy.get(`${p.class_id}:${p.subject_id}`) || null };
  });
  // Who teaches the other subjects of my classes.
  const classes = [...new Map(pairs.map((p) => [p.class_id, p])).values()].map((p) => ({
    classId: p.class_id, className: pairLabel(p), students: nBy.get(p.class_id) || 0,
    mySubjects: pairs.filter((x) => x.class_id === p.class_id).map((x) => x.subject),
    team: others.filter((o) => o.class_id === p.class_id).map((o) => ({ subject: o.subject, teacher: o.teacher || null, me: o.teacher_id === req.user.id })),
  }));
  // Timetable of today, and lessons of the last 7 days that were not written up.
  const ent = await db('academic_timetable_entries as e').join('classes as c', 'c.id', 'e.class_id').join('academic_subjects as s', 's.id', 'e.subject_id')
    .where({ 'e.school_id': schoolId, 'e.teacher_id': req.user.id, 'e.year': t.year, 'e.term': t.term })
    .select('e.class_id', 'e.subject_id', 'e.day', 'e.period', 'e.room', 'c.short_name', 'c.name as class_name', 'c.stream', 's.name as subject').orderBy('e.period');
  const from = D.addDays(day, -7);
  const written = await standing(db('lesson_records as r').where({ teacher_id: req.user.id }).where('day', '>=', from).where('day', '<=', day))
    .select('class_id', 'subject_id', 'period', db.raw('day::text as day'));
  const isWritten = (e, d) => written.some((w) => w.day === d && w.class_id === e.class_id && w.subject_id === e.subject_id && (w.period == null || w.period === e.period));
  const open = await teachingDays(schoolId, t, day);
  const isOpen = (d) => (t.fromCalendar ? open.includes(d) : dayName(d) <= 5);
  const lessonOf = (e, d) => ({ day: d, period: e.period, room: e.room, classId: e.class_id, subjectId: e.subject_id, className: pairLabel(e), subject: e.subject, written: isWritten(e, d) });
  const todayLessons = isOpen(day) ? ent.filter((e) => e.day === dayName(day)).map((e) => lessonOf(e, day)) : [];
  const missing = [];
  for (let n = 1; n <= 7; n++) { const d = D.addDays(day, -n); if (!isOpen(d)) continue; for (const e of ent.filter((x) => x.day === dayName(d))) if (!isWritten(e, d)) missing.push(lessonOf(e, d)); }
  // My lessons so far this term.
  const recs = await standing(db('lesson_records as r').where({ teacher_id: req.user.id, year: t.year, term: t.term })).select('kind').count('* as n').groupBy('kind');
  const byKind = Object.fromEntries(recs.map((r) => [r.kind, Number(r.n)]));
  const months = await standing(db('lesson_records as r').where({ teacher_id: req.user.id, year: t.year, term: t.term })).select(db.raw("to_char(day,'YYYY-MM') as month")).count('* as n').groupBy('month').orderBy('month');
  const levels = [...new Set(pairs.map((p) => p.level))];
  const tests = levels.length ? await db('school_tests').where({ school_id: schoolId, active: true }).whereIn('level', levels).where('test_day', '>=', D.addDays(day, -7))
    .select('id', 'level', 'title', 'subject_id', 'note', db.raw('test_day::text as day')).orderBy('test_day') : [];
  res.json({ today: day, term: { year: t.year, term: t.term, opensOn: t.opensOn || null, closesOn: t.closesOn || null, fromCalendar: !!t.fromCalendar, notOpen: !!t.notOpen, over: !!t.over },
    teaches: pairs.length > 0, assignments, classes, todayLessons, missing, kinds: KINDS,
    progress: { lessons: Object.values(byKind).reduce((a, b) => a + b, 0), byKind, months: months.map((m) => ({ month: m.month, n: Number(m.n) })),
      topicsDone: assignments.reduce((a, x) => a + x.topicsDone, 0), topics: assignments.reduce((a, x) => a + x.topics, 0) },
    tests: tests.filter((x) => !x.subject_id || pairs.some((p) => p.level === x.level && p.subject_id === x.subject_id)).map((x) => ({ id: x.id, level: x.level, title: x.title, day: x.day, note: x.note })) });
});

// GET /api/teaching/class/:classId/subject/:subjectId — my students of this class and the syllabus with done topics.
router.get('/class/:classId/subject/:subjectId', requirePage('teaching'), async (req, res) => {
  const classId = int(req.params.classId, 1, 2147483647, 'Class'); const subjectId = int(req.params.subjectId, 1, 2147483647, 'Subject');
  const p = (await mine(req.user.id, req.user.school_id)).find((x) => x.class_id === classId && x.subject_id === subjectId);
  if (!p) throw new HttpError(404, 'You do not teach this subject in this class.');
  const c = (await coverageOf([p])).get(`${classId}:${subjectId}`);
  const students = await db('students').where({ class_id: classId, status: 'active' }).orderBy('full_name').select('id', 'admission_no', 'full_name', 'sex');
  const recent = await standing(db('lesson_records as r').leftJoin('syllabus_topics as t', 't.id', 'r.topic_id').where({ 'r.teacher_id': req.user.id, 'r.class_id': classId, 'r.subject_id': subjectId }))
    .select('r.id', 'r.kind', 'r.title', 'r.understanding', 'r.topic_done', 'r.absent_reason', 'r.period', db.raw('r.day::text as day'), 't.text as topic').orderBy('r.day', 'desc').orderBy('r.id', 'desc').limit(40);
  res.json({ className: pairLabel(p), subject: p.subject, students,
    topics: c.topics.map((t) => ({ id: t.id, no: t.no, main: t.main_text, text: t.text, periods: t.periods, done: c.doneIds.has(t.id) })), done: c.done, total: c.total,
    lessons: recent.map((r) => ({ id: r.id, kind: r.kind, kindLabel: KINDS[r.kind], title: r.title, topic: r.topic, done: r.topic_done, understanding: r.understanding, absentReason: r.absent_reason, day: r.day, period: r.period })) });
});

// POST /api/teaching/lessons — write what was done in a lesson.
router.post('/lessons', requirePage('teaching', 'f'), async (req, res) => {
  const schoolId = req.user.school_id; const b = req.body || {};
  if (!schoolId) throw new HttpError(400, 'This page is for teachers of a school.');
  const classId = int(b.classId, 1, 2147483647, 'Class'); const subjectId = int(b.subjectId, 1, 2147483647, 'Subject');
  const pair = (await mine(req.user.id, schoolId)).find((x) => x.class_id === classId && x.subject_id === subjectId);
  if (!pair) throw new HttpError(403, 'You can write only the lessons of the classes and subjects given to you.');
  const kind = String(b.kind || ''); if (!KINDS[kind]) throw new HttpError(400, 'Choose what was done in the lesson.');
  const today = D.today(); const day = b.day ? String(b.day) : today;
  if (!D.isDate(day)) throw new HttpError(400, 'Choose a valid day.');
  if (day > today) throw new HttpError(400, 'A lesson that has not been taught cannot be written.');
  if (day < D.addDays(today, -14)) throw new HttpError(400, 'A lesson older than 14 days cannot be written. Ask the Academic Master.');
  const t = await termOf(schoolId, day);
  const period = b.period == null || b.period === '' ? null : int(b.period, 1, 12, 'Period');
  const title = clean(b.title, 200) || null; const reason = clean(b.absentReason, 200) || null;
  if (kind === 'absent' && !reason) throw new HttpError(400, 'Write why you were absent (sick, permission, meeting ...).');
  let topicId = null;
  if (b.topicId) {
    topicId = int(b.topicId, 1, 2147483647, 'Topic');
    if (!(await topicsOfPair(pair)).some((x) => x.id === topicId)) throw new HttpError(400, 'This topic is not in the syllabus of this subject and class.');
  }
  if (kind === 'taught' && !topicId && !title) throw new HttpError(400, 'Choose the syllabus topic you taught or write what you taught.');
  const done = b.topicDone === true && kind !== 'absent';
  if (done && !topicId) throw new HttpError(400, 'Choose the topic you finished.');
  const understanding = b.understanding == null || b.understanding === '' ? null : int(b.understanding, 0, 100, 'Understanding');
  let testId = null;
  if (b.schoolTestId) {
    testId = int(b.schoolTestId, 1, 2147483647, 'Test');
    const st = await db('school_tests').where({ id: testId, school_id: schoolId, active: true }).first();
    if (!st || st.level !== pair.level) throw new HttpError(400, 'This test is not for this class.');
  }
  const correctionOf = b.correctionOf ? int(b.correctionOf, 1, 2147483647, 'Record') : null;
  if (correctionOf) {
    const old = await db('lesson_records').where({ id: correctionOf, teacher_id: req.user.id }).first('id');
    if (!old) throw new HttpError(404, 'The record to correct was not found.');
  } else if (period) {
    const dup = await standing(db('lesson_records as r').where({ teacher_id: req.user.id, class_id: classId, subject_id: subjectId, day, period })).first('r.id');
    if (dup) throw new HttpError(409, 'This lesson is already written. Open it and correct it.');
  }
  const row = await db.transaction(async (trx) => {
    const [r] = await trx('lesson_records').insert({ school_id: schoolId, teacher_id: req.user.id, class_id: classId, subject_id: subjectId, day, period, term: t.term, year: t.year, kind,
      topic_id: topicId, topic_done: done, title, understanding, absent_reason: kind === 'absent' ? reason : null, school_test_id: testId, correction_of: correctionOf }).returning('*');
    if (done) await trx('topic_coverage').insert({ class_id: classId, subject_id: subjectId, topic_id: topicId, lesson_id: r.id, done_by: req.user.id, done_on: day }).onConflict(['class_id', 'subject_id', 'topic_id']).ignore();
    return r;
  });
  await audit(req, 'lesson.write', `${pair.subject}, ${pairLabel(pair)}: ${KINDS[kind]}${done ? ' (topic done)' : ''}`, { schoolId, detail: { lessonId: row.id, kind, day } });
  publish({ topics: ['teaching'], schoolId });
  res.status(201).json({ id: row.id });
});

// ---------- Tests decided for the whole school (Academic Master) ----------
// GET /api/teaching/tests?school=
router.get('/tests', async (req, res) => {
  if (!pageAccess(req.user.role, 'teaching') && !pageAccess(req.user.role, 'acadprogress')) throw new HttpError(403, 'Your account cannot see the tests.');
  const schoolId = await schoolOf(req);
  const rows = await db('school_tests as t').leftJoin('academic_subjects as s', 's.id', 't.subject_id').leftJoin('users as u', 'u.id', 't.created_by').where('t.school_id', schoolId)
    .select('t.id', 't.level', 't.title', 't.note', 't.term', 't.year', 't.active', 't.subject_id', 's.name as subject', 'u.full_name as by', db.raw('t.test_day::text as day')).orderBy('t.test_day', 'desc').limit(100);
  const classes = await db('classes').where({ school_id: schoolId, active: true }).select('level', 'short_name', 'name', 'stream');
  const logged = rows.length ? await standing(db('lesson_records as r').whereIn('r.school_test_id', rows.map((r) => r.id))).groupBy('r.school_test_id').select('r.school_test_id').count('* as n') : [];
  res.json({ tests: rows.map((r) => ({ id: r.id, level: r.level, title: r.title, note: r.note, term: r.term, year: r.year, active: r.active, subject: r.subject || 'All subjects', subjectId: r.subject_id,
    day: r.day, by: r.by, classes: classes.filter((c) => c.level === r.level).map(label), written: Number(logged.find((l) => l.school_test_id === r.id)?.n || 0) })),
    levels: [...new Set(classes.map((c) => c.level))], canWrite: req.user.role === 'acad' });
});
// POST /api/teaching/tests { level, subjectId?, title, day, note } — Academic Master.
router.post('/tests', requirePage('acadprogress', 'f'), async (req, res) => {
  if (req.user.role !== 'acad') throw new HttpError(403, 'Only the Academic Master / Mistress decides a test for the school.');
  const schoolId = req.user.school_id; const b = req.body || {};
  const level = clean(b.level, 10); const title = clean(b.title, 160);
  if (title.length < 3) throw new HttpError(400, 'Write the name of the test.');
  if (!D.isDate(b.day) || b.day < D.addDays(D.today(), -1)) throw new HttpError(400, 'Choose the day of the test (today or later).');
  const streams = await db('classes').where({ school_id: schoolId, level, active: true }).select('id');
  if (!streams.length) throw new HttpError(400, 'The school has no class of this level.');
  let subjectId = null;
  if (b.subjectId) { subjectId = int(b.subjectId, 1, 2147483647, 'Subject'); if (!(await db('academic_subjects').where({ id: subjectId, level }).first('id'))) throw new HttpError(400, 'This subject is not taught in this class level.'); }
  const t = await termOf(schoolId, b.day);
  const [r] = await db('school_tests').insert({ school_id: schoolId, level, subject_id: subjectId, title, test_day: b.day, term: t.term, year: t.year, note: clean(b.note, 300) || null, created_by: req.user.id }).returning('id');
  const id = r.id ?? r;
  await audit(req, 'test.decide', `${title}: ${level}, ${streams.length} stream${streams.length === 1 ? '' : 's'}, on ${b.day}`, { schoolId, detail: { testId: id } });
  publish({ topics: ['teaching'], schoolId });
  res.status(201).json({ id });
});
router.post('/tests/:id/cancel', requirePage('acadprogress', 'f'), async (req, res) => {
  if (req.user.role !== 'acad') throw new HttpError(403, 'Only the Academic Master / Mistress cancels a test.');
  const n = await db('school_tests').where({ id: int(req.params.id, 1, 2147483647, 'Test'), school_id: req.user.school_id, active: true }).update({ active: false });
  if (!n) throw new HttpError(404, 'Test not found.');
  await audit(req, 'test.cancel', `Test ${req.params.id} cancelled`, { schoolId: req.user.school_id });
  publish({ topics: ['teaching'], schoolId: req.user.school_id });
  res.json({ ok: true });
});

// ---------- Academic progress (oversight) ----------
// GET /api/teaching/oversight?school=&year=&term=
router.get('/oversight', requirePage('acadprogress'), async (req, res) => {
  const schoolId = await schoolOf(req);
  const today = D.today();
  let t = await termOf(schoolId, today);
  if (req.query.year && req.query.term) {
    const y = int(req.query.year, 2000, 2100, 'Year'); const n = int(req.query.term, 1, 2, 'Term');
    const rows = await db('school_terms').where({ school_id: schoolId, year: y, term: n }).select(...TERM_COLS);
    t = { year: y, term: n, ...(rows[0] || {}), fromCalendar: !!rows[0] };
  }
  const upTo = t.closesOn && t.closesOn < today ? t.closesOn : today;
  const days = await teachingDays(schoolId, t, upTo);
  const rowsT = await db('class_subjects as cs').join('classes as c', 'c.id', 'cs.class_id').join('users as u', 'u.id', 'cs.teacher_id').join('academic_subjects as s', 's.id', 'cs.subject_id')
    .where({ 'c.school_id': schoolId, 'cs.active': true, 'c.active': true }).select('u.id as uid', 'u.full_name', 'u.role', 'cs.class_id', 'cs.subject_id', 'c.level', 'c.short_name', 'c.name as class_name', 'c.stream', 's.name as subject', 's.syllabus_ref', 's.syllabus_parts');
  const cov = await coverageOf(rowsT);
  const ent = await db('academic_timetable_entries').where({ school_id: schoolId, year: t.year, term: t.term }).whereNotNull('teacher_id').select('teacher_id', 'day');
  const recs = await standing(db('lesson_records as r').where({ school_id: schoolId, year: t.year, term: t.term })).select('teacher_id', 'class_id', 'subject_id', 'kind', 'created_at', db.raw('day::text as day'), 'absent_reason');
  const duty = await db('duty_rosters').where({ school_id: schoolId, active: true }).whereBetween('week_start', [D.addDays(t.opensOn || `${t.year}-01-01`, -6), t.closesOn || `${t.year}-12-31`]).groupBy('user_id').select('user_id').count('* as n');
  const people = new Map();
  for (const x of rowsT) { if (!people.has(x.uid)) people.set(x.uid, { id: x.uid, name: x.full_name, role: ROLES[x.role]?.label || x.role, pairs: [] }); people.get(x.uid).pairs.push(x); }
  const list = [...people.values()].map((p) => {
    const expected = days.reduce((a, d) => a + ent.filter((e) => e.teacher_id === p.id && e.day === dayName(d)).length, 0);
    const mineRecs = recs.filter((r) => r.teacher_id === p.id);
    const absent = mineRecs.filter((r) => r.kind === 'absent'); const taught = mineRecs.length - absent.length;
    let total = 0; let done = 0;
    for (const x of p.pairs) { const c = cov.get(`${x.class_id}:${x.subject_id}`); total += c.total; done += c.done; }
    const lastAt = mineRecs.reduce((m, r) => (!m || r.created_at > m ? r.created_at : m), null);
    const compliance = expected ? Math.min(100, Math.round((mineRecs.length / expected) * 100)) : null;
    const flags = [];
    if (compliance != null && compliance < 70 && expected >= 5) flags.push('Lessons not written');
    if (absent.length >= 3) flags.push(`Absent ${absent.length} times`);
    if (expected >= 5 && !mineRecs.length) flags.push('No lesson written this term');
    return { id: p.id, name: p.name, role: p.role, classes: p.pairs.length, expected, written: mineRecs.length, taught, absent: absent.length,
      absentReasons: absent.slice(-3).map((a) => `${a.day}: ${a.absent_reason}`), compliance, topics: total, topicsDone: done, coverage: total ? Math.round((done / total) * 100) : null,
      lastWritten: lastAt, dutyWeeks: Number(duty.find((d) => d.user_id === p.id)?.n || 0), flags };
  }).sort((a, b) => (b.flags.length - a.flags.length) || a.name.localeCompare(b.name));
  const classRows = rowsT.map((x) => { const c = cov.get(`${x.class_id}:${x.subject_id}`); const lessons = recs.filter((r) => r.class_id === x.class_id && r.subject_id === x.subject_id);
    return { classId: x.class_id, className: pairLabel(x), level: x.level, subject: x.subject, teacher: x.full_name, topics: c.total, topicsDone: c.done,
      percent: c.total ? Math.round((c.done / c.total) * 100) : null, lessons: lessons.length, last: lessons.reduce((m, r) => (!m || r.day > m ? r.day : m), null) }; })
    .sort((a, b) => a.level.localeCompare(b.level) || a.className.localeCompare(b.className) || a.subject.localeCompare(b.subject));
  const expectedAll = list.reduce((a, x) => a + x.expected, 0); const writtenAll = list.reduce((a, x) => a + x.written, 0);
  const totTopics = list.reduce((a, x) => a + x.topics, 0); const totDone = list.reduce((a, x) => a + x.topicsDone, 0);
  const weeks = {};
  for (const r of recs) { const w = D.mondayOf(r.day); weeks[w] = (weeks[w] || 0) + 1; }
  res.json({ term: { year: t.year, term: t.term, opensOn: t.opensOn || null, closesOn: t.closesOn || null, fromCalendar: !!t.fromCalendar }, today,
    totals: { teachers: list.length, expected: expectedAll, written: writtenAll, compliance: expectedAll ? Math.min(100, Math.round((writtenAll / expectedAll) * 100)) : null,
      coverage: totTopics ? Math.round((totDone / totTopics) * 100) : null, absences: list.reduce((a, x) => a + x.absent, 0), flagged: list.filter((x) => x.flags.length).length },
    teachers: list, classes: classRows, weeks: Object.entries(weeks).sort().map(([week, n]) => ({ week, n })) });
});

// GET /api/teaching/oversight/teacher/:id — one teacher's work: lessons, absences and syllabus per class.
router.get('/oversight/teacher/:id', requirePage('acadprogress'), async (req, res) => {
  const schoolId = await schoolOf(req); const id = int(req.params.id, 1, 2147483647, 'Teacher');
  const u = await db('users').where({ id }).first('id', 'full_name', 'school_id');
  const extra = u && u.school_id !== schoolId ? await db('user_roles').where({ user_id: id, school_id: schoolId, active: true }).first('id') : null;
  if (!u || (u.school_id !== schoolId && !extra)) throw new HttpError(404, 'Teacher not found.');
  const t = await termOf(schoolId, D.today());
  const pairs = await mine(id, schoolId); const cov = await coverageOf(pairs);
  const lessons = await standing(db('lesson_records as r').join('classes as c', 'c.id', 'r.class_id').join('academic_subjects as s', 's.id', 'r.subject_id').leftJoin('syllabus_topics as st', 'st.id', 'r.topic_id').where({ 'r.teacher_id': id, 'r.year': t.year, 'r.term': t.term }))
    .select('r.id', 'r.kind', 'r.title', 'r.understanding', 'r.topic_done', 'r.absent_reason', 'r.period', db.raw('r.day::text as day'), 'c.short_name', 'c.name as class_name', 'c.stream', 's.name as subject', 'st.text as topic').orderBy('r.day', 'desc').orderBy('r.id', 'desc').limit(120);
  res.json({ name: u.full_name, term: { year: t.year, term: t.term },
    assignments: pairs.map((p) => { const c = cov.get(`${p.class_id}:${p.subject_id}`); return { className: pairLabel(p), subject: p.subject, topics: c.total, topicsDone: c.done, percent: c.total ? Math.round((c.done / c.total) * 100) : null }; }),
    lessons: lessons.map((r) => ({ id: r.id, day: r.day, period: r.period, className: label(r), subject: r.subject, kind: r.kind, kindLabel: KINDS[r.kind], title: r.title, topic: r.topic, done: r.topic_done, understanding: r.understanding, absentReason: r.absent_reason })) });
});

module.exports = router;
