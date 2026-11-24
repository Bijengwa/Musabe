// Class timetables as a grid (2026-11-24).
// - One grid per class stream: days (Monday-Saturday) down, periods across. An EMPTY table at first: the Academic
//   Master / Mistress writes the times and puts a subject in each box, or imports it from Excel, or lets the system
//   write it from the number of lessons each subject needs per week (she can then change anything).
// - Break, lunch, assembly, revision ... are "activities" (no subject, no teacher).
// - A teacher cannot be in two classes at the same time (compared by clock time when both periods have times,
//   otherwise by period number). Saving stops with the list of clashes, unless she chooses to save anyway.
// The timetable is a plan, not a record, so a new save replaces the old grid of that class and term.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES } = require('../auth/roles');
const { publish } = require('../realtime');
const { checkXlsx } = require('../lib/excel');
const { uploadLimit } = require('../lib/guard');

const router = express.Router();
router.use(requireAuth);

const WRITERS = ['acad', 'head', 'super', 'director'];
const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const KINDS = ['lesson', 'break', 'lunch', 'other'];
const clean = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const int = (v, min, max, name) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} is not valid.`); return n; };
const label = (c) => [c.short_name || c.name, c.stream].filter(Boolean).join(' ');
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hhmm = (v) => (v ? String(v).slice(0, 5) : null);
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));
const mins = (v) => (isTime(v) ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5)) : null);
const ACTIVITY = /^(ASSEMBLY|REVISION|BREAK|LUNCH|DEBATE|SPORT|GAMES|RELIGION|WASHING|DINNER|PREP|BATHING|CLEANING|REST|DEVOTION|STUDY|MAPUMZIko|CHAKULA)/i;
const CORE = /math|english|kiswahili|science|arith|hesabu|mtc|eng\b|kisw/i;

async function schoolOf(req) {
  if (ROLES[req.user.role]?.scope !== 'all') return req.user.school_id;
  const id = Number(req.query.school ?? req.body?.schoolId);
  if (!id) throw new HttpError(400, 'Choose a school first (top of the page).');
  if (!(await db('schools').where({ id }).first('id'))) throw new HttpError(404, 'School not found.');
  return id;
}
const canWrite = (req) => WRITERS.includes(req.user.role);
const needWriter = (req) => { if (!canWrite(req)) throw new HttpError(403, 'The Academic Master / Mistress or the Head Master writes the timetable.'); };

async function classesOf(schoolId) {
  return db('classes').where({ school_id: schoolId, active: true }).orderBy('level').orderBy('stream').orderBy('id');
}
// Subjects of a class stream with the teacher of each.
async function subjectsOf(c) {
  const q = db('academic_subjects').where({ school_id: c.school_id, level: c.level, active: true });
  if (c.curriculum) q.where({ curriculum: c.curriculum });
  const all = await q.orderBy('sn').orderBy('id');
  const parents = new Set(all.map((s) => s.parent_id).filter(Boolean));
  const subs = all.filter((s) => !parents.has(s.id));
  const cs = await db('class_subjects as cs').leftJoin('users as u', 'u.id', 'cs.teacher_id').where({ 'cs.class_id': c.id, 'cs.active': true }).select('cs.subject_id', 'cs.teacher_id', 'u.full_name as teacher');
  return subs.map((s) => { const t = cs.find((x) => x.subject_id === s.id); return { id: s.id, name: s.name, short: s.short_name || s.code || s.name, teacherId: t?.teacher_id || null, teacher: t?.teacher || null }; });
}

// Two periods (of two classes) overlap in time? Without clock times: same period number.
const overlap = (a, b) => {
  const [as, ae, bs, be] = [mins(a.starts), mins(a.ends), mins(b.starts), mins(b.ends)];
  if (as != null && ae != null && bs != null && be != null) return as < be && bs < ae;
  return a.period === b.period;
};

async function schoolState(schoolId, year, term) {
  const periods = await db('timetable_periods').where({ school_id: schoolId, year, term }).select('class_id', 'period', 'kind', db.raw("to_char(starts,'HH24:MI') as starts"), db.raw("to_char(ends,'HH24:MI') as ends"));
  const entries = await db('academic_timetable_entries').where({ school_id: schoolId, year, term }).whereNotNull('teacher_id').select('class_id', 'day', 'period', 'teacher_id');
  return { periods, entries };
}
// Clashes of the grids being saved against the rest of the school (and against each other).
function clashes(state, grids, classes, teachers) {
  const ids = new Set(grids.map((g) => g.classId));
  const rows = [];
  for (const e of state.entries) if (!ids.has(e.class_id)) rows.push({ classId: e.class_id, day: e.day, period: e.period, teacherId: e.teacher_id });
  const per = new Map(); // classId -> period -> {starts, ends}
  for (const p of state.periods) if (!ids.has(p.class_id)) { if (!per.has(p.class_id)) per.set(p.class_id, new Map()); per.get(p.class_id).set(p.period, p); }
  for (const g of grids) {
    per.set(g.classId, new Map(g.periods.map((p) => [p.period, p])));
    for (const c of g.cells) if (c.teacherId) rows.push({ classId: g.classId, day: c.day, period: c.period, teacherId: c.teacherId, mine: true });
  }
  const out = []; const seen = new Set();
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i]; const b = rows[j];
    if (!(a.mine || b.mine) || a.teacherId !== b.teacherId || a.day !== b.day || a.classId === b.classId) continue;
    const pa = per.get(a.classId)?.get(a.period) || { period: a.period }; const pb = per.get(b.classId)?.get(b.period) || { period: b.period };
    if (!overlap({ ...pa, period: a.period }, { ...pb, period: b.period })) continue;
    const key = [a.classId, a.period, b.classId, b.period, a.day].join('-'); if (seen.has(key)) continue; seen.add(key);
    out.push({ teacher: teachers.get(a.teacherId) || `#${a.teacherId}`, teacherId: a.teacherId, day: a.day, dayName: DAYS[a.day],
      a: { classId: a.classId, className: classes.get(a.classId), period: a.period }, b: { classId: b.classId, className: classes.get(b.classId), period: b.period } });
  }
  return out;
}
async function teacherNames(schoolId) {
  const rows = await db('users').where({ school_id: schoolId }).select('id', 'full_name');
  return new Map(rows.map((r) => [r.id, r.full_name]));
}

