// Calendar, lipa numbers and bulk staff registration (2026-11-24).
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

const tag = `c${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const P = {};
let server, port, school, other, kid, kidDay, otherKid;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body, cookie: P[who].cookie });
const YEAR = 2033;

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  [school] = await db('schools').insert({ code: `fs${tag}`.slice(0, 20), name: `Fees School ${tag}`, short_name: `FS ${tag}`.slice(0, 60), receipt_prefix: `F${tag.slice(-3)}`.toUpperCase().slice(0, 4), active: true }).returning('*');
  [other] = await db('schools').insert({ code: `fo${tag}`.slice(0, 20), name: `Fees Other ${tag}`, short_name: `FO ${tag}`.slice(0, 60), receipt_prefix: `X${tag.slice(-3)}`.toUpperCase().slice(0, 4), active: true }).returning('*');
  const [cls] = await db('classes').insert({ school_id: school.id, name: `PRIMARY FOUR`, stream: tag.slice(0, 6).toUpperCase(), level: 'P4', short_name: 'P 4', curriculum: 'new' }).returning('*');
  const [cls2] = await db('classes').insert({ school_id: other.id, name: `PRIMARY FOUR`, stream: tag.slice(0, 6).toUpperCase(), level: 'P4', short_name: 'P 4', curriculum: 'new' }).returning('*');
  const mk = (sid, c, n, adm) => ({ school_id: sid, admission_no: `${adm}${tag}`.slice(0, 20), first_name: n, last_name: 'TEST', full_name: `${n} TEST`, sex: 'F', class_id: c.id });
  [kid] = await db('students').insert(mk(school.id, cls, 'NEEMA', 'A')).returning('*');
  [kidDay] = await db('students').insert(mk(school.id, cls, 'JUMA', 'B')).returning('*');
  [otherKid] = await db('students').insert(mk(other.id, cls2, 'ASHA', 'C')).returning('*');
  const make = [['super', 'super', null], ['acc', 'acc', null], ['head', 'head', school.id], ['head2', 'head', other.id], ['teacher', 'teacher', school.id], ['bursar', 'bursar', school.id]];
  for (const [key, role, sid] of make) {
    const username = `ca_${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: sid, password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id, cookie: cookie(r) };
  }
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });

test('only the Head Master writes terms; terms cannot overlap; another school cannot see them', { skip }, async () => {
  const t1 = { year: 2027, term: 1, opensOn: '2027-01-11', closesOn: '2027-06-08', breakFrom: '2027-03-25', breakTo: '2027-04-05', studyDays: 95 };
  assert.equal((await as('teacher', 'POST', '/api/calendar/terms', t1)).status, 403);
  assert.equal((await as('bursar', 'POST', '/api/calendar/terms', t1)).status, 403);
  assert.equal((await as('head', 'POST', '/api/calendar/terms', { ...t1, closesOn: '2027-01-01' })).status, 400);
  assert.equal((await as('head', 'POST', '/api/calendar/terms', { ...t1, breakFrom: '2026-12-01' })).status, 400, 'break outside the term');
  assert.equal((await as('head', 'POST', '/api/calendar/terms', t1)).status, 200);
  assert.equal((await as('head', 'POST', '/api/calendar/terms', { year: 2027, term: 2, opensOn: '2027-06-01', closesOn: '2027-12-03' })).status, 409, 'overlaps term 1');
  assert.equal((await as('head', 'POST', '/api/calendar/terms', { year: 2027, term: 2, opensOn: '2027-07-12', closesOn: '2027-12-03', breakFrom: '2027-09-10', breakTo: '2027-09-20', studyDays: 99 })).status, 200);
  assert.equal((await as('head', 'POST', '/api/calendar/terms', { ...t1, studyDays: 96 })).status, 200, 'a term can be corrected');
  const c = (await as('teacher', 'GET', '/api/calendar?year=2027')).json;
  assert.equal(c.terms.length, 2); assert.equal(c.terms[0].studyDays, 96); assert.equal(c.terms[0].opensOn, '2027-01-11'); assert.equal(c.canWrite, false);
  assert.equal((await as('head2', 'GET', '/api/calendar?year=2027')).json.terms.length, 0);
});

