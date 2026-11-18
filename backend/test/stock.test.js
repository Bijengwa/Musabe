// Stock, deliveries, requests, damaged / lost, control numbers, daily money, sales dashboard, reports.
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

const tag = `s${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const people = {};
let server, port, em, boys, socks, belt;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body, cookie: people[who].cookie });
const level = async (itemId, schoolId = em.id) => (await db('stock_levels').where({ school_id: schoolId, item_id: itemId }).first())?.qty || 0;

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  em = await db('schools').where({ code: 'pre' }).first();
  boys = await db('schools').where({ code: 'boys' }).first();
  socks = await db('items').where({ name: 'SOCKS' }).first();
  belt = await db('items').where({ name: 'BELT' }).first();
  const make = [['bursar', 'bursar', em.id], ['bursar2', 'bursar', em.id], ['librarian', 'librarian', em.id], ['boysLib', 'librarian', boys.id],
    ['head', 'head', em.id], ['acc', 'acc', null], ['aacc', 'aacc', null], ['fm', 'fm', null], ['afm', 'afm', null], ['director', 'director', null], ['keeper', 'storekeeper', null]];
  for (const [key, role, school] of make) {
    const username = `t_${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: school,
      password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    people[key] = { id: u.id, cookie: cookie(r) };
  }
});
test.after(async () => { if (server) server.close(); if (db) await db.destroy(); });

test('stock levels: only the finance and accountant offices (and leaders)', { skip }, async () => {
  for (const who of ['bursar', 'librarian', 'head']) assert.equal((await as(who, 'GET', '/api/stock')).status, 403, who);
  for (const who of ['acc', 'aacc', 'fm', 'afm', 'director']) assert.equal((await as(who, 'GET', '/api/stock')).status, 200, who);
  assert.equal((await as('aacc', 'PATCH', '/api/stock/reorder', { schoolId: em.id, itemId: socks.id, reorderLevel: 5 })).status, 403);
  assert.equal((await as('acc', 'PATCH', '/api/stock/reorder', { schoolId: em.id, itemId: socks.id, reorderLevel: 5 })).status, 200);
  const x = await request({ port, path: '/api/stock/export.xlsx', cookie: people.fm.cookie });
  assert.equal(x.status, 200);
});

let dlv;
test('send stock -> librarian confirms each line -> stock goes up', { skip }, async () => {
  const before = await level(socks.id);
  for (const who of ['librarian', 'acc', 'fm']) assert.equal((await as(who, 'POST', '/api/stock/deliveries', { schoolId: em.id, lines: [{ itemId: socks.id, qty: 5 }] })).status, 403, `${who} does not send stock`);
  // Boys Secondary does not sell SOCKS in the seed
  assert.equal((await as('keeper', 'POST', '/api/stock/deliveries', { schoolId: boys.id, lines: [{ itemId: socks.id, qty: 5 }] })).status, 400);
  const s = await as('keeper', 'POST', '/api/stock/deliveries', { schoolId: em.id, lines: [{ itemId: socks.id, qty: 20 }, { itemId: belt.id, qty: 10 }], note: 'Opening stock' });
  assert.equal(s.status, 201, JSON.stringify(s.json));
  dlv = s.json.delivery;
  assert.match(dlv.number, /^DLV\.\d{4,}$/);
  assert.equal(await level(socks.id), before); // nothing yet: on the way
  // other school's librarian cannot see or confirm it
  assert.equal((await as('boysLib', 'GET', `/api/stock/deliveries/${dlv.id}`)).status, 404);
  assert.equal((await as('boysLib', 'POST', `/api/stock/deliveries/${dlv.id}/confirm-all`)).status, 404);
  const sockLine = dlv.lines.find((l) => l.itemId === socks.id);
  // fewer than sent needs a note
  assert.equal((await as('librarian', 'POST', `/api/stock/deliveries/${dlv.id}/lines/${sockLine.id}/confirm`, { receivedQty: 18 })).status, 400);
  const c = await as('librarian', 'POST', `/api/stock/deliveries/${dlv.id}/lines/${sockLine.id}/confirm`, { receivedQty: 18, note: '2 missing' });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal(c.json.delivery.status, 'sent');
  assert.equal(await level(socks.id), before + 18);
  // cannot cancel after part is confirmed; cannot confirm the same line twice
  assert.equal((await as('keeper', 'POST', `/api/stock/deliveries/${dlv.id}/cancel`)).status, 409);
  assert.equal((await as('librarian', 'POST', `/api/stock/deliveries/${dlv.id}/lines/${sockLine.id}/confirm`, { receivedQty: 18, note: 'x' })).status, 409);
  const all = await as('librarian', 'POST', `/api/stock/deliveries/${dlv.id}/confirm-all`);
  assert.equal(all.json.delivery.status, 'received');
  assert.equal(all.json.delivery.short, 2);
  const card = await db('stock_moves').where({ school_id: em.id, item_id: socks.id }).orderBy('id', 'desc').first();
  assert.equal(card.balance, before + 18);
  assert.equal(card.ref, dlv.number);
  // finance is told it arrived short
  const bell = await as('fm', 'GET', '/api/notifications');
  assert.ok(bell.json.items.some((x) => x.summary.includes(dlv.number) && /less arrived/i.test(x.summary)));
  const lbell = await as('librarian', 'GET', '/api/notifications');
  assert.ok(lbell.json.items.some((x) => x.summary.startsWith(`Sent ${dlv.number}`)));
  // history can never be changed
  await assert.rejects(db('stock_moves').where({ id: card.id }).update({ change: 1 }), /cannot be changed|permission denied/);
});

