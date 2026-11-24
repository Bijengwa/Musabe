// Teachers' work: scoping, lesson log, topic done, school tests, oversight, duty page, two terms (2026-11-24).
// Runs only when TEST_DATABASE_URL points to a TEST database that is migrated and seeded. Never point it at real data.
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;

const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const { listen, request } = require('./helpers');
const D = require('../src/lib/duty');

const tag = `t${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const P = {};
let server, port, school, c1, c2, subj, topics, tests;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body, cookie: P[who].cookie });

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  [school] = await db('schools').insert({ code: `tc${tag}`.slice(0, 20), name: `Teach School ${tag}`, short_name: `TS ${tag}`.slice(0, 60), receipt_prefix: `T${tag.slice(-3)}`.toUpperCase().slice(0, 4), }).returning('*');
  [c1] = await db('classes').insert({ school_id: school.id, name: 'PRIMARY FOUR', stream: 'PINK', level: 'P4', short_name: 'P 4', curriculum: 'new' }).returning('*');
  [c2] = await db('classes').insert({ school_id: school.id, name: 'PRIMARY FOUR', stream: 'BLUE', level: 'P4', short_name: 'P 4', curriculum: 'new' }).returning('*');
  for (const [c, n] of [[c1, 'NEEMA'], [c1, 'JUMA'], [c2, 'ASHA']]) {
    await db('students').insert({ school_id: school.id, admission_no: `${n}${tag}`.slice(0, 20), first_name: n, last_name: 'TEST', full_name: `${n} TEST`, sex: 'F', class_id: c.id });
  }
  const make = [['head', 'head', school.id], ['teacher', 'teacher', school.id], ['teacher2', 'teacher', school.id], ['acad', 'acad', school.id], ['disc', 'disc', school.id], ['hr', 'hr', null], ['director', 'director', null]];
  for (const [key, role, sid] of make) {
    const username = `te_${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: sid, password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id ?? u, cookie: cookie(r) };
  }
  const [sy] = await db('syllabi').insert({ ref: `T${tag}`.slice(0, 12), title: 'Test maths', curriculum: 'new' }).returning('id');
  const syId = sy.id ?? sy;
  for (let i = 1; i <= 4; i++) await db('syllabus_topics').insert({ syllabus_id: syId, level: 'P4', sn: i, no: `${i}.1`, main_no: `${i}`, main_text: `Main ${i}`, text: `Topic ${i}`, periods: 3 });
  [subj] = await db('academic_subjects').insert({ school_id: school.id, name: `Maths ${tag}`, stage: 'primary', level: 'P4', curriculum: 'new', syllabus_ref: `T${tag}`.slice(0, 12), sn: 1, created_by: P.acad.id }).returning('*');
  topics = await db('syllabus_topics').where({ syllabus_id: syId }).orderBy('sn');
  // teacher teaches only P4 PINK; teacher2 teaches P4 BLUE
  await db('class_subjects').insert([{ class_id: c1.id, subject_id: subj.id, teacher_id: P.teacher.id, created_by: P.acad.id }, { class_id: c2.id, subject_id: subj.id, teacher_id: P.teacher2.id, created_by: P.acad.id }]);
  // terms of this year so the calendar decides
  const y = Number(D.today().slice(0, 4));
  await db('school_terms').insert([{ school_id: school.id, year: y, term: 1, opens_on: `${y}-01-01`, closes_on: `${y}-06-30`, set_by: P.head.id }, { school_id: school.id, year: y, term: 2, opens_on: `${y}-07-01`, closes_on: `${y}-12-31`, set_by: P.head.id }]);
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });

test('roles: gender-neutral titles, discipline role and HR exist, Head Master has no teaching page', { skip }, async () => {
  const { ROLES, ACCESS } = require('../src/auth/roles');
  assert.match(ROLES.acad.label, /Master \/ Mistress/); assert.ok(ROLES.disc && ROLES.hr);
  assert.equal(ACCESS.head.teaching, undefined); assert.equal(ACCESS.teacher.students, undefined); assert.equal(ACCESS.teacher.classes, undefined);
  assert.ok(ACCESS.acad.teaching && ACCESS.disc.teaching);
});

test('a teacher sees only his/her own class and students', { skip }, async () => {
  const me = (await as('teacher', 'GET', '/api/teaching/me')).json;
  assert.equal(me.assignments.length, 1); assert.equal(me.classes.length, 1); assert.equal(me.classes[0].students, 2);
  assert.equal(me.assignments[0].topics, 4);
  assert.equal((await as('teacher', 'GET', `/api/teaching/class/${c2.id}/subject/${subj.id}`)).status, 404, 'not my class');
  const mine = (await as('teacher', 'GET', `/api/teaching/class/${c1.id}/subject/${subj.id}`)).json;
  assert.equal(mine.students.length, 2);
  assert.equal((await as('teacher', 'GET', '/api/students')).status, 403, 'no Students page');
  assert.equal((await as('head', 'GET', '/api/teaching/me')).status, 403, 'Head Master does not teach');
  const cl = (await as('teacher', 'GET', '/api/academic/class-list')).json;
  assert.deepEqual(cl.classes.map((c) => c.id), [c1.id]);
});

