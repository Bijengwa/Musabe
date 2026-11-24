// School calendar (2026-11-24): the Head Master writes the terms, declares holidays, and makes the program
// (the "June program") for the classes that stay at school during a holiday.
// Terms can be corrected; every change is audited with the old dates.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES } = require('../auth/roles');
const { publish } = require('../realtime');

const router = express.Router();
router.use(requireAuth);

const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(v));
const isTime = (v) => /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v || '');
const WRITERS = ['head', 'sadmin', 'super'];
const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const schoolOf = (u, wanted) => {
  const id = allSchools(u) ? Number(wanted) : u.school_id;
  if (!id) throw new HttpError(400, 'Choose the school.');
  return id;
};
const writer = (req) => { if (!WRITERS.includes(req.user.role)) throw new HttpError(403, 'The Head Master writes the terms and the holiday program.'); };
const D = (c, a) => db.raw(`${c}::text as "${a}"`);

router.get('/', requirePage('calendar'), async (req, res) => {
  const school = schoolOf(req.user, req.query.school);
  const year = Number(req.query.year) || new Date().getFullYear() + (new Date().getMonth() >= 10 ? 1 : 0);
  const terms = await db('school_terms').where({ school_id: school, year }).orderBy('term')
    .select('id', 'term', D('opens_on', 'opensOn'), D('closes_on', 'closesOn'), D('break_from', 'breakFrom'), D('break_to', 'breakTo'), 'study_days as studyDays');
  const holidays = await db('school_holidays as h').leftJoin('holiday_programs as p', 'p.holiday_id', 'h.id').where({ 'h.school_id': school, 'h.year': year }).orderBy('h.from_date')
    .select('h.id', 'h.name', D('h.from_date', 'fromDate'), D('h.to_date', 'toDate'), 'p.id as programId', 'p.status as programStatus', 'p.title as programTitle');
  const classes = await db('holiday_program_classes as pc').join('classes as c', 'c.id', 'pc.class_id').whereIn('pc.program_id', holidays.map((h) => h.programId).filter(Boolean)).select('pc.program_id', 'c.short_name', 'c.stream');
  res.json({ year, terms, canWrite: WRITERS.includes(req.user.role),
    holidays: holidays.map((h) => ({ ...h, classes: classes.filter((c) => c.program_id === h.programId).map((c) => [c.short_name, c.stream].filter(Boolean).join(' ')) })) });
});

// Write or correct one term.
router.post('/terms', requirePage('calendar', 'f'), async (req, res) => {
  writer(req);
  const school = schoolOf(req.user, req.body?.schoolId);
  const b = req.body || {};
  const year = Number(b.year), term = Number(b.term);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new HttpError(400, 'Type the year.');
  if (![1, 2].includes(term)) throw new HttpError(400, 'There are two terms a year: Term 1 or Term 2.');
  if (!isDate(b.opensOn) || !isDate(b.closesOn)) throw new HttpError(400, 'Choose the day the term opens and the day it closes.');
  if (b.closesOn <= b.opensOn) throw new HttpError(400, 'The term must close after it opens.');
  const hasBreak = !!(b.breakFrom || b.breakTo);
  if (hasBreak && (!isDate(b.breakFrom) || !isDate(b.breakTo) || b.breakTo < b.breakFrom || b.breakFrom < b.opensOn || b.breakTo > b.closesOn)) throw new HttpError(400, 'The short break must be inside the term, with the first day before the last.');
  const studyDays = b.studyDays === '' || b.studyDays == null ? null : Number(b.studyDays);
  if (studyDays != null && (!Number.isInteger(studyDays) || studyDays < 1 || studyDays > 300)) throw new HttpError(400, 'Study days must be a whole number.');
  await db.transaction(async (trx) => {
    const old = await trx('school_terms').where({ school_id: school, year, term }).first();
    const row = { school_id: school, year, term, opens_on: b.opensOn, closes_on: b.closesOn, break_from: hasBreak ? b.breakFrom : null, break_to: hasBreak ? b.breakTo : null, study_days: studyDays, set_by: req.user.id, set_at: trx.fn.now() };
    const other = await trx('school_terms').where({ school_id: school, year }).whereNot({ term }).select('term', D('opens_on', 'o'), D('closes_on', 'c'));
    for (const o of other) if (b.opensOn <= o.c && b.closesOn >= o.o) throw new HttpError(409, `This overlaps term ${o.term}.`);
    if (old) await trx('school_terms').where({ id: old.id }).update(row); else await trx('school_terms').insert(row);
    await audit(req, old ? 'term.change' : 'term.set', `Term ${term} ${year}: opens ${b.opensOn}, closes ${b.closesOn}${old ? ` (before: ${old.opens_on.toISOString().slice(0, 10)} to ${old.closes_on.toISOString().slice(0, 10)})` : ''}`, { schoolId: school, detail: { year, term } }, trx);
  });
  publish({ topics: ['calendar'], schoolId: school }, db);
  res.json({ ok: true });
});

