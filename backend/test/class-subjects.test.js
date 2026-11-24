// Class page: subjects of each class level, built-in syllabus, subject teacher per stream (2026-11-23).
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;
const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const { listen, request } = require('./helpers');

const tag = `c${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const P = {};
let server, port, school, other;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body, cookie: P[who].cookie });

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  school = await db('schools').where({ code: 'pre' }).first();
  other = await db('schools').where({ code: 'boys' }).first();
  for (const [key, role, sid] of [['acad', 'acad', school.id], ['teacher', 'teacher', school.id], ['bursar', 'bursar', school.id], ['otherTeacher', 'teacher', other.id]]) {
    const username = `${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: sid,
      password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id, cookie: cookie(r) };
  }
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });

const makeClass = async (level, stream, curriculum) => (await db('classes').insert({ school_id: school.id, level, name: level, short_name: level,
  stream: `${stream}${tag}`.slice(0, 20), curriculum, created_by: P.acad.id }).returning('*'))[0];

test('Class page lists the subjects of the level, with the built-in syllabus', { skip }, async () => {
  const p3 = await makeClass('P3', 'PINK', 'new');
  let r = await as('bursar', 'GET', `/api/class-subjects/class/${p3.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.canEdit, false);
  assert.equal(r.json.class.curriculumLabel, '2027 curriculum');
  const names = r.json.subjects.map((s) => s.shortName);
  assert.deepEqual(names.slice(0, 4), ['MATHS', 'SCIE', 'KISW', 'ENG']);
  const maths = r.json.subjects.find((s) => s.shortName === 'MATHS');
  assert.equal(maths.syllabus.ref, 'MATH');
  assert.equal(maths.periods, 234); // 6 periods a week
  r = await as('bursar', 'GET', `/api/class-subjects/subject/${maths.id}/syllabus?class=${p3.id}`);
  assert.equal(r.status, 200);
  assert.ok(r.json.topics.length >= 5);
  assert.ok(r.json.topics[0].items.length >= 1);
  assert.equal(r.json.topics[0].mainNo, '1.0');
  const ict = r.json && (await as('bursar', 'GET', `/api/class-subjects/class/${p3.id}`)).json.subjects.find((s) => s.shortName === 'ICT');
  assert.equal(ict.syllabus, null); // school's own subject
});

test('Subject names change by class; P1 Arithmetic follows only its part of the Std I-II syllabus', { skip }, async () => {
  const p1 = await makeClass('P1', 'BLUE', 'new');
  const r = await as('acad', 'GET', `/api/class-subjects/class/${p1.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.canEdit, true);
  const arth = r.json.subjects.find((s) => s.shortName === 'ARTH');
  assert.equal(arth.name, 'Arithmetic');
  const sy = await as('acad', 'GET', `/api/class-subjects/subject/${arth.id}/syllabus?class=${p1.id}`);
  assert.ok(sy.json.topics.length > 0);
  assert.ok(sy.json.topics.every((t) => t.mainNo === '4.0'), 'only main competence 4.0 Arithmetic');
});

test('P7 (2026 and before curriculum) has Social Studies made of Geography and History', { skip }, async () => {
  const p7 = await makeClass('P7', 'GREEN', 'old');
  const r = await as('acad', 'GET', `/api/class-subjects/class/${p7.id}`);
  assert.equal(r.json.class.curriculumLabel, '2026 and before curriculum');
  const sst = r.json.subjects.find((s) => s.shortName === 'SST');
  const parts = r.json.subjects.filter((s) => s.parentId === sst.id).map((s) => s.name);
  assert.deepEqual(parts, ['Geography', 'History']);
  assert.ok(r.json.subjects.filter((s) => s.parentId === sst.id).every((s) => s.onReport === false));
});

test('Academic Master assigns a subject teacher per stream; others cannot', { skip }, async () => {
  const a = await makeClass('P4', 'PINK', 'new');
  const b = await makeClass('P4', 'BLUE', 'new');
  const list = (await as('acad', 'GET', `/api/class-subjects/class/${a.id}`)).json;
  assert.ok(list.teachers.some((t) => t.id === P.teacher.id));
  assert.ok(!list.teachers.some((t) => t.id === P.otherTeacher.id), 'no teachers from another school');
  const sci = list.subjects.find((s) => s.shortName === 'SCIE');
  assert.equal((await as('teacher', 'PUT', `/api/class-subjects/class/${a.id}/teacher`, { subjectId: sci.id, teacherId: P.teacher.id })).status, 403);
  assert.equal((await as('acad', 'PUT', `/api/class-subjects/class/${a.id}/teacher`, { subjectId: sci.id, teacherId: P.otherTeacher.id })).status, 400);
  let r = await as('acad', 'PUT', `/api/class-subjects/class/${a.id}/teacher`, { subjectId: sci.id, teacherId: P.teacher.id });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await as('acad', 'GET', `/api/class-subjects/class/${a.id}`);
  assert.equal(r.json.subjects.find((s) => s.id === sci.id).teacher.id, P.teacher.id);
  r = await as('acad', 'GET', `/api/class-subjects/class/${b.id}`);
  assert.equal(r.json.subjects.find((s) => s.id === sci.id).teacher, null, 'other stream keeps its own teacher');
  assert.ok(r.json.streams.length >= 2);
  // A subject of another level is refused.
  const p3sub = await db('academic_subjects').where({ school_id: school.id, level: 'P3', short_name: 'MATHS' }).first();
  assert.equal((await as('acad', 'PUT', `/api/class-subjects/class/${a.id}/teacher`, { subjectId: p3sub.id, teacherId: P.teacher.id })).status, 400);
});

test('Academic Master adds, renames and switches off a subject of a level', { skip }, async () => {
  const c = await makeClass('P5', 'YELLOW', 'new');
  let r = await as('acad', 'POST', `/api/class-subjects/class/${c.id}/subjects`, { name: `Bible Knowledge ${tag}`, shortName: 'bk' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.subject.id;
  assert.equal((await as('acad', 'POST', `/api/class-subjects/class/${c.id}/subjects`, { name: `bible knowledge ${tag}` })).status, 409);
  assert.equal((await as('bursar', 'PATCH', `/api/class-subjects/subject/${id}`, { active: false })).status, 403);
  r = await as('acad', 'PATCH', `/api/class-subjects/subject/${id}`, { name: `Religious Education ${tag}`, active: false });
  assert.equal(r.status, 200);
  const row = await db('academic_subjects').where({ id }).first();
  assert.equal(row.active, false);
  assert.equal(row.short_name, 'BK');
});

test('Older Academics tabs: one row per stream, subjects of the class only, teachers list for the Academic Master', { skip }, async () => {
  const a = await makeClass('P6', 'PINK', 'new');
  const b = await makeClass('P6', 'BLUE', 'new');
  let r = await as('acad', 'GET', `/api/academic/class-list?school=${school.id}`);
  assert.equal(r.status, 200);
  const ids = r.json.classes.map((c) => c.id);
  assert.ok(ids.includes(a.id) && ids.includes(b.id), 'both streams listed');
  r = await as('acad', 'GET', `/api/academic/subjects?school=${school.id}&class=${a.id}`);
  assert.equal(r.status, 200);
  assert.ok(r.json.subjects.length >= 8 && r.json.subjects.every((s) => s.level === 'P6'));
  r = await as('acad', 'GET', `/api/class-subjects/teachers?school=${school.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.teachers.some((t) => t.id === P.teacher.id));
  assert.ok(!r.json.teachers.some((t) => t.id === P.otherTeacher.id));
  assert.equal((await as('bursar', 'GET', `/api/class-subjects/teachers?school=${school.id}`)).status, 403);
});
