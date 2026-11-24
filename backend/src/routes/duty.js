// Teacher on Duty, roll call and the daily duty report (2026-11-23).
// - The Second Master (Deputy Head Master) appoints the Teacher(s) on Duty of each week (page "duty").
// - The Teacher on Duty takes the roll call of every class stream (page "rollcall"): P present, A absent, L late,
//   S sick, R permission. Sessions: morning (all schools), evening and night (boarding). The Second Master can also
//   take or correct it. Everyone else with the page only looks.
// - The Teacher on Duty writes a daily report; the Second Master or the Head Master marks it as seen.
// Nothing is ever deleted: corrections are saved over the marks and written in the Activity log.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES, pageAccess } = require('../auth/roles');
const { publish } = require('../realtime');
const { sendExcel } = require('../lib/excel');
const D = require('../lib/duty');

const router = express.Router();
router.use(requireAuth);
// A Subject Teacher reaches duty pages only in the week he/she is on duty (2026-11-24).
router.use(async (req, res, next) => {
  if (req.user.role === 'teacher' && !(await D.onDuty(db, req.user.id, req.user.school_id, D.today()))) throw new HttpError(403, 'You see this page only in the week you are the Teacher on Duty.');
  next();
});

const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const clean = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const label = (c) => [c.short_name || c.name, c.stream].filter(Boolean).join(' ');
const TEACHING = ['teacher', 'acad', 'head', 'second'];
const REPORT_FIELDS = ['arrival', 'assembly', 'cleanliness', 'meals', 'lessons', 'discipline', 'sick', 'visitors', 'evening', 'remarks'];

async function schoolOf(req, given) {
  if (!allSchools(req.user)) return req.user.school_id;
  const id = Number(given ?? req.query.school);
  if (!id) throw new HttpError(400, 'Choose a school first (top of the page).');
  if (!(await db('schools').where({ id }).first('id'))) throw new HttpError(404, 'School not found.');
  return id;
}
const dayOf = (v) => { const d = v ? String(v) : D.today(); if (!D.isDate(d)) throw new HttpError(400, 'Choose a valid date.'); return d; };
const sessionOf = (v) => { const s = v || 'morning'; if (!D.SESSIONS[s]) throw new HttpError(400, 'Choose morning, evening or night.'); return s; };
const isSecond = (req, schoolId) => req.user.role === 'second' && req.user.school_id === schoolId;

// Teachers of a school (main role or an extra role) who can be put on duty.
async function teachersOf(schoolId) {
  const rows = await db('users').where({ school_id: schoolId, active: true }).whereIn('role', TEACHING)
    .union((q) => q.select('u.id', 'u.full_name', 'r.role').from('user_roles as r').join('users as u', 'u.id', 'r.user_id')
      .where({ 'r.school_id': schoolId, 'r.active': true, 'u.active': true }).whereIn('r.role', TEACHING))
    .select('id', 'full_name', 'role');
  const seen = new Set();
  return rows.filter((u) => !seen.has(u.id) && seen.add(u.id)).sort((a, b) => a.full_name.localeCompare(b.full_name))
    .map((u) => ({ id: u.id, name: u.full_name, role: ROLES[u.role]?.label || u.role }));
}

// Can this person take (or correct) the roll call of this school on this day?
async function canTake(req, schoolId, day) {
  if (pageAccess(req.user.role, 'rollcall') !== 'f') return { ok: false, why: 'Your account can only look at the roll call.' };
  if (day > D.today()) return { ok: false, why: 'A roll call cannot be taken for a day that has not come.' };
  if (isSecond(req, schoolId)) {
    if (day < D.addDays(D.today(), -30)) return { ok: false, why: 'Roll calls older than 30 days cannot be changed.' };
    return { ok: true, as: 'second' };
  }
  if (req.user.school_id !== schoolId || !(await D.onDuty(db, req.user.id, schoolId, day))) {
    return { ok: false, why: 'Only the Teacher on Duty of this week (or the Second Master) takes the roll call.' };
  }
  if (day < D.addDays(D.today(), -1)) return { ok: false, why: 'The Teacher on Duty can change today and yesterday only. Ask the Second Master.' };
  return { ok: true, as: 'duty' };
}