test('giving takes items out of stock; not enough stock is refused', { skip }, async () => {
  const have = await level(socks.id);
  const r = await as('bursar', 'POST', '/api/receipts', { studentName: 'Stock Test', studentClass: 'STD 2', method: 'cash', lines: [{ itemId: socks.id, qty: have + 1 }] });
  assert.equal(r.status, 201);
  const line = r.json.receipt.lines[0];
  const no = await as('librarian', 'POST', `/api/receipts/${r.json.receipt.id}/give`, { lines: [{ lineId: line.id, qty: have + 1 }] });
  assert.equal(no.status, 409);
  assert.match(no.json.error, /only \d+ recorded/);
  assert.equal((await db('receipt_lines').where({ id: line.id }).first()).given_qty, 0); // nothing given
  const ok = await as('librarian', 'POST', `/api/receipts/${r.json.receipt.id}/give`, { lines: [{ lineId: line.id, qty: 3 }] });
  assert.equal(ok.status, 200);
  assert.equal(await level(socks.id), have - 3);
  const st = await as('acc', 'GET', `/api/stock?school=${em.id}&q=SOCKS`);
  const row = st.json.rows.find((x) => x.itemId === socks.id);
  assert.equal(row.qty, have - 3);
  assert.equal(row.owed >= have + 1 - 3, true);
});

