// Requested Cash Payout Voucher: Assistant Accountant prepares -> Financial Officer authorizes -> Cashier pays, payee signs.
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;
const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const { listen, request } = require('./helpers');

const tag = `v${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const PIN = '2468';
const PNG = `data:image/png;base64,${'A'.repeat(1200)}`;
const P = {};
let server, port;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body, cookie: P[who].cookie });

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  const pinHash = await bcrypt.hash(PIN, 4);
  for (const [key, role] of [['aacc', 'aacc'], ['fm', 'fm'], ['cashier', 'cashier'], ['acc', 'acc'], ['manager', 'manager']]) {
    const username = `v_${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, password_hash: await bcrypt.hash(password, 4), must_change_password: false, phone: '0712000000', signature_image: PNG, signing_pin_hash: pinHash }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id, cookie: cookie(r) };
  }
});
test.after(async () => { if (server) server.close(); if (db) await db.destroy(); });

test('voucher flow: prepare, authorize, pay with payee signature; sealed and frozen', { skip }, async () => {
  const body = { payeeName: 'JUMA MASHAKA', purpose: 'Fundi payment', chequeNo: 'CH-12', lines: [{ detail: 'Cement', amount: 40000 }, { detail: 'Labour', amount: 60000 }], pin: PIN };
  assert.equal((await as('fm', 'POST', '/api/payments', body)).status, 403, 'only the Assistant Accountant prepares');
  assert.equal((await as('aacc', 'POST', '/api/payments', { ...body, pin: '0000' })).status, 403, 'wrong PIN');
  const c = await as('aacc', 'POST', '/api/payments', body);
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const v = c.json.payment;
  assert.equal(v.status, 'review');
  assert.equal(v.amount, 100000);
  assert.equal(v.lines.length, 2);
  assert.ok(v.signs.prepared.image);
  assert.equal((await as('cashier', 'POST', `/api/payments/${v.id}/decide`, { approve: true, payeeImage: PNG, pin: PIN })).status, 409, 'cashier cannot pay before authorization');
  assert.equal((await as('aacc', 'POST', `/api/payments/${v.id}/authorize`, { approve: true, pin: PIN })).status, 403);
  assert.equal((await as('acc', 'POST', `/api/payments/${v.id}/authorize`, { approve: true, pin: PIN })).status, 403, 'the Head Accountant only audits');
  const a = await as('fm', 'POST', `/api/payments/${v.id}/authorize`, { approve: true, pin: PIN });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.payment.status, 'pending');
  const bad = await as('cashier', 'POST', `/api/payments/${v.id}/decide`, { approve: true, pin: PIN });
  assert.equal(bad.status, 400, 'payee must sign');
  const pay = await as('cashier', 'POST', `/api/payments/${v.id}/decide`, { approve: true, payeeImage: PNG, pin: PIN });
  assert.equal(pay.status, 200, JSON.stringify(pay.json));
  assert.equal(pay.json.payment.status, 'paid');
  assert.ok(pay.json.payment.signs.payee.image && pay.json.payment.signs.paid && pay.json.payment.signs.authorized);
  assert.equal(pay.json.payment.seal.status, 'valid');
  assert.equal((await as('cashier', 'POST', `/api/payments/${v.id}/decide`, { approve: true, payeeImage: PNG, pin: PIN })).status, 409);
});

test('FO can reject with a reason; no PIN needed to reject', { skip }, async () => {
  const c = await as('aacc', 'POST', '/api/payments', { payeeName: 'ASHA', purpose: 'Test', lines: [{ detail: 'X item', amount: 5000 }], pin: PIN });
  const id = c.json.payment.id;
  assert.equal((await as('fm', 'POST', `/api/payments/${id}/authorize`, { approve: false })).status, 400);
  const r = await as('fm', 'POST', `/api/payments/${id}/authorize`, { approve: false, note: 'Not budgeted' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.payment.status, 'rejected');
});

test('The Manager also authorizes vouchers (or the Finance Manager when he is away); the Accountant cannot', { skip }, async () => {
  const c = await as('aacc', 'POST', '/api/payments', { payeeName: 'ASHA', purpose: 'Test', lines: [{ detail: 'Y item', amount: 7000 }], pin: PIN });
  const id = c.json.payment.id;
  assert.equal((await as('acc', 'POST', `/api/payments/${id}/authorize`, { approve: true, pin: PIN })).status, 403);
  const r = await as('manager', 'POST', `/api/payments/${id}/authorize`, { approve: true, pin: PIN });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.payment.status, 'pending');
});