// ---------- Teacher on Duty list ----------
// GET /api/duty/roster?school=&from=YYYY-MM-DD — 4 weeks back to 8 weeks ahead.
router.get('/roster', requirePage('duty'), async (req, res) => {
  const schoolId = await schoolOf(req);
  const thisWeek = D.mondayOf(D.today());
  const from = D.mondayOf(D.isDate(req.query.from) ? req.query.from : D.addDays(thisWeek, -28));
  const to = D.addDays(from, 7 * 12);
  const rows = await db('duty_rosters as r').join('users as u', 'u.id', 'r.user_id').leftJoin('users as a', 'a.id', 'r.appointed_by')
    .where('r.school_id', schoolId).where('r.active', true).whereBetween('r.week_start', [from, to])
    .select('r.id', db.raw("to_char(r.week_start, 'YYYY-MM-DD') as week_start"), 'r.note', 'r.user_id', 'u.full_name', 'u.phone', 'a.full_name as appointed_by', 'r.appointed_at')
    .orderBy('r.week_start').orderBy('u.full_name');
  const weeks = [];
  for (let w = from; w < to; w = D.addDays(w, 7)) {
    weeks.push({ weekStart: w, weekEnd: D.addDays(w, 6), current: w === thisWeek,
      teachers: rows.filter((r) => r.week_start === w)
        .map((r) => ({ id: r.id, userId: r.user_id, name: r.full_name, phone: r.phone, note: r.note, appointedBy: r.appointed_by, appointedAt: r.appointed_at })) });
  }
  const canEdit = isSecond(req, schoolId);
  res.json({ thisWeek, today: D.today(), weeks, canEdit, teachers: canEdit ? await teachersOf(schoolId) : [],
    meOnDuty: req.user.school_id === schoolId && (await D.onDuty(db, req.user.id, schoolId, D.today())) });
});

// POST /api/duty/roster { weekStart, userIds: [], note } — Second Master of the school.
router.post('/roster', requirePage('duty', 'f'), async (req, res) => {
  const schoolId = req.user.school_id;
  if (req.user.role !== 'second' || !schoolId) throw new HttpError(403, 'Only the Second Master appoints the Teacher on Duty.');
  if (!D.isDate(req.body?.weekStart)) throw new HttpError(400, 'Choose the week.');
  const week = D.mondayOf(req.body.weekStart);
  if (week < D.mondayOf(D.today())) throw new HttpError(400, 'A week that has passed cannot be changed.');
  const ids = [...new Set((Array.isArray(req.body.userIds) ? req.body.userIds : []).map(Number).filter(Boolean))];
  if (!ids.length || ids.length > 6) throw new HttpError(400, 'Choose 1 to 6 teachers.');
  const allowed = new Map((await teachersOf(schoolId)).map((t) => [t.id, t]));
  const bad = ids.find((i) => !allowed.has(i));
  if (bad) throw new HttpError(400, 'Choose teachers of your school.');
  const note = clean(req.body.note, 120) || null;
  const added = [];
  await db.transaction(async (trx) => {
    for (const id of ids) {
      const have = await trx('duty_rosters').where({ school_id: schoolId, week_start: week, user_id: id, active: true }).first('id');
      if (have) continue;
      await trx('duty_rosters').insert({ school_id: schoolId, week_start: week, user_id: id, note, appointed_by: req.user.id });
      added.push(id);
    }
  });
  for (const id of added) {
    await audit(req, 'duty.appoint', `${allowed.get(id).name}: Teacher on Duty, week of ${week}`, { schoolId, detail: { userId: id, week } });
  }
  publish({ topics: ['duty'], schoolId });
  res.status(201).json({ added: added.length, week });
});

// POST /api/duty/roster/:id/remove — Second Master, only for this week or later.
router.post('/roster/:id/remove', requirePage('duty', 'f'), async (req, res) => {
  const r = await db('duty_rosters as r').join('users as u', 'u.id', 'r.user_id').where('r.id', Number(req.params.id) || 0).first('r.*', 'u.full_name', db.raw("to_char(r.week_start, 'YYYY-MM-DD') as week"));
  if (!r || !isSecond(req, r.school_id)) throw new HttpError(404, 'Not found.');
  const { week } = r;
  if (!r.active) return res.json({ ok: true });
  if (D.addDays(week, 6) < D.today()) throw new HttpError(400, 'A week that has passed cannot be changed.');
  await db('duty_rosters').where({ id: r.id }).update({ active: false, removed_by: req.user.id, removed_at: db.fn.now() });
  await audit(req, 'duty.remove', `${r.full_name}: no longer Teacher on Duty, week of ${week}`, { schoolId: r.school_id, detail: { userId: r.user_id, week } });
  publish({ topics: ['duty'], schoolId: r.school_id });
  res.json({ ok: true });
});