// Clean up a grid sent by the screen or read from Excel.
function tidy(g, subjectsById, classRow) {
  const periods = (Array.isArray(g.periods) ? g.periods : []).slice(0, 14).map((p, i) => ({ period: i + 1, starts: isTime(p.starts) ? p.starts : null, ends: isTime(p.ends) ? p.ends : null,
    kind: KINDS.includes(p.kind) ? p.kind : 'lesson' }));
  if ((periods.length) && periods.some((p) => (p.starts && p.ends) && mins(p.ends) <= mins(p.starts))) throw new HttpError(400, `${label(classRow)}: a period ends before it starts.`);
  const cells = []; const seen = new Set();
  for (const c of Array.isArray(g.cells) ? g.cells : []) {
    const day = Number(c.day); const period = Number(c.period);
    if (!Number.isInteger(day) || day < 1 || day > 6 || !Number.isInteger(period) || period < 1 || period > periods.length) continue;
    const key = `${day}:${period}`; if (seen.has(key)) continue; seen.add(key);
    const kind = periods[period - 1].kind;
    const sub = c.subjectId ? subjectsById.get(Number(c.subjectId)) : null;
    if (c.subjectId && !sub) throw new HttpError(400, `${label(classRow)}: a subject in the grid does not belong to this class.`);
    if (sub && kind !== 'lesson') throw new HttpError(400, `${label(classRow)}: ${DAYS[day]}, period ${period} is a ${kind}; it cannot hold a subject.`);
    const activity = sub ? null : clean(c.activity, 40) || null;
    if (!sub && !activity) continue;
    cells.push({ day, period, subjectId: sub?.id || null, activity, teacherId: sub ? (Number(c.teacherId) || sub.teacherId || null) : null });
  }
  return { periods, cells };
}

