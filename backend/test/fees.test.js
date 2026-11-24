// School fees (2026-11-24): fee structure, approval, payments, confirmation, balances.
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

const tag = `f${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const P = {};
let server, port, school, other, kid, kidDay, otherKid;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body, cookie: P[who].cookie });
const YEAR = 2031;

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
  const make = [['fm', 'fm', null], ['manager', 'manager', null], ['acc', 'acc', null], ['bursar', 'bursar', school.id], ['bursar2', 'bursar', other.id], ['head', 'head', school.id], ['sadmin', 'sadmin', school.id]];
  for (const [key, role, sid] of make) {
    const username = `fe_${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: sid, password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id, cookie: cookie(r) };
  }
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });

const line = (over = {}) => ({ schoolId: school.id, year: YEAR, term: 0, level: 'P4', residence: 'all', name: 'tuition', amount: 600000, ...over });

test('only the Finance Manager writes the fee structure; the Manager approves; nobody else', { skip }, async () => {
  assert.equal((await as('bursar', 'POST', '/api/fees/structure', line())).status, 403);
  assert.equal((await as('manager', 'POST', '/api/fees/structure', line())).status, 403);
  assert.equal((await as('fm', 'POST', '/api/fees/structure', line({ level: 'F9' }))).status, 400, 'level not in the school');
  assert.equal((await as('fm', 'POST', '/api/fees/structure', line({ amount: 0 }))).status, 400);
  assert.equal((await as('fm', 'POST', '/api/fees/structure', line())).status, 201);
  assert.equal((await as('fm', 'POST', '/api/fees/structure', line({ residence: 'boarding', name: 'boarding', amount: 400000 }))).status, 201);
  assert.equal((await as('fm', 'POST', '/api/fees/structure', line())).status, 409, 'a second draft of the same fee');
  assert.equal((await as('fm', 'POST', '/api/fees/structure/approve', { schoolId: school.id, year: YEAR })).status, 403, 'the Finance Manager cannot approve his own lines');
  // nothing approved yet: no payment possible
  await as('bursar', 'POST', `/api/fees/student/${kid.id}/residence`, { residence: 'boarding' });
  const early = await as('bursar', 'POST', '/api/fees/payments', { studentId: kid.id, year: YEAR, amount: 100000, method: 'cash' });
  assert.equal(early.status, 409);
  const ap = await as('manager', 'POST', '/api/fees/structure/approve', { schoolId: school.id, year: YEAR });
  assert.equal(ap.status, 200); assert.equal(ap.json.approved, 2);
  assert.equal((await as('manager', 'POST', '/api/fees/structure/approve', { schoolId: school.id, year: YEAR })).status, 409, 'nothing left to approve');
  const s = await as('head', 'GET', `/api/fees/structure?school=${school.id}&year=${YEAR}`);
  assert.equal(s.json.lines.length, 2); assert.ok(s.json.lines.every((l) => l.status === 'approved'));
});

test('payments: the Bursar records, never more than is owed, one slip once; the Accountant confirms', { skip }, async () => {
  const st = (await as('bursar', 'GET', `/api/fees/student/${kid.id}?year=${YEAR}`)).json;
  assert.equal(st.due, 1000000, 'boarding child owes tuition + boarding');
  const day = (await as('bursar', 'GET', `/api/fees/student/${kidDay.id}?year=${YEAR}`)).json;
  assert.equal(day.due, 600000, 'a child without day/boarding set pays only the fees for everyone');
  assert.ok(day.warning);
  assert.equal((await as('bursar', 'POST', '/api/fees/payments', { studentId: kid.id, year: YEAR, amount: 300000, method: 'bank' })).status, 400, 'a bank payment needs the slip number');
  const a = await as('bursar', 'POST', '/api/fees/payments', { studentId: kid.id, year: YEAR, term: 1, amount: 300000, method: 'bank', reference: `slip${tag}`, payer: 'mama neema' });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.match(a.json.payment.number, /\/FEE\.0001$/);
  assert.equal((await as('bursar', 'POST', '/api/fees/payments', { studentId: kidDay.id, year: YEAR, amount: 100000, method: 'mobile', reference: `SLIP${tag}` })).status, 409, 'the same slip twice');
  assert.equal((await as('bursar', 'POST', '/api/fees/payments', { studentId: kid.id, year: YEAR, amount: 800000, method: 'cash' })).status, 409, 'more than the balance');
  assert.equal((await as('bursar2', 'POST', '/api/fees/payments', { studentId: kid.id, year: YEAR, amount: 1000, method: 'cash' })).status, 404, 'another school');
  assert.equal((await as('acc', 'POST', '/api/fees/payments', { studentId: kid.id, year: YEAR, amount: 1000, method: 'cash' })).status, 403, 'only the Bursar records');
  const b = await as('bursar', 'POST', '/api/fees/payments', { studentId: kid.id, year: YEAR, amount: 700000, method: 'cash' });
  assert.equal(b.status, 201); assert.match(b.json.payment.number, /\/FEE\.0002$/);
  assert.equal((await as('bursar', 'POST', `/api/fees/payments/${a.json.payment.id}/confirm`, {})).status, 403, 'the Bursar does not confirm his own money');
  assert.equal((await as('acc', 'POST', `/api/fees/payments/${a.json.payment.id}/confirm`, {})).status, 200);
  assert.equal((await as('acc', 'POST', `/api/fees/payments/${a.json.payment.id}/confirm`, {})).status, 409);
  await assert.rejects(db('fee_payments').where({ id: a.json.payment.id }).update({ amount: 1 }), /cannot be changed/);
  await assert.rejects(db('fee_payments').where({ id: a.json.payment.id }).del(), /never deleted/);
  const list = await as('acc', 'GET', `/api/fees/payments?school=${school.id}&status=recorded`);
  assert.equal(list.json.waiting, 1, 'one payment still waits for the Accountant');
});

test('balances: due, paid and what is left; a new amount closes the old line only when approved', { skip }, async () => {
  const bal = (await as('head', 'GET', `/api/fees/balances?year=${YEAR}`)).json;
  const row = bal.rows.find((r) => r.id === kid.id);
  assert.equal(row.due, 1000000); assert.equal(row.paid, 1000000); assert.equal(row.balance, 0);
  assert.equal(bal.rows.find((r) => r.id === kidDay.id).balance, 600000);
  assert.ok(!bal.rows.find((r) => r.id === otherKid.id), 'only the school of the reader');
  assert.equal((await as('fm', 'POST', '/api/fees/structure', line({ amount: 650000 }))).status, 201);
  const still = (await as('head', 'GET', `/api/fees/balances?year=${YEAR}`)).json.rows.find((r) => r.id === kidDay.id);
  assert.equal(still.due, 600000, 'the old amount stays until the Manager approves');
  assert.equal((await as('manager', 'POST', '/api/fees/structure/approve', { schoolId: school.id, year: YEAR })).status, 200);
  const now = (await as('head', 'GET', `/api/fees/balances?year=${YEAR}`)).json.rows.find((r) => r.id === kidDay.id);
  assert.equal(now.due, 650000);
  const hist = (await as('manager', 'GET', `/api/fees/structure?school=${school.id}&year=${YEAR}&history=1`)).json.lines;
  assert.equal(hist.filter((l) => l.name === 'TUITION' && l.status === 'closed').length, 1, 'the old line is kept as closed');
  const x = await as('bursar', 'GET', `/api/fees/balances/export.xlsx?year=${YEAR}`);
  assert.equal(x.status, 200);
});