// ---------- Roll call ----------
// GET /api/duty/rollcall?school=&day=&session= — every class stream with its roll call for that day.
router.get('/rollcall', requirePage('rollcall'), async (req, res) => {
  const schoolId = await schoolOf(req);
  const day = dayOf(req.query.day); const session = sessionOf(req.query.session);
  const classes = await db('classes as c').where({ 'c.school_id': schoolId, 'c.active': true })
    .leftJoin('students as s', (j) => j.on('s.class_id', 'c.id').andOn(db.raw("s.status = 'active'")))
    .groupBy('c.id').select('c.*', db.raw('count(s.id)::int as students'));
  const { levelsFor } = require('../lib/levels');
  const sc = await db('schools').where({ id: schoolId }).first('code');
  const order = levelsFor(sc?.code).map((l) => l.key);
  const rank = (c) => (order.indexOf(c.level) < 0 ? 99 : order.indexOf(c.level));
  classes.sort((a, b) => rank(a) - rank(b) || String(a.stream || '').localeCompare(String(b.stream || '')));
  const calls = await db('roll_calls as r').leftJoin('users as u', 'u.id', 'r.taken_by').where({ 'r.school_id': schoolId, 'r.day': day, 'r.session': session })
    .select('r.id', 'r.class_id', 'r.taken_at', 'r.updated_at', 'u.full_name as taken_by');
  const marks = calls.length ? await db('roll_call_marks').whereIn('roll_call_id', calls.map((c) => c.id)).groupBy('roll_call_id', 'status')
    .select('roll_call_id', 'status', db.raw('count(*)::int as n')) : [];
  const byCall = new Map(calls.map((c) => [c.class_id, { ...c, counts: { P: 0, A: 0, L: 0, S: 0, R: 0 } }]));
  for (const m of marks) { const c = [...byCall.values()].find((x) => x.id === m.roll_call_id); if (c) c.counts[m.status] = m.n; }
  const duty = await db('duty_rosters as r').join('users as u', 'u.id', 'r.user_id').where({ 'r.school_id': schoolId, 'r.week_start': D.mondayOf(day), 'r.active': true }).pluck('u.full_name');
  const take = await canTake(req, schoolId, day);
  res.json({ day, session, sessions: D.SESSIONS, statuses: D.STATUSES, onDuty: duty, canTake: take.ok, why: take.ok ? null : take.why,
    classes: classes.map((c) => { const r = byCall.get(c.id); return { id: c.id, label: label(c), level: c.level, students: c.students,
      taken: !!r, takenBy: r?.taken_by || null, takenAt: r?.updated_at || r?.taken_at || null, counts: r?.counts || null }; }) });
});

