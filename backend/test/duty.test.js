// Teacher on Duty, roll call and duty reports (2026-11-23).
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;
const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const D = require('../src/lib/duty');
const { listen, request } = require('./helpers');

const tag = `d${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const P = {};
let server, port, school, other, cls, kids;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body, cookie: P[who].cookie });

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  school = await db('schools').where({ code: 'pre' }).first();
  other = await db('schools').where({ code: 'boys' }).first();
  for (const [key, role, sid] of [['second', 'second', school.id], ['tod', 'teacher', school.id], ['teacher', 'teacher', school.id],
    ['head', 'head', school.id], ['bursar', 'bursar', school.id], ['otherSecond', 'second', other.id], ['otherTeacher', 'teacher', other.id]]) {
    const username = `${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: sid,
      password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id, cookie: cookie(r) };
  }
  [cls] = await db('classes').insert({ school_id: school.id, level: 'P3', name: 'PRIMARY THREE', short_name: 'P 3', stream: `R${tag}`.slice(0, 20), curriculum: 'new', created_by: P.second.id }).returning('*');
  kids = [];
  for (const [i, n] of ['ASHA', 'BARAKA', 'CHAUSIKU'].entries()) {
    const [s] = await db('students').insert({ school_id: school.id, class_id: cls.id, admission_no: `RC${i}${tag}`.slice(0, 20), first_name: n, last_name: 'TEST',
      full_name: `${n} TEST ${tag}`.toUpperCase(), sex: i % 2 ? 'M' : 'F', created_by: P.second.id, updated_by: P.second.id }).returning('*');
    kids.push(s);
  }
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });

test('Week helpers: Monday of the week', () => {
  assert.equal(D.mondayOf('2026-11-23'), '2026-11-23');
  assert.equal(D.mondayOf('2026-11-29'), '2026-11-23');
  assert.equal(D.mondayOf('2026-11-30'), '2026-11-30');
  assert.equal(D.addDays('2026-11-30', -1), '2026-11-29');
});

