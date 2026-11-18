// Selling and giving: bursar writes a receipt, librarian gives the items, administration watches.
// Runs only when TEST_DATABASE_URL points to a TEST database that is migrated and seeded
// (it adds test accounts and receipts, and receipts can never be deleted). Never point it at real data.
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;
process.env.RECEIPT_LATE_HOURS = '24';

const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const { listen, request } = require('./helpers');

const tag = Date.now().toString(36);
const password = `Test-${tag}-9x`;
const people = {};
let server, port, em, boys, sweater, special;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body, cookie: people[who].cookie });

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  em = await db('schools').where({ code: 'pre' }).first();
  boys = await db('schools').where({ code: 'boys' }).first();
  sweater = await db('items').where({ name: 'SWEATER' }).first();
  special = await db('items').where({ name: 'SPECIAL UNIFORM' }).first();
  const make = [['bursar', 'bursar', em.id], ['librarian', 'librarian', em.id], ['boysLib', 'librarian', boys.id], ['boysBursar', 'bursar', boys.id], ['acc', 'acc', null]];
  for (const [key, role, school] of make) {
    const username = `t_${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key}`, username, role, school_id: school,
      password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    people[key] = { id: u.id, cookie: cookie(r) };
  }
  // Giving takes items out of stock (migration 012): make sure the library has sweaters.
  await db('stock_levels').insert({ school_id: em.id, item_id: sweater.id, qty: 1000 }).onConflict(['school_id', 'item_id']).merge({ qty: db.raw('stock_levels.qty + 1000') });
});
test.after(async () => { if (server) server.close(); if (db) await db.destroy(); });

const sale = (over = {}) => ({ studentName: 'Neema John', studentClass: 'Std 4', method: 'cash',
  lines: [{ itemId: sweater.id, qty: 2 }], ...over });

let first;
test('bursar writes a receipt; numbers follow each other without gaps', { skip }, async () => {
  const a = await as('bursar', 'POST', '/api/receipts', sale());
  assert.equal(a.status, 201, JSON.stringify(a.json));
  first = a.json.receipt;
  assert.equal(first.total, 42000);
  assert.equal(first.studentName, 'NEEMA JOHN');
  assert.match(first.number, /^REC\.\d{4,}$/);
  assert.equal(first.number, `REC.${String(first.no).padStart(4, '0')}`);
  assert.equal(first.status, 'waiting');
  const b = await as('bursar', 'POST', '/api/receipts', sale({ studentName: 'Juma Ali' }));
  assert.equal(b.json.receipt.no, first.no + 1);
});

test('mistakes are refused and do not use a number', { skip }, async () => {
  const before = (await db('schools').where({ id: em.id }).first()).last_receipt_no;
  assert.equal((await as('bursar', 'POST', '/api/receipts', sale({ lines: [] }))).status, 400);
  assert.equal((await as('bursar', 'POST', '/api/receipts', sale({ method: 'bank' }))).status, 400); // no slip number
  assert.equal((await as('bursar', 'POST', '/api/receipts', sale({ payerPhone: '12345' }))).status, 400);
  assert.equal((await as('bursar', 'POST', '/api/receipts', sale({ lines: [{ itemId: special.id, qty: 1 }] }))).status, 400); // boy or girl?
  assert.equal((await as('bursar', 'POST', '/api/receipts', sale({ expectTotal: 1 }))).status, 409); // price changed
  // Boys Secondary does not sell SWEATER in the seed (another test file may load a price list into the shared test database, so make sure)
  await db('item_prices').where({ school_id: boys.id, item_id: sweater.id }).del();
  assert.equal((await as('boysBursar', 'POST', '/api/receipts', sale())).status, 400);
  assert.equal((await db('schools').where({ id: em.id }).first()).last_receipt_no, before);
});

test('gender price is used', { skip }, async () => {
  const r = await as('bursar', 'POST', '/api/receipts', sale({ gender: 'girl', lines: [{ itemId: special.id, qty: 1 }] }));
  assert.equal(r.status, 201);
  assert.equal(r.json.receipt.total, 41000);
});

test('a double click returns the same receipt', { skip }, async () => {
  const key = `k-${tag}-abc`;
  const [a, b] = await Promise.all([as('bursar', 'POST', '/api/receipts', sale({ key })), as('bursar', 'POST', '/api/receipts', sale({ key }))]);
  assert.equal(a.json.receipt.id, b.json.receipt.id);
});

test('only the bursar sells; others cannot', { skip }, async () => {
  assert.equal((await as('librarian', 'POST', '/api/receipts', sale())).status, 403);
  assert.equal((await as('acc', 'POST', '/api/receipts', sale())).status, 403);
});

