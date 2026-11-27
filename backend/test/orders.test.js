// Order Book and the new requisition rule (2026-11-20).
// Runs only when TEST_DATABASE_URL points to a TEST database that is migrated and seeded. Never point it at real data.
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;
process.env.SIGN_SMS_FROM = '1000000000000';

const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const { listen, request } = require('./helpers');

const tag = `o${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const PIN = '2468';
const PNG = `data:image/png;base64,${'A'.repeat(1200)}`;
const P = {};
let server, port, em;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body: method === 'POST' && body && typeof body === 'object' ? { pin: PIN, ...body } : body, cookie: P[who].cookie });

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  em = await db('schools').where({ code: 'pre' }).first();
  const make = [['teacher', 'teacher', em.id], ['acad', 'acad', em.id], ['librarian', 'librarian', em.id], ['head', 'head', em.id], ['bursar', 'bursar', em.id],
    ['manager', 'manager', null], ['fm', 'fm', null], ['keeper', 'storekeeper', null], ['amanager', 'amanager', null], ['cashier', 'cashier', null], ['acc', 'acc', null], ['aacc', 'aacc', null]];
  for (const [key, role, school] of make) {
    const username = `${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: school, password_hash: await bcrypt.hash(password, 4), must_change_password: false,
      phone: '0712000000', signature_image: PNG, signing_pin_hash: await bcrypt.hash(PIN, 4) }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id, cookie: cookie(r) };
  }
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });

test('Teachers do not write orders (they ask the Academic Master by word)', { skip }, async () => {
  assert.equal((await as('teacher', 'POST', '/api/orders', { lines: [{ qty: 4, unit: 'boxes', particulars: 'White chalk' }] })).status, 403);
});

test('Academic Master order → store-keeper writes the requisition → Finance Manager approves → Cashier float', { skip }, async () => {
  let r = await as('acad', 'POST', '/api/orders', { lines: [{ qty: 20, unit: 'pcs', particulars: 'Exercise books 96 pages' }, { particulars: 'Manila papers' }] });
  assert.equal(r.status, 201); const o = r.json.order; assert.equal(o.status, 'keeper', 'no Head Master signature');
  r = await as('keeper', 'GET', '/api/orders?status=keeper');
  assert.ok(r.json.orders.some((x) => x.id === o.id)); assert.ok(r.json.orders.find((x) => x.id === o.id).turn === 'keeper');
  // Only the buyers write requisitions now.
  assert.equal((await as('acad', 'POST', '/api/requisitions', { lines: [{ name: 'chalk', total: 1000 }] })).status, 403);
  assert.equal((await as('bursar', 'POST', '/api/requisitions', { lines: [{ name: 'chalk', total: 1000 }] })).status, 403);
  assert.equal((await as('keeper', 'POST', '/api/requisitions', { schoolId: em.id, orderId: o.id, lines: [{ name: 'Exercise books', qty: 20 }] })).status, 400, 'the buyer writes the amount');
  r = await as('keeper', 'POST', '/api/requisitions', { schoolId: em.id, orderId: o.id, kind: 'academic', lines: [{ name: 'Exercise books 96 pages', qty: 20, estCost: 1500 }, { name: 'Manila papers', total: 8000 }] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const q = r.json.requisition;
  assert.equal(q.status, 'check'); assert.ok(q.signs.store, 'the store-keeper signature is on it');
  assert.equal((await as('aacc', 'POST', `/api/requisitions/${q.id}/check`, { approve: true })).status, 200, 'the Assistant Accountant checks');
  assert.equal((await as('keeper', 'GET', `/api/orders/${o.id}`)).json.order.status, 'requisition');
  assert.equal((await as('keeper', 'POST', '/api/requisitions', { schoolId: em.id, orderId: o.id, lines: [{ name: 'Chalk', total: 1000 }] })).status, 409, 'one requisition per order');
  assert.equal((await as('keeper', 'POST', `/api/requisitions/${q.id}/manager`, { approve: true })).status, 403, 'nobody approves his own');
  r = await as('manager', 'POST', `/api/requisitions/${q.id}/manager`, { approve: true });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.requisition.status, 'approved');
  const money = await db('payment_requests').where({ requisition_id: q.id, kind: 'float' }).first();
  assert.equal(Number(money.amount), 38000); assert.match(money.approved_by_name, /Finance Manager/);
});

test('Librarian order → Head Master → Manager → store-keeper rejects with a reason', { skip }, async () => {
  let r = await as('librarian', 'POST', '/api/orders', { lines: [{ qty: 10, unit: 'reams', particulars: 'Photocopy paper A4' }] });
  const o = r.json.order; assert.equal(o.status, 'head'); assert.equal(o.place, 'library');
  assert.equal((await as('manager', 'POST', `/api/orders/${o.id}/manager`, { approve: true })).status, 409);
  assert.equal((await as('head', 'POST', `/api/orders/${o.id}/head`, { approve: false })).status, 400, 'a reject needs a reason');
  r = await as('head', 'POST', `/api/orders/${o.id}/head`, { approve: true, lines: [{ lineId: o.lines[0].id, qty: 8 }] });
  assert.equal(r.json.order.status, 'manager');
  assert.equal((await as('fm', 'POST', `/api/orders/${o.id}/manager`, { approve: true })).status, 403, 'the Manager approves orders');
  r = await as('manager', 'POST', `/api/orders/${o.id}/manager`, { approve: true });
  assert.equal(r.json.order.status, 'keeper');
  assert.equal((await as('keeper', 'POST', `/api/orders/${o.id}/keeper`, {})).status, 400);
  r = await as('amanager', 'POST', `/api/orders/${o.id}/keeper`, { note: 'Bought last week, still in the library' });
  assert.equal(r.status, 200); assert.equal(r.json.order.status, 'rejected'); assert.equal(r.json.order.rejected.reason, 'Bought last week, still in the library');
  // The librarian sees it; another school's staff does not.
  assert.equal((await as('librarian', 'GET', `/api/orders/${o.id}`)).json.order.status, 'rejected');
});

test('Assistant Manager writes a requisition for a school; the Manager approves; he buys it', { skip }, async () => {
  let r = await as('amanager', 'POST', '/api/requisitions', { lines: [{ name: 'Brooms', qty: 10, estCost: 2500 }] });
  assert.equal(r.status, 400, 'a school must be chosen');
  r = await as('amanager', 'POST', '/api/requisitions', { schoolId: em.id, lines: [{ name: 'Brooms', qty: 10, estCost: 2500 }] });
  assert.equal(r.status, 201, JSON.stringify(r.json)); const q = r.json.requisition;
  assert.equal(q.waiting.role, 'Assistant Accountant');
  await as('aacc', 'POST', `/api/requisitions/${q.id}/check`, { approve: true });
  r = await as('manager', 'POST', `/api/requisitions/${q.id}/manager`, { approve: true });
  assert.equal(r.json.requisition.status, 'approved');
  r = await as('amanager', 'GET', `/api/requisitions/${q.id}`);
  assert.equal(r.json.requisition.turn, 'fulfil', 'he who wrote it buys it');
  const home = await as('fm', 'GET', '/api/dashboard');
  assert.equal(home.status, 200);
});