test('lesson log: write, topic done, correction, absence needs a reason, only own subjects', { skip }, async () => {
  const body = { classId: c1.id, subjectId: subj.id, kind: 'taught', topicId: topics[0].id, topicDone: true, title: 'Intro' };
  assert.equal((await as('teacher2', 'POST', '/api/teaching/lessons', body)).status, 403, 'not his class');
  assert.equal((await as('teacher', 'POST', '/api/teaching/lessons', { ...body, topicId: 999999999 })).status, 400);
  assert.equal((await as('teacher', 'POST', '/api/teaching/lessons', { ...body, kind: 'absent' })).status, 400, 'absence needs a reason');
  assert.equal((await as('teacher', 'POST', '/api/teaching/lessons', { ...body, kind: 'dancing' })).status, 400);
  const r = await as('teacher', 'POST', '/api/teaching/lessons', { ...body, period: 2 });
  assert.equal(r.status, 201);
  assert.equal((await as('teacher', 'POST', '/api/teaching/lessons', { ...body, period: 2 })).status, 409, 'same lesson twice');
  const fix = await as('teacher', 'POST', '/api/teaching/lessons', { ...body, period: 2, title: 'Intro (corrected)', topicDone: false, correctionOf: r.json.id });
  assert.equal(fix.status, 201);
  assert.equal((await as('teacher', 'POST', '/api/teaching/lessons', { classId: c1.id, subjectId: subj.id, kind: 'absent', absentReason: 'Sick' })).status, 201);
  assert.equal((await as('teacher', 'POST', '/api/teaching/lessons', { classId: c1.id, subjectId: subj.id, kind: 'quiz', day: D.addDays(D.today(), 1) })).status, 400, 'future day');
  const view = (await as('teacher', 'GET', `/api/teaching/class/${c1.id}/subject/${subj.id}`)).json;
  assert.equal(view.done, 1, 'topic stays done');
  assert.equal(view.lessons.length, 2, 'the replaced record is hidden');
  const me = (await as('teacher', 'GET', '/api/teaching/me')).json;
  assert.equal(me.progress.lessons, 2); assert.equal(me.assignments[0].topicsDone, 1);
  await assert.rejects(db('lesson_records').where({ id: r.json.id }).update({ title: 'x' }), 'records cannot be changed');
});

test('the Academic Master decides a test for a whole level; teachers see it; others cannot', { skip }, async () => {
  const day = D.addDays(D.today(), 3);
  assert.equal((await as('teacher', 'POST', '/api/teaching/tests', { level: 'P4', title: 'Maths test', day })).status, 403);
  assert.equal((await as('head', 'POST', '/api/teaching/tests', { level: 'P4', title: 'Maths test', day })).status, 403, 'head only looks');
  assert.equal((await as('acad', 'POST', '/api/teaching/tests', { level: 'P9', title: 'Maths test', day })).status, 400);
  const t = await as('acad', 'POST', '/api/teaching/tests', { level: 'P4', title: 'Maths test', day });
  assert.equal(t.status, 201); tests = t.json.id;
  const me = (await as('teacher2', 'GET', '/api/teaching/me')).json;
  assert.equal(me.tests.length, 1);
  const list = (await as('head', 'GET', '/api/teaching/tests')).json;
  assert.deepEqual(list.tests[0].classes.sort(), ['P 4 BLUE', 'P 4 PINK']); assert.equal(list.canWrite, false);
  assert.equal((await as('acad', 'POST', `/api/teaching/tests/${tests}/cancel`)).status, 200);
});

test('Academic progress: Head, Academic, Director and HR read it; teachers cannot; terms are 1 and 2 only', { skip }, async () => {
  for (const who of ['head', 'acad', 'director', 'hr']) {
    const url = ['director', 'hr'].includes(who) ? `/api/teaching/oversight?school=${school.id}` : '/api/teaching/oversight';
    const r = await as(who, 'GET', url);
    assert.equal(r.status, 200, who);
    assert.equal(r.json.teachers.length, 2); assert.equal(r.json.term.fromCalendar, true);
  }
  const t = (await as('head', 'GET', '/api/teaching/oversight')).json.teachers.find((x) => x.id === P.teacher.id);
  assert.equal(t.written, 2); assert.equal(t.absent, 1); assert.equal(t.topicsDone, 1);
  assert.equal((await as('teacher', 'GET', '/api/teaching/oversight')).status, 403);
  assert.equal((await as('head', 'GET', `/api/teaching/oversight/teacher/${P.teacher.id}`)).json.lessons.length, 2);
  assert.equal((await as('head', 'POST', '/api/calendar/terms', { year: 2040, term: 3, opensOn: '2040-01-01', closesOn: '2040-02-01' })).status, 400, 'no term 3');
});

test('Teacher on Duty page: a Subject Teacher sees it only in his/her duty week; Discipline always', { skip }, async () => {
  const pages = async (who) => (await as(who, 'GET', '/api/auth/me')).json.pages;
  assert.equal((await pages('teacher')).duty, undefined);
  assert.equal((await as('teacher', 'GET', `/api/duty/roster?school=${school.id}`)).status, 403);
  assert.ok((await pages('disc')).duty); assert.ok((await pages('acad')).duty); assert.ok((await pages('head')).duty);
  await db('duty_rosters').insert({ school_id: school.id, week_start: D.mondayOf(D.today()), user_id: P.teacher.id, appointed_by: P.head.id });
  const p = await pages('teacher');
  assert.ok(p.duty && p.rollcall, 'on duty this week');
  assert.equal((await pages('teacher2')).duty, undefined);
  assert.equal((await pages('head')).teaching, undefined);
});