test('librarian gives in parts; cannot give more than paid', { skip }, async () => {
  const line = first.lines[0];
  const p = await as('librarian', 'POST', `/api/receipts/${first.id}/give`, { lines: [{ lineId: line.id, qty: 1 }], collectedBy: 'mama neema' });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  assert.equal(p.json.status, 'part');
  const over = await as('librarian', 'POST', `/api/receipts/${first.id}/give`, { lines: [{ lineId: line.id, qty: 2 }] });
  assert.equal(over.status, 409);
  const rest = await as('librarian', 'POST', `/api/receipts/${first.id}/give`, { lines: [{ lineId: line.id, qty: 1 }] });
  assert.equal(rest.json.status, 'given');
  assert.equal(rest.json.receipt.gives.length, 2);
  assert.equal(rest.json.receipt.gives[0].collectedBy, 'MAMA NEEMA');
  const again = await as('librarian', 'POST', `/api/receipts/${first.id}/give`, { lines: [{ lineId: line.id, qty: 1 }] });
  assert.equal(again.status, 409);
});

test('other schools cannot see or give a receipt; administration sees all', { skip }, async () => {
  assert.equal((await as('boysLib', 'GET', `/api/receipts/${first.id}`)).status, 404);
  assert.equal((await as('boysLib', 'POST', `/api/receipts/${first.id}/give`, { lines: [{ lineId: first.lines[0].id, qty: 1 }] })).status, 404);
  const list = await as('acc', 'GET', `/api/receipts?q=${first.number}`);
  assert.equal(list.json.receipts[0].id, first.id);
  assert.ok(list.json.today.money >= 42000);
  const x = await request({ port, path: '/api/receipts/export.xlsx', cookie: people.acc.cookie });
  assert.equal(x.status, 200);
});

test('nobody can change or delete a receipt, even in the database', { skip }, async () => {
  await assert.rejects(db('receipts').where({ id: first.id }).update({ total: 1 }), /cannot be changed/);
  await assert.rejects(db('receipts').where({ id: first.id }).del(), /never deleted|permission denied/); // no DELETE right, and the trigger behind it
  await assert.rejects(db('receipt_lines').where({ receipt_id: first.id }).update({ unit_price: 1 }), /cannot be changed/);
  await assert.rejects(db('receipt_lines').where({ receipt_id: first.id }).update({ given_qty: 0 }), /taken back/);
});

test('a receipt waiting too long is announced once', { skip }, async () => {
  const r = await as('bursar', 'POST', '/api/receipts', sale({ studentName: 'Late Case' }));
  const { alertLate } = require('../src/routes/receipts');
  await alertLate(0); // 0 hours: everything still open counts as late
  await alertLate(0);
  const n = await db('audit_log').where({ action: 'receipt.late' }).whereRaw("detail->>'receiptId' = ?", [String(r.json.receipt.id)]).count('* as n');
  assert.equal(Number(n[0].n), 1);
  const bell = await as('librarian', 'GET', '/api/notifications');
  assert.ok(bell.json.items.some((x) => /^Late: /.test(x.summary)));
});

test('Receipt book: next number set by Super Admin can only go up; printed header per school', { skip }, async () => {
  const bcrypt = require('bcryptjs');
  const username = `t_super_${tag}`.toLowerCase();
  await db('users').insert({ full_name: 'Test super', username, role: 'super', school_id: null, password_hash: await bcrypt.hash(password, 4), must_change_password: false });
  const login = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
  people.super = { cookie: cookie(login) };
  const s = (await db('schools').where({ id: em.id }).first());
  assert.equal((await as('super', 'PATCH', `/api/schools/${em.id}`, { nextReceiptNo: s.last_receipt_no })).status, 409); // already used
  const next = s.last_receipt_no + 100;
  const ok = await as('super', 'PATCH', `/api/schools/${em.id}`, { nextReceiptNo: next, receiptSigner: 'accountant musabe medium' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.school.nextReceipt, `REC.${String(next).padStart(4, '0')}`);
  const r = await as('bursar', 'POST', '/api/receipts', sale({ studentName: 'Book Number' }));
  assert.equal(r.json.receipt.no, next);
  assert.equal(r.json.receipt.school.receiptSigner, 'ACCOUNTANT MUSABE MEDIUM');
  assert.ok(r.json.receipt.school.receiptTitle.startsWith('MUSABE'));
  const found = await as('librarian', 'GET', `/api/receipts?q=${encodeURIComponent(r.json.receipt.number)}`);
  assert.equal(found.json.receipts[0].id, r.json.receipt.id);
});