// GET /api/duty/rollcall/class/:id?day=&session= — the students of one class stream with their marks.
router.get('/rollcall/class/:id', requirePage('rollcall'), async (req, res) => {
  const c = await db('classes').where({ id: Number(req.params.id) || 0 }).first();
  if (!c || (!allSchools(req.user) && c.school_id !== req.user.school_id)) throw new HttpError(404, 'Class not found.');
  const day = dayOf(req.query.day); const session = sessionOf(req.query.session);
  const call = await db('roll_calls as r').leftJoin('users as u', 'u.id', 'r.taken_by').leftJoin('users as e', 'e.id', 'r.updated_by')
    .where({ 'r.class_id': c.id, 'r.day': day, 'r.session': session }).first('r.*', 'u.full_name as taken_name', 'e.full_name as updated_name');
  const marks = call ? new Map((await db('roll_call_marks').where({ roll_call_id: call.id })).map((m) => [m.student_id, m])) : new Map();
  // Students in the class now, plus anyone marked in this roll call who has since moved (history is kept).
  const ids = [...marks.keys()];
  const students = await db('students').where((w) => { w.where({ class_id: c.id, status: 'active' }); if (ids.length) w.orWhereIn('id', ids); })
    .orderBy('first_name').orderBy('last_name').select('id', 'admission_no', 'full_name', 'sex', 'class_id', 'status');
  // Days absent in a row before this day (for a warning next to the name).
  const prev = await db('roll_call_marks as m').join('roll_calls as r', 'r.id', 'm.roll_call_id')
    .whereIn('m.student_id', students.map((s) => s.id)).where('r.session', 'morning').where('r.day', '<', day).where('r.day', '>=', D.addDays(day, -21))
    .select('m.student_id', 'm.status', 'r.day').orderBy('r.day', 'desc');
  const streak = new Map();
  for (const s of students) {
    let n = 0;
    for (const p of prev.filter((x) => x.student_id === s.id)) { if (p.status === 'A') n++; else break; }
    streak.set(s.id, n);
  }
  const take = await canTake(req, c.school_id, day);
  res.json({ class: { id: c.id, label: label(c), schoolId: c.school_id }, day, session, statuses: D.STATUSES, canTake: take.ok, why: take.ok ? null : take.why,
    rollCall: call ? { id: call.id, takenBy: call.taken_name, takenAt: call.taken_at, updatedBy: call.updated_name, updatedAt: call.updated_at, note: call.note } : null,
    students: students.map((s) => ({ id: s.id, admissionNo: s.admission_no, name: s.full_name, sex: s.sex, moved: s.class_id !== c.id || s.status !== 'active',
      status: marks.get(s.id)?.status || null, note: marks.get(s.id)?.note || '', absentBefore: streak.get(s.id) || 0 })) });
});

// PUT /api/duty/rollcall/class/:id { day, session, marks: [{ studentId, status, note }], note }
router.put('/rollcall/class/:id', requirePage('rollcall', 'f'), async (req, res) => {
  const c = await db('classes').where({ id: Number(req.params.id) || 0 }).first();
  if (!c || (!allSchools(req.user) && c.school_id !== req.user.school_id)) throw new HttpError(404, 'Class not found.');
  const b = req.body || {};
  const day = dayOf(b.day); const session = sessionOf(b.session);
  const take = await canTake(req, c.school_id, day);
  if (!take.ok) throw new HttpError(403, take.why);
  const list = Array.isArray(b.marks) ? b.marks : [];
  const students = await db('students').where({ class_id: c.id, status: 'active' }).pluck('id');
  const call0 = await db('roll_calls').where({ class_id: c.id, day, session }).first();
  const before = call0 ? new Map((await db('roll_call_marks').where({ roll_call_id: call0.id })).map((m) => [m.student_id, m])) : new Map();
  const allowed = new Set([...students, ...before.keys()]);
  const marks = new Map();
  for (const m of list) {
    const id = Number(m.studentId);
    if (!allowed.has(id)) throw new HttpError(400, 'A student in the list is not in this class.');
    if (!D.STATUSES[m.status]) throw new HttpError(400, 'Each mark must be P, A, L, S or R.');
    marks.set(id, { status: m.status, note: clean(m.note, 200) || null });
  }
  const missing = students.filter((id) => !marks.has(id));
  if (missing.length) throw new HttpError(400, `Mark every student: ${missing.length} not marked.`);
  let changed = 0;
  const call = await db.transaction(async (trx) => {
    let r = call0;
    if (!r) [r] = await trx('roll_calls').insert({ school_id: c.school_id, class_id: c.id, day, session, taken_by: req.user.id, note: clean(b.note, 300) || null }).returning('*');
    else await trx('roll_calls').where({ id: r.id }).update({ updated_by: req.user.id, updated_at: trx.fn.now(), note: clean(b.note, 300) || null });
    for (const [sid, m] of marks) {
      const old = before.get(sid);
      if (old && old.status === m.status && (old.note || null) === m.note) continue;
      changed++;
      if (old) await trx('roll_call_marks').where({ id: old.id }).update(m);
      else await trx('roll_call_marks').insert({ roll_call_id: r.id, student_id: sid, ...m });
    }
    return r;
  });
  const n = (s) => [...marks.values()].filter((m) => m.status === s).length;
  const summary = `${label(c)} ${D.SESSIONS[session].toLowerCase()} roll call ${day}: ${n('P')} present, ${n('A')} absent, ${n('L')} late, ${n('S')} sick, ${n('R')} permission`;
  if (!call0) await audit(req, 'rollcall.take', summary, { schoolId: c.school_id, detail: { rollCallId: call.id, classId: c.id } });
  else if (changed) await audit(req, 'rollcall.correct', `${summary} (${changed} changed)`, { schoolId: c.school_id, detail: { rollCallId: call.id, classId: c.id } });
  publish({ topics: ['rollcall'], schoolId: c.school_id });
  res.json({ ok: true, id: call.id, changed: call0 ? changed : marks.size });
});

