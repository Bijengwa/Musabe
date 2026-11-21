// Store books (2026-11-20).
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

const tag = `b${Date.now().toString(36)}`;
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
    ['manager', 'manager', null], ['fm', 'fm', null], ['keeper', 'storekeeper', null], ['amanager', 'amanager', null], ['cashier', 'cashier', null], ['acc', 'acc', null], ['mapokezi', 'mapokezi', null]];
  for (const [key, role, school] of make) {
    const username = `${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: school, password_hash: await bcrypt.hash(password, 4), must_change_password: false,
      phone: '0712000000', signature_image: PNG, signing_pin_hash: await bcrypt.hash(PIN, 4) }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id, cookie: cookie(r) };
  }
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });



test('Store-keeper keeps a FOODS book: rice received, sent to the kitchen, used, corrected', { skip }, async () => {
  assert.equal((await as('acad', 'GET', '/api/store-books')).status, 403);
  assert.equal((await as('manager', 'POST', '/api/store-books', { name: 'Foods' })).status, 403, 'leaders only read');
  let r = await as('keeper', 'POST', '/api/store-books', { name: `Foods ${tag}` });
  assert.equal(r.status, 201, JSON.stringify(r.json)); const fid = r.json.folder.id;
  r = await as('keeper', 'POST', `/api/store-books/${fid}/items`, { name: 'Mchele', unit: 'kg', reorderLevel: 20 });
  assert.equal(r.status, 201); const iid = r.json.item.id;
  const line = (b) => as('keeper', 'POST', `/api/store-books/items/${iid}/lines`, b);
  assert.equal((await line({ kind: 'sent', qty: 10, place: 'Boys kitchen' })).status, 400, 'nothing in the store yet');
  assert.equal((await line({ kind: 'received', qty: 100, party: 'Mwanza Rice' })).status, 201);
  assert.equal((await line({ kind: 'sent', qty: 50, place: 'Boys kitchen' })).status, 201);
  assert.equal((await line({ kind: 'used', qty: 12.5, place: 'BOYS KITCHEN' })).status, 201);
  assert.equal((await line({ kind: 'used', qty: 60, place: 'Boys kitchen' })).status, 400, 'more than is there');
  assert.equal((await line({ kind: 'corrected', counted: 48, place: 'STORE' })).status, 400, 'a correction needs a note');
  assert.equal((await line({ kind: 'corrected', counted: 48, place: 'STORE', note: 'Two kg spoiled' })).status, 201);
  r = await as('manager', 'GET', `/api/store-books/items/${iid}`);
  assert.equal(r.status, 200); assert.equal(r.json.item.inStore, 48);
  assert.deepEqual(r.json.item.atPlaces, [{ place: 'BOYS KITCHEN', qty: 37.5 }]);
  assert.equal(r.json.lines[0].kind, 'corrected'); assert.equal(r.json.lines[0].qty, -2);
  r = await as('keeper', 'GET', `/api/store-books/${fid}`);
  assert.equal(r.json.items[0].received, 100); assert.equal(r.json.items[0].used, 12.5); assert.deepEqual(r.json.places, ['BOYS KITCHEN']);
  await assert.rejects(db('store_book_entries').where({ item_id: iid }).del(), /never changed/);
  await assert.rejects(db('store_book_entries').where({ item_id: iid }).update({ qty: 1 }), /never changed/);
  assert.equal((await as('keeper', 'GET', `/api/store-books/${fid}/export.xlsx`)).status, 200);
});