test('damaged / lost: librarian reports, only FM or Accountant approves', { skip }, async () => {
  const have = await level(belt.id);
  assert.equal((await as('librarian', 'POST', '/api/damage', { itemId: belt.id, qty: have + 1, kind: 'lost', reason: 'missing after count' })).status, 409);
  assert.equal((await as('acc', 'POST', '/api/damage', { itemId: belt.id, qty: 1, kind: 'lost', reason: 'missing after count' })).status, 403);
  const r = await as('librarian', 'POST', '/api/damage', { itemId: belt.id, qty: 2, kind: 'damaged', reason: 'torn by rats in the store' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.damage.id;
  assert.equal(await level(belt.id), have); // not yet
  assert.equal((await as('afm', 'POST', `/api/damage/${id}/decide`, { approve: true })).status, 403);
  assert.equal((await as('aacc', 'POST', `/api/damage/${id}/decide`, { approve: true })).status, 403);
  assert.equal((await as('librarian', 'POST', `/api/damage/${id}/decide`, { approve: true })).status, 403);
  const ok = await as('acc', 'POST', `/api/damage/${id}/decide`, { approve: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.damage.status, 'approved');
  assert.equal(await level(belt.id), have - 2);
  assert.equal((await as('fm', 'POST', `/api/damage/${id}/decide`, { approve: false, note: 'x' })).status, 409);
  const r2 = await as('librarian', 'POST', '/api/damage', { itemId: belt.id, qty: 1, kind: 'lost', reason: 'not found at count' });
  assert.equal((await as('fm', 'POST', `/api/damage/${r2.json.damage.id}/decide`, { approve: false })).status, 400); // needs a reason
  assert.equal((await as('fm', 'POST', `/api/damage/${r2.json.damage.id}/decide`, { approve: false, note: 'found it' })).json.damage.status, 'rejected');
  assert.equal(await level(belt.id), have - 2);
});

test('stock requests: librarian asks, finance sends or declines', { skip }, async () => {
  assert.equal((await as('acc', 'POST', '/api/requests', { lines: [{ itemId: socks.id, qty: 5 }] })).status, 403);
  const r = await as('librarian', 'POST', '/api/requests', { lines: [{ itemId: socks.id, qty: 30 }], note: 'term opening' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const req = r.json.request;
  assert.match(req.number, /^REQ\./);
  const lib = await as('librarian', 'GET', '/api/requests');
  assert.equal(lib.json.requests.find((x) => x.id === req.id).lines[0].inStock, undefined); // the librarian does not see stock levels
  const fin = await as('fm', 'GET', '/api/requests');
  assert.equal(typeof fin.json.requests.find((x) => x.id === req.id).lines[0].inStock, 'number');
  const s = await as('keeper', 'POST', '/api/stock/deliveries', { schoolId: em.id, requestId: req.id, lines: [{ itemId: socks.id, qty: 30 }] });
  assert.equal(s.status, 201);
  const after = await as('librarian', 'GET', `/api/requests/${req.id}`);
  assert.equal(after.json.request.status, 'sent');
  assert.equal(after.json.request.lines[0].sent, 30);
  const r2 = await as('librarian', 'POST', '/api/requests', { lines: [{ itemId: belt.id, qty: 3 }] });
  assert.equal((await as('keeper', 'POST', `/api/requests/${r2.json.request.id}/decline`, {})).status, 400);
  assert.equal((await as('keeper', 'POST', `/api/requests/${r2.json.request.id}/decline`, { reason: 'none at the store' })).json.request.status, 'declined');
});

let bill;
test('control number: bursar makes it, payment writes the receipt', { skip }, async () => {
  const { validControl } = require('../src/routes/bills');
  assert.equal((await as('librarian', 'POST', '/api/bills', { studentName: 'X Y Z', studentClass: 'STD 1', lines: [{ itemId: socks.id, qty: 1 }] })).status, 403);
  const b = await as('bursar', 'POST', '/api/bills', { studentName: 'Control Test', studentClass: 'STD 3', payerPhone: '0754123456', lines: [{ itemId: socks.id, qty: 2 }] });
  assert.equal(b.status, 201, JSON.stringify(b.json));
  bill = b.json.bill;
  assert.match(bill.controlNo, /^88\d{10}$/);
  assert.ok(validControl(bill.controlNo));
  assert.equal(bill.status, 'pending');
  assert.equal(bill.total, 10000);
  const wrong = bill.controlNo.slice(0, 11) + ((Number(bill.controlNo[11]) + 1) % 10);
  assert.equal(validControl(wrong), false);
  const before = (await db('schools').where({ id: em.id }).first()).last_receipt_no;
  assert.equal((await as('acc', 'POST', `/api/bills/${bill.id}/paid`, { paidRef: 'FT26111' + tag, controlNo: wrong })).status, 400);
  assert.equal((await as('aacc', 'POST', `/api/bills/${bill.id}/paid`, { paidRef: 'FT26111' + tag })).status, 403);
  const paid = await as('acc', 'POST', `/api/bills/${bill.id}/paid`, { paidRef: 'FT26111' + tag, controlNo: bill.controlSpaced });
  assert.equal(paid.status, 200, JSON.stringify(paid.json));
  assert.equal(paid.json.bill.status, 'paid');
  assert.equal(paid.json.receipt.method, 'control');
  assert.equal(paid.json.receipt.no, before + 1);
  assert.equal(paid.json.receipt.total, 10000);
  assert.equal((await as('bursar', 'POST', `/api/bills/${bill.id}/paid`, { paidRef: 'AGAIN123' })).status, 409);
  assert.equal((await as('bursar', 'POST', `/api/bills/${bill.id}/cancel`, { reason: 'test' })).status, 409);
  await assert.rejects(db('bills').where({ id: bill.id }).update({ total: 1 }), /paid control number|permission denied/);
  // the library now sees it like any receipt
  const lib = await as('librarian', 'GET', `/api/receipts?q=${paid.json.receipt.number}`);
  assert.equal(lib.json.receipts[0].methodLabel, 'Control number');
  // Sell cannot write a "control" receipt directly
  assert.equal((await as('bursar', 'POST', '/api/receipts', { studentName: 'A B C', studentClass: 'STD 1', method: 'control', lines: [{ itemId: socks.id, qty: 1 }] })).status, 400);
});

test('control number: expired must be renewed; unpaid can be cancelled', { skip }, async () => {
  const b = await as('bursar', 'POST', '/api/bills', { studentName: 'Expiry Test', studentClass: 'STD 3', lines: [{ itemId: belt.id, qty: 1 }] });
  const id = b.json.bill.id;
  await db('bills').where({ id }).update({ expires_at: db.raw("now() - interval '1 day'") });
  assert.equal((await as('bursar', 'GET', `/api/bills/${id}`)).json.bill.status, 'expired');
  assert.equal((await as('acc', 'POST', `/api/bills/${id}/paid`, { paidRef: `EXP${tag}` })).status, 409);
  assert.equal((await as('acc', 'POST', `/api/bills/${id}/renew`)).status, 403);
  assert.equal((await as('bursar', 'POST', `/api/bills/${id}/renew`)).json.bill.status, 'pending');
  assert.equal((await as('bursar', 'POST', `/api/bills/${id}/cancel`, {})).status, 400);
  assert.equal((await as('bursar', 'POST', `/api/bills/${id}/cancel`, { reason: 'parent changed the items' })).json.bill.status, 'cancelled');
  const list = await as('acc', 'GET', '/api/bills?status=cancelled');
  assert.ok(list.json.bills.some((x) => x.id === id));
});

test('daily money: accountant checks each bursar once; bursar sees only own days', { skip }, async () => {
  await as('bursar2', 'POST', '/api/receipts', { studentName: 'Money Test', studentClass: 'STD 5', method: 'cash', lines: [{ itemId: belt.id, qty: 2 }] });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
  const list = await as('acc', 'GET', '/api/money');
  const row = list.json.rows.find((r) => r.bursarId === people.bursar2.id && r.day === today);
  assert.ok(row, JSON.stringify(list.json.rows.slice(0, 3)));
  assert.equal(row.cash, 10000);
  assert.equal((await as('aacc', 'POST', '/api/money/check', { bursarId: people.bursar2.id, day: today, cashCounted: 10000 })).status, 403);
  assert.equal((await as('acc', 'POST', '/api/money/check', { bursarId: people.bursar2.id, day: today, cashCounted: 9000 })).status, 400); // short needs a note
  const ok = await as('acc', 'POST', '/api/money/check', { bursarId: people.bursar2.id, day: today, cashCounted: 9000, note: '1,000 to follow tomorrow' });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal((await as('acc', 'POST', '/api/money/check', { bursarId: people.bursar2.id, day: today, cashCounted: 10000 })).status, 409);
  const mine = await as('bursar2', 'GET', '/api/money');
  assert.ok(mine.json.rows.every((r) => r.bursarId === people.bursar2.id));
  assert.equal(mine.json.rows.find((r) => r.day === today).check.result, 'short');
  const other = await as('bursar', 'GET', '/api/money');
  assert.ok(other.json.rows.every((r) => r.bursarId === people.bursar.id));
  // the bursar is told about their own day only
  assert.ok((await as('bursar2', 'GET', '/api/notifications')).json.items.some((x) => x.summary.includes('Money Test') || x.summary.includes('Cash counted')));
  assert.ok(!(await as('bursar', 'GET', '/api/notifications')).json.items.some((x) => x.summary.includes('Cash counted')));
});

test('sales dashboard: finance and accountant offices only, not bursars', { skip }, async () => {
  for (const who of ['bursar', 'librarian', 'head', 'boysLib']) assert.equal((await as(who, 'GET', '/api/dashboard/sales')).status, 403, who);
  for (const who of ['fm', 'afm', 'acc', 'aacc', 'director']) {
    const d = await as(who, 'GET', '/api/dashboard/sales');
    assert.equal(d.status, 200, who);
  }
  const d = await as('acc', 'GET', `/api/dashboard/sales?school=${em.id}`);
  assert.ok(d.json.kpi.money > 0);
  assert.ok(d.json.items.length > 0);
  assert.ok(d.json.kpi.methods.control >= 10000);
  const y = await as('fm', 'GET', '/api/dashboard/sales?from=2026-01-01&to=2026-12-31');
  assert.equal(y.json.groupedBy, 'month');
});

test('reports: each role gets only its own list', { skip }, async () => {
  const keys = async (who) => (await as(who, 'GET', '/api/reports')).json.reports.map((r) => r.key);
  const b = await keys('bursar');
  assert.ok(b.includes('sales-book') && b.includes('daily-money') && !b.includes('stock-levels'));
  const l = await keys('librarian');
  assert.ok(l.includes('deliveries') && l.includes('damage') && !l.includes('sales-book') && !l.includes('stock-levels'));
  const a = await keys('acc');
  assert.ok(['sales-book', 'stock-levels', 'stock-card', 'control-numbers'].every((k) => a.includes(k)));
  assert.equal((await request({ port, path: '/api/reports/stock-levels.xlsx', cookie: people.bursar.cookie })).status, 403);
  assert.equal((await request({ port, path: '/api/reports/sales-book.xlsx', cookie: people.librarian.cookie })).status, 403);
  assert.equal((await request({ port, path: '/api/reports/sales-book.xlsx', cookie: people.bursar.cookie })).status, 200);
  for (const k of a) {
    const r = await request({ port, path: `/api/reports/${k}.xlsx?from=2026-01-01`, cookie: people.acc.cookie });
    assert.equal(r.status, 200, k);
  }
});