// GET /api/duty/absent?school=&day= — students absent (or sick / permission) today, and those absent 3 or more days in a row.
router.get('/absent', requirePage('rollcall'), async (req, res) => {
  const schoolId = await schoolOf(req);
  const day = dayOf(req.query.day);
  const rows = await db('roll_call_marks as m').join('roll_calls as r', 'r.id', 'm.roll_call_id').join('students as s', 's.id', 'm.student_id')
    .join('classes as c', 'c.id', 'r.class_id').where({ 'r.school_id': schoolId, 'r.day': day }).whereIn('m.status', ['A', 'S', 'R', 'L'])
    .select('s.id', 's.full_name', 's.admission_no', 'c.short_name', 'c.name', 'c.stream', 'm.status', 'm.note', 'r.session').orderBy('c.level').orderBy('s.full_name');
  // Absent at the morning roll call on each of the last 3 roll-call days of the school (up to this day).
  const days = await db('roll_calls').where({ school_id: schoolId, session: 'morning' }).where('day', '<=', day).groupBy('day').orderBy('day', 'desc').limit(3).select(db.raw("to_char(day, 'YYYY-MM-DD') as d")).then((r) => r.map((x) => x.d));
  let long = [];
  if (days.length === 3) {
    long = await db('roll_call_marks as m').join('roll_calls as r', 'r.id', 'm.roll_call_id').join('students as s', 's.id', 'm.student_id').join('classes as c', 'c.id', 'r.class_id')
      .where({ 'r.school_id': schoolId, 'r.session': 'morning', 'm.status': 'A' }).whereIn('r.day', days)
      .groupBy('s.id', 'c.id').havingRaw('count(*) = 3').select('s.id', 's.full_name', 's.admission_no', 'c.short_name', 'c.name', 'c.stream');
  }
  const out = (x) => ({ id: x.id, name: x.full_name, admissionNo: x.admission_no, className: label(x) });
  res.json({ day, statuses: D.STATUSES, sessions: D.SESSIONS,
    list: rows.map((x) => ({ ...out(x), status: x.status, note: x.note, session: x.session })), threeDays: long.map(out) });
});

// GET /api/duty/rollcall/export.xlsx?school=&day= — the day's roll call, one row per student per session.
router.get('/rollcall/export.xlsx', requirePage('rollcall'), async (req, res) => {
  const schoolId = await schoolOf(req);
  const day = dayOf(req.query.day);
  const rows = await db('roll_call_marks as m').join('roll_calls as r', 'r.id', 'm.roll_call_id').join('students as s', 's.id', 'm.student_id')
    .join('classes as c', 'c.id', 'r.class_id').leftJoin('users as u', 'u.id', 'r.taken_by').where({ 'r.school_id': schoolId, 'r.day': day })
    .select('c.short_name', 'c.name', 'c.stream', 's.admission_no', 's.full_name', 'r.session', 'm.status', 'm.note', 'u.full_name as taken_by').orderBy('c.level').orderBy('c.stream').orderBy('s.full_name');
  await sendExcel(res, `roll-call-${day}`, [{ name: 'Roll call', title: `Roll call ${day}`, columns: [
    { header: 'Class', key: 'cls', width: 14 }, { header: 'Admission No.', key: 'adm', width: 16 }, { header: 'Student', key: 'name', width: 30 },
    { header: 'Session', key: 'session', width: 10 }, { header: 'Mark', key: 'mark', width: 12 }, { header: 'Note', key: 'note', width: 26 }, { header: 'Taken by', key: 'by', width: 22 }],
  rows: rows.map((r) => ({ cls: label(r), adm: r.admission_no, name: r.full_name, session: D.SESSIONS[r.session], mark: D.STATUSES[r.status], note: r.note || '', by: r.taken_by || '' })) }]);
});