// Declare a holiday. The Head Master can then make the program for those who stay.
router.post('/holidays', requirePage('calendar', 'f'), async (req, res) => {
  writer(req);
  const school = schoolOf(req.user, req.body?.schoolId);
  const b = req.body || {};
  const name = clean(b.name, 80);
  if (name.length < 3) throw new HttpError(400, 'Write the name of the holiday, like "June holiday".');
  if (!isDate(b.fromDate) || !isDate(b.toDate) || b.toDate < b.fromDate) throw new HttpError(400, 'Choose the first and the last day of the holiday.');
  let id;
  try {
    [{ id }] = await db('school_holidays').insert({ school_id: school, year: Number(b.fromDate.slice(0, 4)), name, from_date: b.fromDate, to_date: b.toDate, declared_by: req.user.id }).returning('id');
  } catch (e) { if (e.code === '23505') throw new HttpError(409, 'A holiday starting on this day is already declared.'); throw e; }
  await audit(req, 'holiday.declare', `Holiday declared: ${name}, ${b.fromDate} to ${b.toDate}`, { schoolId: school, detail: { holidayId: id } });
  publish({ topics: ['calendar'], schoolId: school }, db);
  res.status(201).json({ id });
});

async function holiday(req) {
  const h = await db('school_holidays').where({ id: Number(req.params.id) || 0 }).first();
  if (!h || (!allSchools(req.user) && h.school_id !== req.user.school_id)) throw new HttpError(404, 'Holiday not found.');
  return h;
}
const ds = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

router.get('/holidays/:id', requirePage('calendar'), async (req, res) => {
  const h = await holiday(req);
  const p = await db('holiday_programs').where({ holiday_id: h.id }).first();
  const classes = p ? await db('holiday_program_classes as pc').join('classes as c', 'c.id', 'pc.class_id').where('pc.program_id', p.id).select('c.id', 'c.short_name', 'c.stream') : [];
  const items = p ? await db('holiday_program_items as i').leftJoin('classes as c', 'c.id', 'i.class_id').leftJoin('users as u', 'u.id', 'i.teacher_id').where('i.program_id', p.id).orderBy('i.day').orderBy('i.start_time')
    .select('i.id', D('i.day', 'day'), 'i.start_time as start', 'i.end_time as end', 'i.activity', 'i.place', 'c.short_name', 'c.stream', 'u.full_name as teacher', 'i.class_id as classId') : [];
  const stay = p ? await db('students as s').join('holiday_program_classes as pc', 'pc.class_id', 's.class_id').where('pc.program_id', p.id).where('s.status', 'active').count({ n: '*' }).first().catch(() => ({ n: null })) : { n: null };
  res.json({ holiday: { id: h.id, name: h.name, fromDate: ds(h.from_date), toDate: ds(h.to_date) },
    program: p ? { id: p.id, title: p.title, note: p.note, status: p.status } : null,
    classes: classes.map((c) => ({ id: c.id, name: [c.short_name, c.stream].filter(Boolean).join(' ') })), students: stay.n == null ? null : Number(stay.n),
    items: items.map((i) => ({ id: i.id, day: i.day, start: i.start, end: i.end, activity: i.activity, place: i.place, className: [i.short_name, i.stream].filter(Boolean).join(' ') || 'All who stay', teacher: i.teacher })),
    canWrite: WRITERS.includes(req.user.role) });
});

