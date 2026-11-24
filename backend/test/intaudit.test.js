// Internal audit (2026-11-24): every check runs on real tables, findings need the Accountant, notes stay.
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

const tag = `a${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const P = {};
let server, port, school, other, kid, kidDay, otherKid;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body, cookie: P[who].cookie });
const YEAR = 2032;

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
  const make = [['acc', 'acc', null], ['aacc', 'aacc', null], ['manager', 'manager', null], ['bursar', 'bursar', school.id], ['head', 'head', school.id]];
  for (const [key, role, sid] of make) {
    const username = `au_${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: sid, password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id, cookie: cookie(r) };
  }
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });

test('every check runs; only the Accountant opens and closes findings; notes stay', { skip }, async () => {
  const c = await as('acc', 'GET', `/api/intaudit/checks?school=${school.id}`);
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.ok(c.json.checks.length >= 11 && c.json.canWrite);
  assert.equal((await as('aacc', 'GET', '/api/intaudit/checks')).status, 200);
  assert.equal((await as('aacc', 'GET', '/api/intaudit/checks')).json.canWrite, false);
  assert.equal((await as('bursar', 'GET', '/api/intaudit/checks')).status, 403);
  assert.equal((await as('head', 'GET', '/api/intaudit/findings')).status, 403);
  assert.equal((await as('manager', 'GET', '/api/intaudit/checks')).status, 200);
  const body = { check: 'money_unchecked', ref: `money:1:${tag}`, title: 'Test finding', schoolId: school.id, note: 'look at it' };
  assert.equal((await as('aacc', 'POST', '/api/intaudit/findings', body)).status, 403);
  assert.equal((await as('acc', 'POST', '/api/intaudit/findings', { ...body, check: 'nope' })).status, 400);
  assert.equal((await as('acc', 'POST', '/api/intaudit/findings', { ...body, note: '' })).status, 400);
  const o = await as('acc', 'POST', '/api/intaudit/findings', body);
  assert.equal(o.status, 201);
  assert.equal((await as('acc', 'POST', '/api/intaudit/findings', body)).status, 409, 'already open');
  const id = o.json.id;
  assert.equal((await as('acc', 'POST', `/api/intaudit/findings/${id}/note`, { note: 'asked the bursar' })).status, 200);
  assert.equal((await as('acc', 'POST', `/api/intaudit/findings/${id}/close`, { note: 'short' })).status, 400, 'a real reason is needed');
  assert.equal((await as('manager', 'POST', `/api/intaudit/findings/${id}/close`, { note: 'closed by manager now' })).status, 403);
  assert.equal((await as('acc', 'POST', `/api/intaudit/findings/${id}/close`, { note: 'Bursar showed the cash; counted and agreed.' })).status, 200);
  assert.equal((await as('acc', 'POST', `/api/intaudit/findings/${id}/close`, { note: 'Bursar showed the cash; counted and agreed.' })).status, 409);
  assert.equal((await as('acc', 'POST', `/api/intaudit/findings/${id}/note`, { note: 'late note' })).status, 409);
  const l = await as('aacc', 'GET', '/api/intaudit/findings?status=closed');
  const f = l.json.findings.find((x) => x.id === id);
  assert.equal(f.notes.length, 2); assert.equal(f.status, 'closed');
  await assert.rejects(db('audit_finding_notes').where({ finding_id: id }).del(), 'notes cannot be deleted');
  await assert.rejects(db('audit_finding_notes').where({ finding_id: id }).update({ note: 'changed' }), 'notes cannot be changed');
  assert.equal((await as('acc', 'POST', '/api/intaudit/findings', body)).status, 201, 'after closing, it may be opened again');
});

test('a bursar day with receipts but no money check shows up', { skip }, async () => {
  const cls = (await db('classes').where({ school_id: school.id }).first());
  const day = '2020-01-15';
  const [r] = await db('receipts').insert({ school_id: school.id, no: 1, number: `${school.receipt_prefix}/R.0001`, student_id: kid.id, student_name: kid.full_name, student_class: 'P 4', gender: 'girl', total: 5000, sold_by: P.bursar.id, sold_at: `${day}T10:00:00+03:00`, status: 'given', method: 'cash' }).returning('id').catch((e) => [{ err: e.message }]);
  assert.ok(!r.err, r.err);
  const c = await as('acc', 'GET', `/api/intaudit/checks?school=${school.id}`);
  const m = c.json.checks.find((x) => x.key === 'money_unchecked');
  assert.ok(m.items.some((i) => i.ref === `money:${P.bursar.id}:${day}`));
});