// ---------- Daily duty report ----------
// GET /api/duty/reports?school=&from=&to= — reports of the school (default last 14 days).
router.get('/reports', requirePage('duty'), async (req, res) => {
  const schoolId = await schoolOf(req);
  const to = D.isDate(req.query.to) ? req.query.to : D.today();
  const from = D.isDate(req.query.from) ? req.query.from : D.addDays(to, -13);
  const rows = await db('duty_reports as d').join('users as u', 'u.id', 'd.written_by').leftJoin('users as s', 's.id', 'd.seen_by')
    .where('d.school_id', schoolId).whereBetween('d.day', [from, to]).orderBy('d.day', 'desc')
    .select('d.*', db.raw("to_char(d.day, 'YYYY-MM-DD') as day_text"), 'u.full_name as writer', 's.full_name as seen_name');
  const day = D.today();
  res.json({ from, to, today: day, fields: REPORT_FIELDS,
    canWrite: req.user.school_id === schoolId && (isSecond(req, schoolId) || (await D.onDuty(db, req.user.id, schoolId, day))),
    canSee: req.user.school_id === schoolId && ['second', 'head'].includes(req.user.role),
    reports: rows.map((r) => ({ id: r.id, day: r.day_text, writer: r.writer, writerId: r.written_by, fields: r.fields,
      seenBy: r.seen_name, seenAt: r.seen_at, seenNote: r.seen_note, updatedAt: r.updated_at })) });
});

// PUT /api/duty/reports { day, fields } — the Teacher on Duty (today or yesterday), or the Second Master.
router.put('/reports', requirePage('duty'), async (req, res) => {
  const schoolId = req.user.school_id;
  if (!schoolId) throw new HttpError(403, 'Only the Teacher on Duty writes the duty report.');
  const day = dayOf(req.body?.day);
  if (day > D.today() || day < D.addDays(D.today(), -1)) throw new HttpError(400, 'Write the report for today or yesterday.');
  if (!isSecond(req, schoolId) && !(await D.onDuty(db, req.user.id, schoolId, day))) throw new HttpError(403, 'Only the Teacher on Duty of this week writes the duty report.');
  const f = req.body?.fields || {};
  const fields = Object.fromEntries(REPORT_FIELDS.map((k) => [k, clean(f[k], 2000)]).filter(([, v]) => v));
  if (!Object.keys(fields).length) throw new HttpError(400, 'Write at least one part of the report.');
  const have = await db('duty_reports').where({ school_id: schoolId, day, written_by: req.user.id }).first();
  if (have?.seen_at) throw new HttpError(409, 'This report was already read by the Second Master. It cannot be changed.');
  if (have) await db('duty_reports').where({ id: have.id }).update({ fields: JSON.stringify(fields), updated_at: db.fn.now() });
  else await db('duty_reports').insert({ school_id: schoolId, day, written_by: req.user.id, fields: JSON.stringify(fields) });
  await audit(req, have ? 'duty.report_edit' : 'duty.report', `Duty report ${day}`, { schoolId });
  publish({ topics: ['duty'], schoolId });
  res.json({ ok: true });
});

// POST /api/duty/reports/:id/seen { note } — the Second Master or the Head Master has read it.
router.post('/reports/:id/seen', requirePage('duty'), async (req, res) => {
  const r = await db('duty_reports').where({ id: Number(req.params.id) || 0 }).first('*', db.raw("to_char(day, 'YYYY-MM-DD') as day_text"));
  if (!r || r.school_id !== req.user.school_id || !['second', 'head'].includes(req.user.role)) throw new HttpError(404, 'Not found.');
  if (r.seen_at) return res.json({ ok: true });
  await db('duty_reports').where({ id: r.id }).update({ seen_by: req.user.id, seen_at: db.fn.now(), seen_note: clean(req.body?.note, 500) || null });
  const day = r.day_text;
  await audit(req, 'duty.report_seen', `Duty report ${day} read`, { schoolId: r.school_id, detail: { userId: r.written_by } });
  res.json({ ok: true });
});

module.exports = router;