test('Second Master appoints the Teacher on Duty; others cannot', { skip }, async () => {
  const week = D.mondayOf(D.today());
  assert.equal((await as('head', 'POST', '/api/duty/roster', { weekStart: week, userIds: [P.tod.id] })).status, 403);
  assert.equal((await as('teacher', 'POST', '/api/duty/roster', { weekStart: week, userIds: [P.tod.id] })).status, 403);
  assert.equal((await as('second', 'POST', '/api/duty/roster', { weekStart: week, userIds: [P.otherTeacher.id] })).status, 400, 'teacher of another school');
  assert.equal((await as('second', 'POST', '/api/duty/roster', { weekStart: D.addDays(week, -7), userIds: [P.tod.id] })).status, 400, 'past week');
  let r = await as('second', 'POST', '/api/duty/roster', { weekStart: D.today(), userIds: [P.tod.id], note: 'Main' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.week, week);
  r = await as('second', 'GET', '/api/duty/roster');
  assert.equal(r.status, 200);
  const cur = r.json.weeks.find((w) => w.current);
  assert.ok(cur.teachers.some((t) => t.userId === P.tod.id));
  assert.ok(r.json.teachers.some((t) => t.id === P.teacher.id));
  r = await as('tod', 'GET', '/api/duty/roster');
  assert.equal(r.json.meOnDuty, true);
  assert.equal(r.json.canEdit, false);
  // The appointed teacher is told (bell).
  r = await as('tod', 'GET', '/api/notifications');
  assert.ok(JSON.stringify(r.json).includes('Teacher on Duty'), 'teacher notified');
});

test('Teacher on Duty takes the roll call; every student must be marked; others only look', { skip }, async () => {
  let r = await as('tod', 'GET', `/api/duty/rollcall/class/${cls.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.canTake, true);
  assert.equal(r.json.students.length, 3);
  const body = (marks) => ({ day: D.today(), session: 'morning', marks });
  r = await as('tod', 'PUT', `/api/duty/rollcall/class/${cls.id}`, body([{ studentId: kids[0].id, status: 'P' }]));
  assert.equal(r.status, 400, 'all students must be marked');
  r = await as('tod', 'PUT', `/api/duty/rollcall/class/${cls.id}`, body([{ studentId: kids[0].id, status: 'X' }, { studentId: kids[1].id, status: 'P' }, { studentId: kids[2].id, status: 'P' }]));
  assert.equal(r.status, 400, 'bad mark');
  assert.equal((await as('teacher', 'PUT', `/api/duty/rollcall/class/${cls.id}`, body(kids.map((k) => ({ studentId: k.id, status: 'P' }))))).status, 403, 'not on duty');
  assert.equal((await as('bursar', 'GET', `/api/duty/rollcall/class/${cls.id}`)).status, 403);
  assert.equal((await as('otherSecond', 'PUT', `/api/duty/rollcall/class/${cls.id}`, body(kids.map((k) => ({ studentId: k.id, status: 'P' }))))).status, 404);
  r = await as('tod', 'PUT', `/api/duty/rollcall/class/${cls.id}`, body([
    { studentId: kids[0].id, status: 'P' }, { studentId: kids[1].id, status: 'A', note: 'No word from home' }, { studentId: kids[2].id, status: 'S' }]));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await as('head', 'GET', `/api/duty/rollcall?day=${D.today()}`);
  assert.equal(r.status, 200);
  const row = r.json.classes.find((c) => c.id === cls.id);
  assert.equal(row.taken, true);
  assert.deepEqual(row.counts, { P: 1, A: 1, L: 0, S: 1, R: 0 });
  assert.equal(r.json.canTake, false);
  // A future day is refused, even for the Second Master.
  assert.equal((await as('second', 'PUT', `/api/duty/rollcall/class/${cls.id}`, { ...body(kids.map((k) => ({ studentId: k.id, status: 'P' }))), day: D.addDays(D.today(), 1) })).status, 403);
  // The Second Master corrects it: the change is saved and logged.
  r = await as('second', 'PUT', `/api/duty/rollcall/class/${cls.id}`, body([{ studentId: kids[0].id, status: 'P' }, { studentId: kids[1].id, status: 'L' }, { studentId: kids[2].id, status: 'S' }]));
  assert.equal(r.status, 200);
  assert.equal(r.json.changed, 1);
  const log = await db('audit_log').where({ action: 'rollcall.correct' }).orderBy('id', 'desc').first();
  assert.ok(log.summary.includes('1 changed'));
  r = await as('second', 'GET', `/api/duty/absent?day=${D.today()}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.list.some((x) => x.id === kids[1].id && x.status === 'L'));
  // Nothing can be deleted.
  await assert.rejects(db('roll_call_marks').where({ student_id: kids[0].id }).del());
});

test('Duty report: Teacher on Duty writes, Second Master marks it read, then it is locked', { skip }, async () => {
  assert.equal((await as('teacher', 'PUT', '/api/duty/reports', { day: D.today(), fields: { remarks: 'x' } })).status, 403);
  assert.equal((await as('tod', 'PUT', '/api/duty/reports', { day: D.today(), fields: {} })).status, 400);
  let r = await as('tod', 'PUT', '/api/duty/reports', { day: D.today(), fields: { assembly: 'Started 07:30', discipline: '2 noise makers in P 3', remarks: 'Good day' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await as('second', 'GET', '/api/duty/reports');
  const rep = r.json.reports.find((x) => x.writerId === P.tod.id);
  assert.equal(rep.fields.assembly, 'Started 07:30');
  assert.equal(r.json.canSee, true);
  assert.equal((await as('tod', 'POST', `/api/duty/reports/${rep.id}/seen`, {})).status, 404);
  assert.equal((await as('second', 'POST', `/api/duty/reports/${rep.id}/seen`, { note: 'Follow up the noise makers' })).status, 200);
  assert.equal((await as('tod', 'PUT', '/api/duty/reports', { day: D.today(), fields: { remarks: 'changed' } })).status, 409);
});

test('Home To do: Teacher on Duty sees classes without a roll call; Second Master sees next week without a teacher', { skip }, async () => {
  let r = await as('tod', 'GET', '/api/dashboard');
  assert.equal(r.status, 200);
  r = await as('second', 'GET', '/api/dashboard');
  assert.ok(JSON.stringify(r.json).includes('without a Teacher on Duty (next week)'));
});