// ---------- GET /api/timetable/grid?school=&class=&year=&term= ----------
router.get('/grid', requirePage('year'), async (req, res) => {
  const schoolId = await schoolOf(req);
  const year = int(req.query.year, 2000, 2100, 'Year'); const term = int(req.query.term, 1, 2, 'Term');
  const classes = await classesOf(schoolId);
  const c = classes.find((x) => x.id === Number(req.query.class)) || classes[0];
  if (!c) return res.json({ classes: [], canWrite: canWrite(req) });
  const [periods, entries, subjects] = await Promise.all([
    db('timetable_periods').where({ class_id: c.id, year, term }).orderBy('period').select('period', 'kind', db.raw("to_char(starts,'HH24:MI') as starts"), db.raw("to_char(ends,'HH24:MI') as ends")),
    db('academic_timetable_entries').where({ class_id: c.id, year, term }).select('day', 'period', 'subject_id', 'activity', 'teacher_id'),
    subjectsOf(c)]);
  const names = await teacherNames(schoolId);
  res.json({ canWrite: canWrite(req), classes: classes.map((x) => ({ id: x.id, label: label(x), level: x.level })), classId: c.id, className: label(c),
    periods, written: entries.length > 0, subjects,
    cells: entries.map((e) => ({ day: e.day, period: e.period, subjectId: e.subject_id, activity: e.activity, teacherId: e.teacher_id, teacher: names.get(e.teacher_id) || null })),
    teachers: [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    state: await schoolState(schoolId, year, term).then((s) => ({ periods: s.periods.filter((p) => p.class_id !== c.id), entries: s.entries.filter((e) => e.class_id !== c.id) })) });
});

// ---------- PUT /api/timetable/grid { schoolId, year, term, force, grids: [{ classId, periods, cells }] } ----------
router.put('/grid', requirePage('year', 'f'), async (req, res) => {
  needWriter(req);
  const schoolId = await schoolOf(req); const b = req.body || {};
  const year = int(b.year, 2000, 2100, 'Year'); const term = int(b.term, 1, 2, 'Term');
  const list = Array.isArray(b.grids) ? b.grids.slice(0, 80) : [];
  if (!list.length) throw new HttpError(400, 'There is nothing to save.');
  const classes = await classesOf(schoolId); const byId = new Map(classes.map((c) => [c.id, c]));
  const names = await teacherNames(schoolId);
  const grids = [];
  for (const g of list) {
    const c = byId.get(Number(g.classId)); if (!c) throw new HttpError(404, 'A class was not found in this school.');
    const subs = new Map((await subjectsOf(c)).map((s) => [s.id, s]));
    const t = tidy(g, subs, c);
    for (const x of t.cells) if (x.teacherId && !names.has(x.teacherId)) throw new HttpError(400, `${label(c)}: a teacher in the grid is not of this school.`);
    grids.push({ classId: c.id, ...t });
  }
  const bad = clashes(await schoolState(schoolId, year, term), grids, new Map(classes.map((c) => [c.id, label(c)])), names);
  if (bad.length && b.force !== true) return res.status(409).json({ error: `${bad.length} teacher clash${bad.length === 1 ? '' : 'es'}: a teacher is in two classes at the same time.`, clashes: bad });
  await db.transaction(async (trx) => {
    for (const g of grids) {
      await trx('academic_timetable_entries').where({ class_id: g.classId, year, term }).del();
      await trx('timetable_periods').where({ class_id: g.classId, year, term }).del();
      if (g.periods.length) await trx('timetable_periods').insert(g.periods.map((p) => ({ school_id: schoolId, class_id: g.classId, year, term, period: p.period, starts: p.starts, ends: p.ends, kind: p.kind })));
      if (g.cells.length) await trx('academic_timetable_entries').insert(g.cells.map((c) => ({ school_id: schoolId, class_id: g.classId, subject_id: c.subjectId, activity: c.activity, teacher_id: c.teacherId, year, term, day: c.day, period: c.period, created_by: req.user.id })));
    }
  });
  await audit(req, 'timetable.save', `Timetable ${year} term ${term}: ${grids.map((g) => label(byId.get(g.classId))).join(', ').slice(0, 150)}${bad.length ? ` (saved with ${bad.length} clashes)` : ''}`, { schoolId, detail: { classes: grids.map((g) => g.classId), clashes: bad.length } });
  publish({ topics: ['academic', 'teaching'], schoolId });
  res.json({ saved: grids.length, clashes: bad });
});

// ---------- POST /api/timetable/generate ----------
// { schoolId, year, term, classIds: [], days: 5|6, keep: bool, perWeek: { classId: { subjectId: n } }, periods: [..] (the screen's periods for a single class) }
// Writes nothing: gives grids to look at and change. Subjects are put by the number of lessons a week each needs,
// a teacher is never put in two classes at once, a subject is spread over the days, and the core subjects go early.
router.post('/generate', requirePage('year', 'f'), async (req, res) => {
  needWriter(req);
  const schoolId = await schoolOf(req); const b = req.body || {};
  const year = int(b.year, 2000, 2100, 'Year'); const term = int(b.term, 1, 2, 'Term');
  const daysIn = b.days === 6 ? 6 : 5;
  const classes = await classesOf(schoolId); const byId = new Map(classes.map((c) => [c.id, c]));
  const ids = [...new Set((Array.isArray(b.classIds) ? b.classIds : []).map(Number))].filter((i) => byId.has(i)).slice(0, 80);
  if (!ids.length) throw new HttpError(400, 'Choose the classes.');
  const names = await teacherNames(schoolId);
  const state = await schoolState(schoolId, year, term);
  const placed = []; // {classId, day, period, teacherId} of the grids made now + the rest of the school
  const per = new Map();
  for (const p of state.periods) if (!ids.includes(p.class_id)) { if (!per.has(p.class_id)) per.set(p.class_id, new Map()); per.get(p.class_id).set(p.period, p); }
  const busy = state.entries.filter((e) => !ids.includes(e.class_id)).map((e) => ({ classId: e.class_id, day: e.day, period: e.period, teacherId: e.teacher_id }));
  const out = [];
  for (const id of ids) {
    const c = byId.get(id);
    const L = b.layout === true ? await layoutOf(schoolId, groupOf(c.level).key) : null;
    const days = L ? L.days : daysIn;
    const fixedKeys = L ? fixedOf(L) : new Map();
    const given = ids.length === 1 && Array.isArray(b.periods) ? b.periods : null;
    const stored = given || await db('timetable_periods').where({ class_id: id, year, term }).orderBy('period').select('period', 'kind', db.raw("to_char(starts,'HH24:MI') as starts"), db.raw("to_char(ends,'HH24:MI') as ends"));
    const periods = (L ? L.periods.map((x, k) => ({ ...x, period: k + 1 })) : stored.length ? stored : Array.from({ length: 8 }, (_, i) => ({ kind: 'lesson', starts: null, ends: null, period: i + 1 }))).slice(0, 14).map((p, i) => ({ period: i + 1, starts: isTime(p.starts) ? p.starts : null, ends: isTime(p.ends) ? p.ends : null, kind: KINDS.includes(p.kind) ? p.kind : 'lesson' }));
    per.set(id, new Map(periods.map((p) => [p.period, p])));
    const subs = await subjectsOf(c);
    const lessonPeriods = periods.filter((p) => p.kind === 'lesson').map((p) => p.period);
    // what is already in the box, and kept
    const existing = b.keep === true ? await db('academic_timetable_entries').where({ class_id: id, year, term }).select('day', 'period', 'subject_id', 'activity', 'teacher_id') : [];
    const cells = []; const taken = new Set(fixedKeys.keys());
    for (const e of existing) if (e.day <= days && e.period <= periods.length && (e.activity || periods[e.period - 1].kind === 'lesson')) { cells.push({ day: e.day, period: e.period, subjectId: e.subject_id, activity: e.activity, teacherId: e.teacher_id }); taken.add(`${e.day}:${e.period}`); }
    const free = []; for (let d = 1; d <= days; d++) for (const p of lessonPeriods) if (!taken.has(`${d}:${p}`)) free.push([d, p]);
    // lessons a week for each subject: given, or shared out by weight (core subjects count double)
    const want = new Map(); const given2 = b.perWeek?.[id] || b.perWeek?.[String(id)] || null;
    if (given2) for (const s of subs) want.set(s.id, Math.max(0, Math.min(40, Math.floor(Number(given2[s.id]) || 0))));
    else {
      const w = subs.map((s) => ({ s, w: CORE.test(`${s.short} ${s.name}`) ? 2 : 1 })); const sum = w.reduce((a, x) => a + x.w, 0) || 1;
      let left = free.length; const rows = w.map((x) => { const q = (free.length * x.w) / sum; return { id: x.s.id, n: Math.floor(q), r: q - Math.floor(q) }; });
      left -= rows.reduce((a, x) => a + x.n, 0); rows.sort((a, b2) => b2.r - a.r); for (let i = 0; i < left && rows.length; i++) rows[i % rows.length].n++;
      for (const r of rows) want.set(r.id, r.n);
    }
    const lessons = [];
    for (const s of subs) for (let i = 0; i < (want.get(s.id) || 0); i++) lessons.push(s);
    lessons.sort((a, b2) => (want.get(b2.id) - want.get(a.id)) || (a.id - b2.id));
    const perDay = new Map(); const clash = (d, p, teacherId) => teacherId && [...busy, ...placed].some((o) => o.teacherId === teacherId && o.day === d && o.classId !== id
      && overlap({ ...(per.get(o.classId)?.get(o.period) || {}), period: o.period }, { ...periods[p - 1], period: p }));
    const unplaced = new Map(); let nPlaced = 0;
    // round-robin by subject so no subject takes all the best boxes
    const bySubject = new Map(); for (const s of lessons) bySubject.set(s.id, [...(bySubject.get(s.id) || []), s]);
    const order = []; for (let round = 0; order.length < lessons.length; round++) { let any = false; for (const list of bySubject.values()) if (list[round]) { order.push(list[round]); any = true; } if (!any) break; }
    for (const s of order) {
      const core = CORE.test(`${s.short} ${s.name}`);
      let best = null; let bestScore = Infinity;
      for (const [d, p] of free) {
        if (taken.has(`${d}:${p}`) || clash(d, p, s.teacherId)) continue;
        const same = perDay.get(`${s.id}:${d}`) || 0; const idx = lessonPeriods.indexOf(p);
        const score = same * 20 + (core ? idx : (lessonPeriods.length - idx)) * 0.7 + ((d * 7 + p * 3 + s.id) % 5) * 0.1;
        if (score < bestScore) { bestScore = score; best = [d, p]; }
      }
      if (!best) { unplaced.set(s.name, (unplaced.get(s.name) || 0) + 1); continue; }
      const [d, p] = best; taken.add(`${d}:${p}`); perDay.set(`${s.id}:${d}`, (perDay.get(`${s.id}:${d}`) || 0) + 1);
      cells.push({ day: d, period: p, subjectId: s.id, activity: null, teacherId: s.teacherId }); placed.push({ classId: id, day: d, period: p, teacherId: s.teacherId }); nPlaced++;
    }
    for (const e of cells) if (e.teacherId && !placed.some((o) => o.classId === id && o.day === e.day && o.period === e.period)) placed.push({ classId: id, day: e.day, period: e.period, teacherId: e.teacherId });
    out.push({ classId: id, className: label(c), periods, cells: cells.map((x) => ({ ...x, teacher: names.get(x.teacherId) || null })), wanted: lessons.length, placed: nPlaced,
      perWeek: Object.fromEntries(subs.map((s) => [s.id, want.get(s.id) || 0])), subjects: subs, unplaced: [...unplaced].map(([subject, n]) => ({ subject, n })),
      noTeacher: subs.filter((s) => !s.teacherId && (want.get(s.id) || 0) > 0).map((s) => s.name) });
  }
  res.json({ grids: out });
});

// GET /api/timetable/mine?year=&term= — the logged-in teacher's own week: days down, times across; only his / her lessons.
router.get('/mine', requirePage('year'), async (req, res) => {
  const year = int(req.query.year, 2000, 2100, 'Year'); const term = int(req.query.term, 1, 2, 'Term');
  const rows = await db('academic_timetable_entries as e').join('classes as c', 'c.id', 'e.class_id').leftJoin('academic_subjects as s', 's.id', 'e.subject_id')
    .where({ 'e.teacher_id': req.user.id, 'e.year': year, 'e.term': term })
    .select('e.class_id', 'e.day', 'e.period', 'e.activity', 's.short_name as sshort', 's.name as sname', 'c.short_name as cshort', 'c.name as cname', 'c.stream');
  const ids = [...new Set(rows.map((r) => r.class_id))];
  const per = ids.length ? await db('timetable_periods').whereIn('class_id', ids).where({ year, term }).select('class_id', 'period', 'kind', ...periodCols()) : [];
  const pOf = new Map(per.map((p) => [`${p.class_id}:${p.period}`, p]));
  const keyOf = (p, n) => (p?.starts && p?.ends ? `${p.starts}-${p.ends}` : `p${n}`);
  const slots = new Map();
  for (const p of per) {
    const k = keyOf(p, p.period);
    if (!slots.has(k)) slots.set(k, { key: k, starts: p.starts, ends: p.ends, kind: p.kind, period: p.period });
  }
  for (const r of rows) { const k = keyOf(pOf.get(`${r.class_id}:${r.period}`), r.period); if (!slots.has(k)) slots.set(k, { key: k, starts: null, ends: null, kind: 'lesson', period: r.period }); }
  let list = [...slots.values()].sort((a, b) => (a.starts && b.starts ? mins(a.starts) - mins(b.starts) : a.starts ? -1 : b.starts ? 1 : a.period - b.period));
  // break / lunch of different class levels that overlap are shown as one column
  const merged = [];
  for (const sl of list) {
    const last = merged[merged.length - 1];
    if (last && sl.kind !== 'lesson' && last.kind === sl.kind && last.starts && sl.starts && mins(sl.starts) < mins(last.ends)) { if (mins(sl.ends) > mins(last.ends)) last.ends = sl.ends; last.keys.push(sl.key); } else merged.push({ ...sl, keys: [sl.key] });
  }
  const slotOfKey = new Map(); merged.forEach((m) => m.keys.forEach((k) => slotOfKey.set(k, m.key)));
  const cells = rows.map((r) => ({ day: r.day, slot: slotOfKey.get(keyOf(pOf.get(`${r.class_id}:${r.period}`), r.period)), subject: r.sshort || r.sname || r.activity || '', className: [r.cshort || r.cname, r.stream].filter(Boolean).join(' ') }));
  res.json({ year, term, lessons: rows.length, slots: merged.map((m) => ({ key: m.key, starts: m.starts, ends: m.ends, kind: m.kind, period: m.period })), cells });
});

// ---------- Level view: one timetable with all streams of a class level (2026-11-24) ----------
// Like the paper timetable: days down (each day has a row for every stream), periods across, with the fixed times and
// fixed parts (break, lunch, PE, religion ...) already in place. The Academic Master / Mistress changes the fixed
// layout and fills the subject boxes. The layout is kept per school and class level (timetable_layouts).
const { groupOf, rankOf, defaultLayout, LEVEL_NAMES } = require('../lib/timetable-defaults');
const MAXP = 14;
const SHORT = ['', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

async function groupsOf(schoolId) {
  const classes = (await classesOf(schoolId)).sort((a, b) => rankOf(a.level) - rankOf(b.level) || String(a.stream || '').localeCompare(String(b.stream || '')) || a.id - b.id);
  const map = new Map();
  for (const c of classes) { const g = groupOf(c.level); if (!map.has(g.key)) map.set(g.key, { ...g, classes: [] }); map.get(g.key).classes.push(c); }
  return [...map.values()];
}
function normLayout(raw) {
  const days = raw?.days === 6 ? 6 : 5;
  const periods = (Array.isArray(raw?.periods) ? raw.periods : []).slice(0, MAXP).map((p) => {
    const kind = KINDS.includes(p?.kind) ? p.kind : 'lesson';
    const starts = isTime(p?.starts) ? p.starts : null; const ends = isTime(p?.ends) ? p.ends : null;
    if (starts && ends && mins(ends) <= mins(starts)) throw new HttpError(400, 'A period ends before it starts.');
    return { starts, ends, kind, label: kind === 'lesson' ? '' : (clean(p?.label, 30).toUpperCase() || kind.toUpperCase()) };
  });
  if (!periods.length) throw new HttpError(400, 'Add at least one period.');
  const items = []; const used = new Set();
  for (const it of Array.isArray(raw?.items) ? raw.items.slice(0, 80) : []) {
    const day = Number(it?.day); const from = Number(it?.from); const to = Number(it?.to); const text = clean(it?.text, 30).toUpperCase();
    if (!text || !Number.isInteger(day) || day < 1 || day > days || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > periods.length) continue;
    let ok = true; for (let p = from; p <= to; p++) if (periods[p - 1].kind !== 'lesson' || used.has(`${day}:${p}`)) ok = false;
    if (!ok) continue;
    for (let p = from; p <= to; p++) used.add(`${day}:${p}`);
    items.push({ day, from, to, text });
  }
  return { days, periods, items };
}
async function layoutOf(schoolId, key) {
  const row = await db('timetable_layouts').where({ school_id: schoolId, group_key: key }).first();
  if (!row) return { ...normLayout(defaultLayout(key)), isDefault: true };
  return { ...normLayout({ days: row.days, periods: row.periods, items: row.items }), isDefault: false };
}
// Boxes that are fixed: 'day:period' -> text (periods that are not lessons, and the fixed items).
function fixedOf(layout) {
  const m = new Map();
  for (let d = 1; d <= layout.days; d++) layout.periods.forEach((p, i) => { if (p.kind !== 'lesson') m.set(`${d}:${i + 1}`, p.label); });
  for (const it of layout.items) for (let p = it.from; p <= it.to; p++) m.set(`${it.day}:${p}`, it.text);
  return m;
}
const periodCols = () => [db.raw("to_char(starts,'HH24:MI') as starts"), db.raw("to_char(ends,'HH24:MI') as ends")];

// GET /api/timetable/level?school=&group=&year=&term=
router.get('/level', requirePage('year'), async (req, res) => {
  const schoolId = await schoolOf(req);
  const year = int(req.query.year, 2000, 2100, 'Year'); const term = int(req.query.term, 1, 2, 'Term');
  const groups = await groupsOf(schoolId);
  if (!groups.length) return res.json({ groups: [], canWrite: canWrite(req) });
  const g = groups.find((x) => x.key === req.query.group) || groups[0];
  const layout = await layoutOf(schoolId, g.key);
  const ids = g.classes.map((c) => c.id);
  const [entries, names, state] = await Promise.all([
    db('academic_timetable_entries').whereIn('class_id', ids).where({ year, term }).select('class_id', 'day', 'period', 'subject_id', 'activity', 'teacher_id'),
    teacherNames(schoolId), schoolState(schoolId, year, term)]);
  const classes = [];
  for (const c of g.classes) classes.push({ id: c.id, label: label(c), level: c.level, levelName: LEVEL_NAMES[c.level] || c.level, stream: c.stream || '', subjects: await subjectsOf(c) });
  res.json({ canWrite: canWrite(req), groups: groups.map((x) => ({ key: x.key, label: x.label })), group: { key: g.key, label: g.label }, layout, classes, written: entries.length > 0,
    cells: entries.map((e) => ({ classId: e.class_id, day: e.day, period: e.period, subjectId: e.subject_id, activity: e.activity, teacherId: e.teacher_id })),
    teachers: [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    state: { periods: state.periods.filter((p) => !ids.includes(p.class_id)), entries: state.entries.filter((e) => !ids.includes(e.class_id)) } });
});

// A level's grids from the layout and the boxes sent.
async function gridsOfLevel(g, layout, rawCells, names) {
  const fixed = fixedOf(layout); const grids = [];
  for (const c of g.classes) {
    const subs = new Map((await subjectsOf(c)).map((s) => [s.id, s]));
    const cells = (Array.isArray(rawCells) ? rawCells : []).filter((x) => Number(x.classId) === c.id && Number(x.day) <= layout.days && !fixed.has(`${x.day}:${x.period}`));
    const t = tidy({ periods: layout.periods, cells }, subs, c);
    for (const x of t.cells) if (x.teacherId && !names.has(x.teacherId)) throw new HttpError(400, `${label(c)}: a teacher in the grid is not of this school.`);
    grids.push({ classId: c.id, ...t });
  }
  return grids;
}
async function writeGrids(trx, schoolId, year, term, grids, userId) {
  for (const g of grids) {
    await trx('academic_timetable_entries').where({ class_id: g.classId, year, term }).del();
    await trx('timetable_periods').where({ class_id: g.classId, year, term }).del();
    if (g.periods.length) await trx('timetable_periods').insert(g.periods.map((p) => ({ school_id: schoolId, class_id: g.classId, year, term, period: p.period, starts: p.starts, ends: p.ends, kind: p.kind })));
    if (g.cells.length) await trx('academic_timetable_entries').insert(g.cells.map((c) => ({ school_id: schoolId, class_id: g.classId, subject_id: c.subjectId, activity: c.activity, teacher_id: c.teacherId, year, term, day: c.day, period: c.period, created_by: userId })));
  }
}

// PUT /api/timetable/level { schoolId, group, year, term, force, layout?, cells: [{ classId, day, period, subjectId, teacherId, activity }] }
router.put('/level', requirePage('year', 'f'), async (req, res) => {
  needWriter(req);
  const schoolId = await schoolOf(req); const b = req.body || {};
  const year = int(b.year, 2000, 2100, 'Year'); const term = int(b.term, 1, 2, 'Term');
  const groups = await groupsOf(schoolId); const g = groups.find((x) => x.key === b.group);
  if (!g) throw new HttpError(404, 'This class level was not found in this school.');
  const layout = b.layout ? normLayout(b.layout) : await layoutOf(schoolId, g.key);
  const names = await teacherNames(schoolId);
  const grids = await gridsOfLevel(g, layout, b.cells, names);
  const classNames = new Map(g.classes.map((c) => [c.id, label(c)]));
  for (const x of groups) for (const c of x.classes) if (!classNames.has(c.id)) classNames.set(c.id, label(c));
  const bad = clashes(await schoolState(schoolId, year, term), grids, classNames, names);
  if (bad.length && b.force !== true) return res.status(409).json({ error: `${bad.length} teacher clash${bad.length === 1 ? '' : 'es'}: a teacher is in two classes at the same time.`, clashes: bad });
  await db.transaction(async (trx) => {
    if (b.layout) {
      const row = { days: layout.days, periods: JSON.stringify(layout.periods), items: JSON.stringify(layout.items), updated_by: req.user.id, updated_at: db.fn.now() };
      await trx('timetable_layouts').insert({ school_id: schoolId, group_key: g.key, ...row }).onConflict(['school_id', 'group_key']).merge(row);
    }
    await writeGrids(trx, schoolId, year, term, grids, req.user.id);
  });
  await audit(req, 'timetable.save', `Timetable ${g.label}, ${year} term ${term}${b.layout ? ' (times / fixed parts changed)' : ''}${bad.length ? ` (saved with ${bad.length} clashes)` : ''}`, { schoolId, detail: { group: g.key, clashes: bad.length } });
  publish({ topics: ['academic', 'teaching'], schoolId });
  res.json({ saved: grids.length, clashes: bad });
});

// ---------- Excel, in the layout of the paper timetable ----------
const ExcelJS = () => require('exceljs');
const FILL = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const BLUE = 'FFBDD7EE'; const SALMON = 'FFF8CBAD'; const GREEN = 'FF16794A';
const streamColor = (s) => { const n = String(s || '').toUpperCase(); return n.includes('YELLOW') ? 'FFFFFF00' : n.includes('PINK') ? 'FFFF8AD8' : n.includes('GREEN') ? 'FF92D050' : n.includes('BLUE') ? 'FF9DC3E6' : n.includes('RED') ? 'FFFF7C80' : 'FFE5E7EB'; };
const colL = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const sheetName = (label2) => label2.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31);

// GET /api/timetable/template.xlsx?school=&year=&term= — every class level as in the paper timetable; written boxes are filled in.
router.get('/template.xlsx', requirePage('year'), async (req, res) => {
  const schoolId = await schoolOf(req);
  const year = int(req.query.year, 2000, 2100, 'Year'); const term = int(req.query.term, 1, 2, 'Term');
  const school = await db('schools').where({ id: schoolId }).first('name');
  const wb = new (ExcelJS().Workbook)();
  const help = wb.addWorksheet('Read me');
  help.addRows([[`${school.name} — class timetables ${year}, Term ${term}`], [''], ['One sheet for each class level; all its streams are in the same table.'],
    ['The times and the fixed parts (BREAK, LUNCH, PE, RELIGION ...) are already there. They are set in the system (Teaching timetable → Times and fixed parts).'],
    ['Fill the empty boxes only: click a box and choose the subject from the drop-down list of that class.'],
    ['The tables "NUMBER OF LESSONS PER SUBJECT" at the bottom count the lessons by themselves.'],
    ['Do not rename the sheets, and do not move the rows with DAY / CLASS / STREAM.']]);
  help.getColumn(1).width = 120; help.getRow(1).font = { bold: true, size: 13 };
  const lists = wb.addWorksheet('Lists'); let listCol = 0;
  for (const g of await groupsOf(schoolId)) {
    const layout = await layoutOf(schoolId, g.key); const N = g.classes.length; const P = layout.periods.length; const days = layout.days;
    const entries = await db('academic_timetable_entries').whereIn('class_id', g.classes.map((c) => c.id)).where({ year, term }).select('class_id', 'day', 'period', 'subject_id', 'activity');
    const subsBy = new Map(); for (const c of g.classes) subsBy.set(c.id, await subjectsOf(c));
    const listRef = new Map();
    for (const c of g.classes) {
      const subs = subsBy.get(c.id); listCol++;
      lists.getCell(1, listCol).value = `${g.label} ${label(c)}`; lists.getCell(1, listCol).font = { bold: true };
      subs.forEach((s, i) => { lists.getCell(i + 2, listCol).value = s.short; });
      if (subs.length) listRef.set(c.id, `Lists!$${colL(listCol)}$2:$${colL(listCol)}$${subs.length + 1}`);
      lists.getColumn(listCol).width = 22;
    }
    const ws = wb.addWorksheet(sheetName(g.label));
    const first = 5; const last = first + days * N - 1; const lastCol = 3 + P; const rowOf = (d, i) => first + (d - 1) * N + i;
    ws.getCell(1, 1).value = String(school.name).toUpperCase(); ws.getCell(2, 1).value = `${g.label.toUpperCase()} TIMETABLE`; ws.getCell(3, 1).value = `${year} — TERM ${term}`;
    for (let r = 1; r <= 3; r++) { ws.mergeCells(r, 1, r, lastCol); ws.getCell(r, 1).font = { bold: true, size: r === 1 ? 14 : 12 }; ws.getCell(r, 1).alignment = { horizontal: 'center' }; }
    const head = ['DAY', 'CLASS', 'STREAM', ...layout.periods.map((p) => (p.starts && p.ends ? `${p.starts}-${p.ends}` : ''))];
    head.forEach((h, i) => { const cell = ws.getCell(4, i + 1); cell.value = h; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = FILL(GREEN); cell.alignment = { horizontal: 'center' }; });
    for (let d = 1; d <= days; d++) {
      ws.getCell(rowOf(d, 0), 1).value = SHORT[d]; if (N > 1) ws.mergeCells(rowOf(d, 0), 1, rowOf(d, N - 1), 1);
      ws.getCell(rowOf(d, 0), 1).font = { bold: true, size: 13 }; ws.getCell(rowOf(d, 0), 1).alignment = { horizontal: 'center', vertical: 'middle' };
      for (let i = 0; i < N;) {
        let j = i; while (j + 1 < N && g.classes[j + 1].level === g.classes[i].level) j++;
        ws.getCell(rowOf(d, i), 2).value = g.classes[i].level; if (j > i) ws.mergeCells(rowOf(d, i), 2, rowOf(d, j), 2);
        ws.getCell(rowOf(d, i), 2).font = { bold: true }; ws.getCell(rowOf(d, i), 2).alignment = { horizontal: 'center', vertical: 'middle' }; i = j + 1;
      }
      g.classes.forEach((c, i) => { const cell = ws.getCell(rowOf(d, i), 3); cell.value = c.stream || ''; cell.fill = FILL(streamColor(c.stream)); cell.font = { bold: true }; });
    }
    for (let p = 1; p <= P; p++) {
      const col = 3 + p; const per = layout.periods[p - 1];
      if (per.kind !== 'lesson') {
        const cell = ws.getCell(first, col); cell.value = per.label; ws.mergeCells(first, col, last, col);
        cell.fill = FILL(per.kind === 'other' ? SALMON : BLUE); cell.font = { bold: true, size: 16 }; cell.alignment = { textRotation: 90, horizontal: 'center', vertical: 'middle', wrapText: true };
        continue;
      }
      for (let d = 1; d <= days; d++) {
        const it = layout.items.find((x) => x.day === d && x.from <= p && p <= x.to);
        if (it) {
          if (p === it.from) { const cell = ws.getCell(rowOf(d, 0), col); cell.value = it.text; ws.mergeCells(rowOf(d, 0), col, rowOf(d, N - 1), 3 + it.to); cell.fill = FILL(SALMON); cell.font = { bold: true, size: 14 }; cell.alignment = { horizontal: 'center', vertical: 'middle' }; }
          continue;
        }
        g.classes.forEach((c, i) => {
          const cell = ws.getCell(rowOf(d, i), col); const e = entries.find((x) => x.class_id === c.id && x.day === d && x.period === p);
          if (e) cell.value = e.activity || subsBy.get(c.id).find((s) => s.id === e.subject_id)?.short || '';
          cell.alignment = { horizontal: 'center' };
          if (listRef.has(c.id)) cell.dataValidation = { type: 'list', allowBlank: true, formulae: [listRef.get(c.id)], showErrorMessage: false };
        });
      }
    }
    ws.getColumn(1).width = 8; ws.getColumn(2).width = 8; ws.getColumn(3).width = 12; for (let p = 1; p <= P; p++) ws.getColumn(3 + p).width = layout.periods[p - 1].kind === 'lesson' ? 16 : 11;
    for (let r = first; r <= last; r++) { ws.getRow(r).height = 20; for (let c = 1; c <= lastCol; c++) ws.getCell(r, c).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }; }
    ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 4 }];
    // number of lessons per subject: one table for each class level, counted by formulas
    let row = last + 3;
    const levels = [...new Set(g.classes.map((c) => c.level))];
    for (const lv of levels) {
      const cls = g.classes.filter((c) => c.level === lv); const subs = subsBy.get(cls[0].id);
      ws.getCell(row, 1).value = `${(LEVEL_NAMES[lv] || lv).toUpperCase()} (${lv}) — NUMBER OF LESSONS PER SUBJECT`; ws.getCell(row, 1).font = { bold: true };
      row++;
      ws.getCell(row, 1).value = 'STREAM'; subs.forEach((s, k) => { ws.getCell(row, 2 + k).value = s.short; });
      for (let k = 0; k <= subs.length; k++) { const cell = ws.getCell(row, 1 + k); cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = FILL(GREEN); cell.alignment = { horizontal: 'center' }; }
      row++; const startRows = row;
      for (const c of cls) {
        const i = g.classes.indexOf(c); ws.getCell(row, 1).value = c.stream || label(c); ws.getCell(row, 1).fill = FILL(streamColor(c.stream));
        subs.forEach((s, k) => {
          const f = Array.from({ length: days }, (_, d) => `COUNTIF($D$${rowOf(d + 1, i)}:$${colL(lastCol)}$${rowOf(d + 1, i)},"${String(s.short).replace(/"/g, '""')}")`).join('+');
          ws.getCell(row, 2 + k).value = { formula: f };
        });
        row++;
      }
      ws.getCell(row, 1).value = 'TOTAL'; ws.getCell(row, 1).font = { bold: true };
      subs.forEach((s, k) => { ws.getCell(row, 2 + k).value = { formula: `SUM(${colL(2 + k)}${startRows}:${colL(2 + k)}${row - 1})` }; ws.getCell(row, 2 + k).font = { bold: true }; });
      row += 3;
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="timetables-${year}-term-${term}.xlsx"`);
  res.send(Buffer.from(buf));
});

// POST /api/timetable/excel?school= (raw .xlsx) — reads the filled file and gives the levels to look at. Writes nothing.
router.post('/excel', requirePage('year', 'f'), uploadLimit, express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
  needWriter(req);
  const schoolId = await schoolOf(req);
  checkXlsx(req.body);
  const wb = new (ExcelJS().Workbook)();
  try { await wb.xlsx.load(req.body); } catch { throw new HttpError(400, 'This Excel file could not be opened. Save it again as .xlsx.'); }
  const groups = await groupsOf(schoolId); const warnings = []; const out = []; const names = await teacherNames(schoolId);
  const txt = (cell) => { const v = cell?.value; if (v == null) return ''; if (typeof v === 'object') return clean(v.richText ? v.richText.map((r) => r.text).join('') : v.result ?? v.text ?? '', 60); return clean(v, 60); };
  const pad = (x) => String(x).padStart(2, '0');
  for (const ws of wb.worksheets) {
    if (['READ ME', 'LISTS'].includes(ws.name.toUpperCase())) continue;
    const g = groups.find((x) => norm(sheetName(x.label)) === norm(ws.name));
    if (!g) { warnings.push(`Sheet "${ws.name}" is not a class level of this school: skipped.`); continue; }
    let hdr = 0; for (let r = 1; r <= 10; r++) if (/^DAY$/i.test(txt(ws.getRow(r).getCell(1)))) { hdr = r; break; }
    if (!hdr) { warnings.push(`${g.label}: the row with DAY / CLASS / STREAM was not found: skipped.`); continue; }
    const layout = await layoutOf(schoolId, g.key);
    let count = layout.periods.length;
    for (let c = 4 + MAXP - 1; c > 3 + count; c--) if (txt(ws.getRow(hdr).getCell(c))) { count = c - 3; break; }
    const periods = Array.from({ length: count }, (_, i) => {
      const base = layout.periods[i] || { kind: 'lesson', label: '', starts: null, ends: null };
      const m = txt(ws.getRow(hdr).getCell(4 + i)).match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
      return { ...base, starts: m ? `${pad(m[1])}:${m[2]}` : base.starts, ends: m ? `${pad(m[3])}:${m[4]}` : base.ends };
    });
    const newLayout = normLayout({ days: layout.days, periods, items: layout.items });
    const fixed = fixedOf(newLayout); const cells = [];
    let day = null;
    for (let r = hdr + 1; r <= ws.rowCount; r++) {
      const a = txt(ws.getRow(r).getCell(1));
      if (a) { const d = SHORT.indexOf(a.slice(0, 3).toUpperCase()); day = d > 0 && d <= newLayout.days ? d : null; }
      if (!day) continue;
      const b = txt(ws.getRow(r).getCell(2)); const s = txt(ws.getRow(r).getCell(3));
      const c = g.classes.find((x) => (norm(x.level) === norm(b) || norm(x.short_name) === norm(b)) && norm(x.stream) === norm(s));
      if (!c) { const w = `${g.label}: the class "${b} ${s}" is not in this school. Classes here: ${g.classes.map((x) => label(x)).join(', ')}. Rows of ${b} ${s} were skipped.`; if (b && !warnings.includes(w)) warnings.push(w); continue; }
      const subs = await subjectsOf(c); const key = new Map(); for (const sub of subs) for (const k of [sub.short, sub.name]) key.set(norm(k), sub);
      for (let p = 1; p <= count; p++) {
        if (fixed.has(`${day}:${p}`)) continue;
        const t = txt(ws.getRow(r).getCell(3 + p)); if (!t) continue;
        const bare = t.replace(/\s*\(.*?\)?\s*$/, '').trim(); const sub = key.get(norm(bare));
        if (sub) cells.push({ classId: c.id, day, period: p, subjectId: sub.id, teacherId: sub.teacherId, teacher: names.get(sub.teacherId) || null });
        else { cells.push({ classId: c.id, day, period: p, subjectId: null, activity: bare.slice(0, 40), teacherId: null }); if (!ACTIVITY.test(bare)) warnings.push(`${g.label}, ${label(c)}, ${DAYS[day]}, period ${p}: "${bare}" is not a subject of this class: kept as a note (no teacher).`); }
      }
    }
    out.push({ group: g.key, label: g.label, layout: newLayout, cells, changedTimes: JSON.stringify(layout.periods.map((p) => [p.starts, p.ends])) !== JSON.stringify(newLayout.periods.map((p) => [p.starts, p.ends])) });
  }
  if (!out.length) throw new HttpError(400, 'No class level sheet was found in this file. Download the Excel file from this page and fill it.');
  res.json({ levels: out, warnings: warnings.slice(0, 60), moreWarnings: Math.max(0, warnings.length - 60) });
});

router.schoolOf = schoolOf; router.classesOf = classesOf; router.subjectsOf = subjectsOf; // used by the exam timetable
module.exports = router;
