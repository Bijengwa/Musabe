// One person, many roles; Patron and School Store-keeper orders (2026-11-20).
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

const tag = `r${Date.now().toString(36)}`;
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
    ['manager', 'manager', null], ['fm', 'fm', null], ['keeper', 'storekeeper', null], ['amanager', 'amanager', null], ['cashier', 'cashier', null], ['acc', 'acc', null], ['super', 'super', null]];
  for (const [key, role, school] of make) {
    const username = `${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: school, password_hash: await bcrypt.hash(password, 4), must_change_password: false,
      phone: '0712000000', signature_image: PNG, signing_pin_hash: await bcrypt.hash(PIN, 4) }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id, cookie: cookie(r) };
  }
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });


test('Super Admin gives the librarian the School Store-keeper role; blocked pairs are refused', { skip }, async () => {
  let r = await as('super', 'GET', `/api/users/${P.librarian.id}/roles`);
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.main.role, 'librarian');
  r = await as('super', 'POST', `/api/users/${P.librarian.id}/roles`, { role: 'sstore', schoolId: em.id });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal((await as('super', 'POST', `/api/users/${P.librarian.id}/roles`, { role: 'sstore', schoolId: em.id })).status, 409, 'already has it');
  assert.equal((await as('super', 'POST', `/api/users/${P.bursar.id}/roles`, { role: 'aacc' })).status, 409, 'bursar + Assistant Accountant is refused');
  assert.equal((await as('super', 'POST', `/api/users/${P.keeper.id}/roles`, { role: 'mapokezi' })).status, 409, 'buyer + Mapokezi is refused');
  assert.equal((await as('super', 'POST', `/api/users/${P.keeper.id}/roles`, { role: 'amanager' })).status, 201, 'two buyers is fine');
  const list = (await as('super', 'GET', '/api/users')).json.users.find((u) => u.id === P.librarian.id);
  assert.deepEqual(list.extraRoles.map((x) => x.role), ['sstore']);
});

test('The librarian switches to School Store-keeper: pages, orders and the activity log follow the role in use', { skip }, async () => {
  let r = await as('librarian', 'GET', '/api/auth/me');
  assert.equal(r.json.user.roles.length, 2); assert.equal(r.json.user.role, 'librarian');
  assert.equal((await as('librarian', 'POST', '/api/me/role', { role: 'manager' })).status, 403, 'not a role he holds');
  r = await as('librarian', 'POST', '/api/me/role', { role: 'sstore' });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.user.role, 'sstore');
  r = await as('librarian', 'GET', '/api/auth/me');
  assert.equal(r.json.user.role, 'sstore'); assert.equal(r.json.user.school.id, em.id);
  assert.equal((await as('librarian', 'GET', '/api/store/issues')).status, 403, 'library pages (scan out / return) are closed while working as School Store-keeper');
  assert.equal((await as('librarian', 'GET', '/api/stock/deliveries')).status, 200, 'since 2026-11-24 the School Store-keeper receives the school store lines of a delivery');
  r = await as('librarian', 'POST', '/api/orders', { lines: [{ qty: 30, unit: 'pcs', particulars: 'Brooms' }] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const o = r.json.order; assert.equal(o.place, 'store'); assert.equal(o.status, 'head'); assert.equal(o.writerRole, 'School Store-keeper');
  const log = await db('audit_log').where({ action: 'order.create_head', user_id: P.librarian.id }).orderBy('id', 'desc').first();
  assert.equal(log.role, 'sstore', 'the log keeps the role used');
  // School Store-keeper orders: Head Master, then straight to the buyers (no Manager step).
  r = await as('head', 'POST', `/api/orders/${o.id}/head`, { approve: true });
  assert.equal(r.json.order.status, 'keeper');
  assert.ok((await as('keeper', 'GET', '/api/dashboard')).json.todo.some((t) => /orders to buy for/.test(t.label)));
  // Back to the main role.
  r = await as('librarian', 'POST', '/api/me/role', { role: 'librarian' });
  assert.equal(r.json.user.role, 'librarian');
  assert.equal((await as('librarian', 'GET', '/api/stock/deliveries')).status, 200);
});

test('Removing the extra role puts every device back on the main role', { skip }, async () => {
  await as('librarian', 'POST', '/api/me/role', { role: 'sstore' });
  const x = (await as('super', 'GET', `/api/users/${P.librarian.id}/roles`)).json.extra[0];
  assert.equal((await as('super', 'POST', `/api/users/${P.librarian.id}/roles/${x.id}/remove`, {})).status, 200);
  const r = await as('librarian', 'GET', '/api/auth/me');
  assert.equal(r.json.user.role, 'librarian'); assert.equal(r.json.user.roles.length, 1);
  await assert.rejects(db('user_roles').where({ id: x.id }).del(), /./, 'never deleted');
});

test('Patron orders for the dormitory through the Head Master', { skip }, async () => {
  const [u] = await db('users').insert({ full_name: `Test patron ${tag}`, username: `patron_${tag}`.toLowerCase(), role: 'patron', school_id: em.id, password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
  const lr = await request({ port, method: 'POST', path: '/api/auth/login', body: { username: `patron_${tag}`.toLowerCase(), password } });
  P.patron = { id: u.id, cookie: cookie(lr) };
  const r = await as('patron', 'POST', '/api/orders', { lines: [{ qty: 40, unit: 'pcs', particulars: 'Bed sheets' }] });
  assert.equal(r.status, 201, JSON.stringify(r.json)); assert.equal(r.json.order.place, 'dormitory'); assert.equal(r.json.order.status, 'head');
});
