// Money back and closing by itself (2026-11-20).
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

const tag = `m${Date.now().toString(36)}`;
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
    ['manager', 'manager', null], ['fm', 'fm', null], ['keeper', 'storekeeper', null], ['amanager', 'amanager', null], ['cashier', 'cashier', null], ['acc', 'acc', null], ['aacc', 'aacc', null], ['mapokezi', 'mapokezi', null]];
  for (const [key, role, school] of make) {
    const username = `${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: school, password_hash: await bcrypt.hash(password, 4), must_change_password: false,
      phone: '0712000000', signature_image: PNG, signing_pin_hash: await bcrypt.hash(PIN, 4) }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id, cookie: cookie(r) };
  }
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });


const PNGP = `data:image/png;base64,${'A'.repeat(1200)}`;
async function paidRequisition(lines) {
  const [item] = await db('items').insert({ name: `BAGS ${tag} ${Math.random().toString(36).slice(2, 6)}`.toUpperCase(), unit: 'pc', category: 'stationery', active: true, sellable: false }).returning('*');
  let r = await as('acad', 'POST', '/api/orders', { lines: [{ qty: 20, unit: 'pcs', particulars: 'Bags' }] });
  const o = r.json.order;
  r = await as('keeper', 'POST', '/api/requisitions', { schoolId: em.id, orderId: o.id, lines });
  const q = r.json.requisition;
  await as('aacc', 'POST', `/api/requisitions/${q.id}/check`, { approve: true });
  r = await as('manager', 'POST', `/api/requisitions/${q.id}/manager`, { approve: true });
  const mid = r.json.requisition.money.id;
  assert.equal((await as('cashier', 'POST', `/api/payments/${mid}/decide`, { approve: true, payeeName: 'KEEPER', payeeImage: PNGP })).status, 200);
  return { q, o, item };
}

test('Spent exactly the office money: Mapokezi accepts and it closes by itself (no Cashier step)', { skip }, async () => {
  const { q, o, item } = await paidRequisition([{ name: 'Bags', qty: 20, estCost: 1000 }]);
  let r = await as('keeper', 'POST', '/api/purchases', { requisitionId: q.id, supplier: 'Nyanza', lines: [{ itemId: item.id, qty: 20, unitCost: 1000 }] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  r = await as('mapokezi', 'POST', `/api/purchases/${r.json.purchase.id}/check`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.purchase.status, 'confirmed', 'nothing to give back: closed when Mapokezi accepted');
  assert.equal((await as('keeper', 'POST', `/api/purchases/${r.json.purchase.id}/send`, {})).status, 200, 'the store-keeper sends it');
  r = await as('keeper', 'GET', `/api/requisitions/${q.id}`);
  assert.equal(r.json.requisition.status, 'sent'); assert.ok(r.json.requisition.delivery);
  assert.equal((await as('acad', 'GET', `/api/orders/${o.id}`)).json.order.statusLabel, 'Sent to the school');
});

test('Mapokezi rejects: buyer goes back to the market, then the Cashier still takes money back when some is left', { skip }, async () => {
  const { q, item } = await paidRequisition([{ name: 'Bags', qty: 20, estCost: 1000 }]);
  let r = await as('keeper', 'POST', '/api/purchases', { requisitionId: q.id, supplier: 'Shop A', lines: [{ itemId: item.id, qty: 20, unitCost: 1000 }] });
  assert.equal((await as('mapokezi', 'POST', `/api/purchases/${r.json.purchase.id}/decide`, { approve: false, note: 'Torn bags' })).status, 200);
  r = await as('keeper', 'GET', `/api/requisitions/${q.id}`);
  assert.equal(r.json.requisition.status, 'approved'); assert.equal(r.json.requisition.canBuyAgain, true); assert.equal(r.json.requisition.canAskMoneyBack, true);
  assert.match(r.json.requisition.statusLabel, /rejected: buy again or return the money/);
  r = await as('keeper', 'POST', '/api/purchases', { requisitionId: q.id, supplier: 'Shop B', lines: [{ itemId: item.id, qty: 20, unitCost: 900 }] });
  const pid = r.json.purchase.id;
  r = await as('mapokezi', 'POST', `/api/purchases/${pid}/check`, {});
  assert.equal(r.json.purchase.status, 'checked', '2,000 left: the Cashier takes it back');
  r = await as('keeper', 'GET', `/api/requisitions/${q.id}`);
  assert.equal(r.json.requisition.canAskMoneyBack, false, 'something is being bought now');
  r = await as('cashier', 'POST', `/api/purchases/${pid}/decide`, { approve: true, returnedAmount: 2000 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
});

test('Mapokezi rejects: buyer gives the money back, the Cashier receives it, the requisition and the order close', { skip }, async () => {
  const { q, o, item } = await paidRequisition([{ name: 'Bags', qty: 10, estCost: 5000 }]);
  let r = await as('keeper', 'POST', '/api/purchases', { requisitionId: q.id, supplier: 'Shop A', lines: [{ itemId: item.id, qty: 10, unitCost: 5000 }] });
  await as('mapokezi', 'POST', `/api/purchases/${r.json.purchase.id}/decide`, { approve: false, note: 'Wrong bags' });
  assert.equal((await as('cashier', 'POST', `/api/requisitions/${q.id}/money-back/ask`, {})).status, 409, 'only the buyer says it');
  r = await as('keeper', 'POST', `/api/requisitions/${q.id}/money-back/ask`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.ok(r.json.requisition.moneyBackAsked);
  assert.ok((await as('cashier', 'GET', '/api/dashboard')).json.todo.some((t) => /money back/.test(t.label)));
  assert.equal((await as('keeper', 'POST', `/api/requisitions/${q.id}/money-back`, { amount: 50000 })).status, 403);
  assert.equal((await as('cashier', 'POST', `/api/requisitions/${q.id}/money-back`, { amount: 40000 })).status, 400, 'a different amount needs a note');
  r = await as('cashier', 'POST', `/api/requisitions/${q.id}/money-back`, { amount: 50000 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.requisition.status, 'closed'); assert.equal(r.json.requisition.moneyBack.amount, 50000);
  assert.equal((await as('cashier', 'POST', `/api/requisitions/${q.id}/money-back`, { amount: 50000 })).status, 409);
  await assert.rejects(db('requisitions').where({ id: q.id }).update({ status: 'approved' }), /finished/);
  assert.equal((await as('acad', 'GET', `/api/orders/${o.id}`)).json.order.statusLabel, 'Not bought: the money was given back');
});

test('Store-keeper and Assistant Manager go to the market together: both sign before Mapokezi checks', { skip }, async () => {
  const { q, item } = await paidRequisition([{ name: 'Bags', qty: 4, estCost: 1000 }]);
  const list = (await as('keeper', 'GET', '/api/purchases/buyers/list')).json.buyers;
  assert.ok(list.some((b) => b.id === P.amanager.id)); assert.ok(!list.some((b) => b.id === P.keeper.id), 'not himself');
  assert.equal((await as('keeper', 'POST', '/api/purchases', { requisitionId: q.id, supplier: 'Shop', wentWith: P.cashier.id, lines: [{ itemId: item.id, qty: 4, unitCost: 1000 }] })).status, 400);
  let r = await as('keeper', 'POST', '/api/purchases', { requisitionId: q.id, supplier: 'Shop', wentWith: P.amanager.id, lines: [{ itemId: item.id, qty: 4, unitCost: 1000 }] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const pid = r.json.purchase.id; assert.equal(r.json.purchase.wentWith.id, P.amanager.id);
  assert.equal((await as('mapokezi', 'POST', `/api/purchases/${pid}/check`, {})).status, 409, 'waits for the second signature');
  assert.ok((await as('amanager', 'GET', '/api/dashboard')).json.todo.some((t) => /you went to the market too/.test(t.label)));
  assert.equal((await as('keeper', 'POST', `/api/purchases/${pid}/went-with`, {})).status, 404);
  r = await as('amanager', 'POST', `/api/purchases/${pid}/went-with`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.ok(r.json.purchase.signs.wentWith);
  r = await as('mapokezi', 'POST', `/api/purchases/${pid}/check`, {});
  assert.equal(r.status, 200); assert.equal(r.json.purchase.status, 'confirmed', 'spent exactly: closes by itself');
});