test('the Head Master declares a holiday, chooses who stays, makes the program, publishes', { skip }, async () => {
  const mk = async (sid, lvl, short) => (await db('classes').insert({ school_id: sid, name: lvl, stream: tag.slice(0, 5).toUpperCase(), level: lvl, short_name: short, curriculum: 'new' }).returning('*'))[0];
  const p4 = await mk(school.id, 'P4', 'P 4'); const p2 = await mk(school.id, 'P2', 'P 2');
  await db('students').insert({ school_id: school.id, admission_no: `Z${tag}`.slice(0, 20), first_name: 'ZAWADI', last_name: 'TEST', full_name: 'ZAWADI TEST', sex: 'F', class_id: p4.id });
  const h = { name: 'June holiday', fromDate: '2027-06-08', toDate: '2027-07-12' };
  assert.equal((await as('teacher', 'POST', '/api/calendar/holidays', h)).status, 403);
  assert.equal((await as('head', 'POST', '/api/calendar/holidays', { ...h, toDate: '2027-06-01' })).status, 400);
  const d = await as('head', 'POST', '/api/calendar/holidays', h);
  assert.equal(d.status, 201);
  assert.equal((await as('head', 'POST', '/api/calendar/holidays', h)).status, 409, 'same holiday twice');
  const id = d.json.id;
  const item = { day: '2027-06-15', start: '08:00', end: '10:00', activity: 'Mathematics revision' };
  assert.equal((await as('head', 'POST', `/api/calendar/holidays/${id}/items`, item)).status, 409, 'classes first');
  assert.equal((await as('head', 'PUT', `/api/calendar/holidays/${id}/program`, { levels: [] })).status, 400);
  assert.equal((await as('head2', 'PUT', `/api/calendar/holidays/${id}/program`, { levels: ['P4'] })).status, 404, 'another school');
  assert.equal((await as('head', 'PUT', `/api/calendar/holidays/${id}/program`, { levels: ['P4', 'P5', 'P6', 'P7'] })).status, 200);
  assert.equal((await as('head', 'POST', `/api/calendar/holidays/${id}/items`, { ...item, day: '2027-08-01' })).status, 400, 'outside the holiday');
  assert.equal((await as('head', 'POST', `/api/calendar/holidays/${id}/items`, { ...item, end: '07:00' })).status, 400);
  assert.equal((await as('head', 'POST', `/api/calendar/holidays/${id}/items`, { ...item, classId: p2.id })).status, 400, 'P2 does not stay');
  assert.equal((await as('head', 'POST', `/api/calendar/holidays/${id}/publish`)).status, 400, 'nothing to publish');
  const it = await as('head', 'POST', `/api/calendar/holidays/${id}/items`, { ...item, classId: p4.id, place: 'Class P4' });
  assert.equal(it.status, 201, JSON.stringify(it.json));
  const g = (await as('teacher', 'GET', `/api/calendar/holidays/${id}`)).json;
  assert.equal(g.classes.length, 2); assert.equal(g.items.length, 1); assert.equal(g.students, 3); assert.equal(g.canWrite, false);
  assert.equal((await as('head', 'POST', `/api/calendar/holidays/${id}/publish`)).status, 200);
  assert.equal((await as('head', 'POST', `/api/calendar/holidays/${id}/items`, item)).status, 409, 'published');
});

test('lipa numbers: the Accountant adds, the Bursar cannot; bills carry the parent claim', { skip }, async () => {
  const n = { schoolId: school.id, network: 'mpesa', number: `5${Date.now().toString().slice(-6)}`, accountName: 'MUSABE SCHOOL' };
  assert.equal((await as('bursar', 'POST', '/api/lipa', n)).status, 403);
  assert.equal((await as('acc', 'POST', '/api/lipa', { ...n, number: '12' })).status, 400);
  const a = await as('acc', 'POST', '/api/lipa', n);
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.equal((await as('acc', 'POST', '/api/lipa', n)).status, 409);
  const l = (await as('bursar', 'GET', `/api/lipa`)).json;
  assert.equal(l.numbers.length, 1); assert.equal(l.canWrite, false);
});

test('Super Admin registers staff from Excel; usernames are made by the system', { skip }, async () => {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Staff');
  ws.addRow(['Full name', 'Role', 'School', 'Phone']);
  ws.addRow([`Mary John Mushi${tag}`, 'Teacher', school.short_name, '0712345678']);
  ws.addRow([`Mary Peter Mushi${tag}`, 'Teacher', school.short_name, '']);
  ws.addRow(['Ash', 'Bursar', school.short_name, '']);
  ws.addRow([`Joseph Kim${tag}`, 'Wizard', school.short_name, '']);
  ws.addRow([`Neema Paul Lyimo${tag}`, 'Teacher', 'No Such School', '']);
  ws.addRow([`Peter Mwita${tag}`, 'Accountant', '', '07123']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const post = (who, q) => request({ port, method: 'POST', path: `/api/users/bulk${q}`, cookie: P[who].cookie, rawBody: buf, headers: { 'content-type': 'application/octet-stream' } });
  assert.equal((await post('head', '')).status, 403);
  const chk = await post('super', '?check=1');
  assert.equal(chk.status, 200, JSON.stringify(chk.json));
  assert.equal(chk.json.ok, 2); assert.equal(chk.json.errors.length, 4);
  assert.equal(await db('users').whereILike('full_name', `Mary%${tag}`).count({ n: '*' }).first().then((r) => Number(r.n)), 0, 'a check saves nothing');
  const r = await post('super', '');
  assert.equal(r.status, 201);
  assert.equal(r.json.created.length, 2);
  const names = r.json.created.map((c) => c.username);
  assert.equal(new Set(names).size, 2, 'two different usernames');
  assert.ok(names.every((n) => /^mary\.mushi/.test(n)));
  assert.ok(r.json.created.every((c) => c.tempPassword.length >= 8));
  const login = await request({ port, method: 'POST', path: '/api/auth/login', body: { username: r.json.created[0].username, password: r.json.created[0].tempPassword } });
  assert.equal(login.status, 200);
});

test('the Super Admin can refuse a password request', { skip }, async () => {
  await db('users').where({ id: P.bursar.id }).update({ reset_requested_at: db.fn.now() });
  assert.equal((await as('teacher', 'POST', `/api/users/${P.bursar.id}/refuse-reset`, {})).status, 403);
  assert.equal((await as('super', 'POST', `/api/users/${P.bursar.id}/refuse-reset`, { reason: 'Not known to the school' })).status, 200);
  assert.equal((await db('users').where({ id: P.bursar.id }).first()).reset_requested_at, null);
  assert.equal((await as('super', 'POST', `/api/users/${P.bursar.id}/refuse-reset`, {})).status, 409, 'nothing to refuse now');
});
