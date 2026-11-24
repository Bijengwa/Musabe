// Streams inside a class: shuffle, Excel, remove (2026-11-25).
// Runs only when TEST_DATABASE_URL points to a TEST database that is migrated and seeded. Never point it at real data.
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;
const ExcelJS = URL ? require('exceljs') : null; // loaded first: it is slow and would block the server in the middle of a request

const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const { listen, request } = require('./helpers');

const tag = `g${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const P = {};
let server, port, school, base, studs = [];
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body, rawBody) => request({ port, method, path, body, rawBody, cookie: P[who].cookie, headers: rawBody ? { 'Content-Type': 'application/octet-stream' } : {} });


test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  [school] = await db('schools').insert({ code: `cs${tag}`.slice(0, 20), name: `Streams School ${tag}`, short_name: `SS ${tag}`.slice(0, 60), receipt_prefix: `S${tag.slice(-3)}`.toUpperCase().slice(0, 4) }).returning('*');
  [base] = await db('classes').insert({ school_id: school.id, name: 'PRIMARY TWO', level: 'P2', short_name: 'P 2', curriculum: 'new' }).returning('*');
  for (const [key, role] of [['acad', 'acad'], ['teacher', 'teacher']]) {
    const username = `cs_${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: school.id, password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id ?? u, cookie: cookie(r) };
  }
  for (let i = 1; i <= 11; i++) {
    const [s] = await db('students').insert({ school_id: school.id, class_id: base.id, admission_no: `T${tag}-${i}`.toUpperCase(), first_name: 'PUPIL', last_name: `N${i}`, full_name: `PUPIL N${i}`, sex: i % 2 ? 'M' : 'F', status: 'active' }).returning('*');
    studs.push(s);
  }
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });
const count = (id) => db('students').where({ class_id: id, status: 'active' }).count('* as n').then((r) => Number(r[0].n));

test('create streams by the system: at least 2 names, the same number in each, only the Academic Master', { skip }, async () => {
  assert.equal((await as('teacher', 'POST', `/api/class-streams/${base.id}/streams`, { names: ['YELLOW', 'BLUE'] })).status, 403);
  assert.equal((await as('acad', 'POST', `/api/class-streams/${base.id}/streams`, { names: ['YELLOW'] })).status, 400);
  const r = await as('acad', 'POST', `/api/class-streams/${base.id}/streams`, { names: ['yellow', 'blue'] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const n = r.json.streams.map((s) => s.students).sort();
  assert.deepEqual(n, [5, 6]);
  assert.equal(await count(base.id), 0);
  assert.equal((await db('classes').where({ id: base.id }).first()).active, false);
  assert.equal((await as('acad', 'POST', `/api/class-streams/${base.id}/streams`, { names: ['A', 'B'] })).status, 409);
});

test('Excel of the class, and upload of one stream: the rest go to the other stream', { skip }, async () => {
  const [y, b] = await db('classes').where({ school_id: school.id }).whereNotNull('stream').orderBy('stream').then((r) => [r.find((x) => x.stream === 'YELLOW'), r.find((x) => x.stream === 'BLUE')]);
  const dl = await request({ port, method: 'GET', path: `/api/class-streams/${y.id}/class.xlsx`, cookie: P.acad.cookie, binary: true });
  assert.equal(dl.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.isBuffer(dl.body) ? dl.body : Buffer.from(dl.body, 'binary'));
  assert.ok(wb.getWorksheet('Students') && wb.getWorksheet('Subjects'));
  assert.equal(wb.getWorksheet('Students').rowCount, 12);
  // a file with only 3 admission numbers = the students of YELLOW; the 8 others go to BLUE
  const w2 = new ExcelJS.Workbook(); const ws = w2.addWorksheet('Students'); ws.addRow(['Admission No.']);
  for (const s of studs.slice(0, 3)) ws.addRow([s.admission_no]);
  const file = Buffer.from(await w2.xlsx.writeBuffer());
  const dry = await as('acad', 'POST', `/api/class-streams/${y.id}/members/excel?dry=1`, null, file);
  assert.equal(dry.status, 200, JSON.stringify(dry.json)); assert.deepEqual(dry.json.counts, { YELLOW: 3, BLUE: 8 });
  assert.equal(await count(y.id) + await count(b.id), 11);
  const go = await as('acad', 'POST', `/api/class-streams/${y.id}/members/excel`, null, file);
  assert.equal(go.status, 200, JSON.stringify(go.json));
  assert.equal(await count(y.id), 3); assert.equal(await count(b.id), 8);
});

test('remove streams: students back in the class, streams gone', { skip }, async () => {
  const r = await as('acad', 'POST', '/api/class-streams/remove', { classId: base.id });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(await count(base.id), 11);
  assert.equal((await db('classes').where({ id: base.id }).first()).active, true);
  const left = await db('classes').where({ school_id: school.id }).whereNotNull('stream');
  assert.ok(left.every((x) => !x.active), 'a stream that could not be deleted is switched off');
  // streams again by Excel with a named stream column
  const w = new ExcelJS.Workbook(); const ws = w.addWorksheet('Students'); ws.addRow(['Admission No.', 'Stream']);
  studs.forEach((s, i) => ws.addRow([s.admission_no, i < 4 ? 'PINK' : '']));
  const file = Buffer.from(await w.xlsx.writeBuffer());
  const names = `PINK,GREEN`;
  const dry = await as('acad', 'POST', `/api/class-streams/${base.id}/streams/excel?names=${names}&dry=1`, null, file);
  assert.equal(dry.status, 200, JSON.stringify(dry.json)); assert.deepEqual(dry.json.counts, { PINK: 4, GREEN: 7 });
  const go = await as('acad', 'POST', `/api/class-streams/${base.id}/streams/excel?names=${names}`, null, file);
  assert.equal(go.status, 201, JSON.stringify(go.json));
});