// Open the program: which classes stay (by level, like P4, P5, P6, P7).
router.put('/holidays/:id/program', requirePage('calendar', 'f'), async (req, res) => {
  writer(req);
  const h = await holiday(req);
  const levels = (Array.isArray(req.body?.levels) ? req.body.levels : []).map((x) => clean(x, 10).toUpperCase()).filter(Boolean);
  if (!levels.length) throw new HttpError(400, 'Choose the classes that stay at school.');
  const title = clean(req.body?.title, 120) || `${h.name} program`;
  const classes = await db('classes').where({ school_id: h.school_id }).whereIn(db.raw('upper(level)'), levels).select('id');
  if (!classes.length) throw new HttpError(400, 'No class of this school has these levels.');
  await db.transaction(async (trx) => {
    let p = await trx('holiday_programs').where({ holiday_id: h.id }).first();
    if (p && p.status === 'published') throw new HttpError(409, 'The program is already published. Ask for it to be reopened.');
    if (!p) [p] = await trx('holiday_programs').insert({ holiday_id: h.id, school_id: h.school_id, title, note: clean(req.body?.note, 500) || null, created_by: req.user.id }).returning('*');
    else await trx('holiday_programs').where({ id: p.id }).update({ title, note: clean(req.body?.note, 500) || null });
    await trx('holiday_program_classes').where({ program_id: p.id }).del();
    await trx('holiday_program_classes').insert(classes.map((c) => ({ program_id: p.id, class_id: c.id })));
    await audit(req, 'holiday.program', `Program for ${h.name}: ${levels.join(', ')} stay at school`, { schoolId: h.school_id, detail: { holidayId: h.id, levels } }, trx);
  });
  publish({ topics: ['calendar'], schoolId: h.school_id }, db);
  res.json({ ok: true });
});

router.post('/holidays/:id/items', requirePage('calendar', 'f'), async (req, res) => {
  writer(req);
  const h = await holiday(req);
  const p = await db('holiday_programs').where({ holiday_id: h.id }).first();
  if (!p) throw new HttpError(409, 'Choose the classes that stay first.');
  if (p.status === 'published') throw new HttpError(409, 'The program is published.');
  const b = req.body || {};
  const activity = clean(b.activity, 160);
  if (activity.length < 3) throw new HttpError(400, 'Write the activity.');
  if (!isDate(b.day) || b.day < ds(h.from_date) || b.day > ds(h.to_date)) throw new HttpError(400, 'The day must be inside the holiday.');
  if (!isTime(b.start) || !isTime(b.end) || b.end <= b.start) throw new HttpError(400, 'Write the start and end time (like 08:00 and 10:00).');
  let classId = null;
  if (b.classId) { classId = Number(b.classId); if (!(await db('holiday_program_classes').where({ program_id: p.id, class_id: classId }).first())) throw new HttpError(400, 'This class is not in the program.'); }
  let teacherId = null;
  if (b.teacherId) { teacherId = Number(b.teacherId); if (!(await db('users').where({ id: teacherId, school_id: h.school_id, active: true }).first())) throw new HttpError(400, 'This teacher is not in the school.'); }
  const [{ id }] = await db('holiday_program_items').insert({ program_id: p.id, day: b.day, start_time: b.start, end_time: b.end, activity, class_id: classId, teacher_id: teacherId, place: clean(b.place, 80) || null, created_by: req.user.id }).returning('id');
  publish({ topics: ['calendar'], schoolId: h.school_id }, db);
  res.status(201).json({ id });
});

router.post('/holidays/:id/items/:item/remove', requirePage('calendar', 'f'), async (req, res) => {
  writer(req);
  const h = await holiday(req);
  const p = await db('holiday_programs').where({ holiday_id: h.id }).first();
  if (!p || p.status === 'published') throw new HttpError(409, 'The program is published.');
  const n = await db('holiday_program_items').where({ id: Number(req.params.item) || 0, program_id: p.id }).del();
  if (!n) throw new HttpError(404, 'Item not found.');
  res.json({ ok: true });
});

router.post('/holidays/:id/publish', requirePage('calendar', 'f'), async (req, res) => {
  writer(req);
  const h = await holiday(req);
  const p = await db('holiday_programs').where({ holiday_id: h.id }).first();
  if (!p) throw new HttpError(409, 'Choose the classes that stay first.');
  if (p.status === 'published') throw new HttpError(409, 'Already published.');
  if (!(await db('holiday_program_items').where({ program_id: p.id }).first())) throw new HttpError(400, 'Add at least one activity before you publish.');
  await db('holiday_programs').where({ id: p.id }).update({ status: 'published', published_by: req.user.id, published_at: db.fn.now() });
  await audit(req, 'holiday.publish', `Program published: ${p.title}`, { schoolId: h.school_id, detail: { holidayId: h.id } });
  publish({ topics: ['calendar'], schoolId: h.school_id }, db);
  res.json({ ok: true });
});

module.exports = router;
