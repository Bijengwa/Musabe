// Buying with the office's money: buyer signs -> Mapokezi checks and signs -> Assistant Accountant checks -> Manager approves ->
// Cashier writes the Cheque / Cash Payment Voucher (real amounts), takes the change and signs -> goods go to the school.
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;
const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const { listen, request } = require('./helpers');

const tag = `b${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const PIN = '2468';
const PNG = `data:image/png;base64,${'A'.repeat(1200)}`;
const P = {};
let server, port, em, item, rq, float;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body, cookie: P[who].cookie });

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  em = await db('schools').where({ code: 'pre' }).first();
  const pinHash = await bcrypt.hash(PIN, 4);
  for (const [key, role] of [['keeper', 'storekeeper'], ['mapokezi', 'mapokezi'], ['cashier', 'cashier'], ['acc', 'acc'], ['aacc', 'aacc'], ['manager', 'manager']]) {
    const username = `bu_${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, password_hash: await bcrypt.hash(password, 4), must_change_password: false, phone: '0712000000', signature_image: PNG, signing_pin_hash: pinHash }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id, cookie: cookie(r) };
  }
  [item] = await db('items').insert({ name: `PEN ${tag}`, unit: 'pc', category: 'stationery', code: `T${tag}`, active: true }).returning('*').catch(async () => [await db('items').where({ active: true }).first()]);
  [rq] = await db('requisitions').insert({ number: `RQN.T${tag}`.slice(0, 20), school_id: em.id, kind: 'general', status: 'approved', requested_by: P.keeper.id, purpose: 'test', applicant_name: 'X' }).returning('*');
  [float] = await db('payment_requests').insert({ number: `PRQ.T${tag}`.slice(0, 20), kind: 'float', status: 'paid', purpose: 'float', amount: 100000, est_amount: 100000, requisition_id: rq.id, requested_by: P.keeper.id, paid_by: P.cashier.id, paid_at: db.fn.now() }).returning('*');
});
test.after(async () => { if (server) server.close(); if (db) await db.destroy(); });

test('buy -> check -> cashier takes the money back; each step signed', { skip }, async () => {
  const body = { requisitionId: rq.id, supplier: 'Nyanza Stationery', lines: [{ itemId: item.id, qty: 10, unitCost: 6000 }] };
  assert.equal((await as('keeper', 'POST', '/api/purchases', body)).status, 403, 'no PIN');
  const c = await as('keeper', 'POST', '/api/purchases', { ...body, pin: PIN });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const p = c.json.purchase;
  assert.ok(p.signs.bought.image); assert.equal(p.seal.status, 'valid');
  assert.equal(p.floatAmount, 100000);
  const k = await as('mapokezi', 'POST', `/api/purchases/${p.id}/check`, { pin: PIN, lines: [{ lineId: p.lines[0].id, countedQty: 10 }] });
  assert.equal(k.status, 200, JSON.stringify(k.json));
  assert.equal(k.json.purchase.canSettle, false);
  assert.equal(k.json.purchase.stage, 'acheck');
  assert.equal((await as('acc', 'POST', `/api/purchases/${p.id}/decide`, { approve: true, pin: PIN, method: 'cash', returnedAmount: 40000 })).status, 403, 'the Head Accountant only audits');
  assert.equal((await as('cashier', 'POST', `/api/purchases/${p.id}/decide`, { approve: true, pin: PIN, method: 'cash', returnedAmount: 40000 })).status, 409, 'the Assistant Accountant and the Manager approve first');
  assert.equal((await as('manager', 'POST', `/api/purchases/${p.id}/approve`, { approve: true, pin: PIN })).status, 409, 'the Assistant Accountant goes first');
  assert.equal((await as('cashier', 'POST', `/api/purchases/${p.id}/acheck`, { approve: true, pin: PIN })).status, 403, 'only the Assistant Accountant checks');
  let a = await as('aacc', 'POST', `/api/purchases/${p.id}/acheck`, { approve: true, pin: PIN });
  assert.equal(a.status, 200, JSON.stringify(a.json)); assert.equal(a.json.purchase.stage, 'manager'); assert.ok(a.json.purchase.signs.acheck);
  assert.equal((await as('aacc', 'POST', `/api/purchases/${p.id}/approve`, { approve: true, pin: PIN })).status, 403, 'only the Manager or the Finance Manager approves');
  a = await as('manager', 'POST', `/api/purchases/${p.id}/approve`, { approve: true, pin: PIN });
  assert.equal(a.status, 200, JSON.stringify(a.json)); assert.equal(a.json.purchase.stage, 'voucher'); assert.ok(a.json.purchase.signs.approved);
  assert.equal((await as('cashier', 'POST', `/api/purchases/${p.id}/decide`, { approve: true, pin: PIN, returnedAmount: 40000 })).status, 400, 'the voucher says cash or cheque');
  assert.equal((await as('cashier', 'POST', `/api/purchases/${p.id}/decide`, { approve: true, pin: PIN, method: 'cheque', returnedAmount: 40000 })).status, 400, 'a cheque needs its number');
  assert.equal((await as('cashier', 'POST', `/api/purchases/${p.id}/decide`, { approve: true, pin: PIN, method: 'cash' })).status, 400, 'must write the money back');
  assert.equal((await as('cashier', 'POST', `/api/purchases/${p.id}/decide`, { approve: true, pin: PIN, method: 'cash', returnedAmount: 30000 })).status, 400, 'a different amount needs a note');
  const d = await as('cashier', 'POST', `/api/purchases/${p.id}/decide`, { approve: true, pin: PIN, method: 'cheque', chequeNo: '000123', returnedAmount: 40000 });
  assert.equal(d.status, 200, JSON.stringify(d.json));
  assert.equal(d.json.purchase.status, 'confirmed');
  assert.equal(d.json.purchase.balanceExpected, 40000); assert.equal(d.json.purchase.returnedAmount, 40000);
  assert.equal(d.json.purchase.actualAmount, 60000, 'the voucher has the real cost'); assert.equal(d.json.purchase.payMethod, 'cheque'); assert.equal(d.json.purchase.chequeNo, '000123');
  assert.ok(d.json.purchase.signs.settled && d.json.purchase.signs.checked);
  assert.equal(d.json.purchase.seal.status, 'valid');
});
