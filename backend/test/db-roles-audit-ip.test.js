// Database tests: sign-in still works, the audit log and sessions store the resolved client IP,
// and the restricted runtime account cannot do more than it should.
// Runs only when TEST_DATABASE_URL points to a TEST database already migrated and set up with
// db/provision-roles.sql, connected as the runtime account (musabe_app). Never point it at real data:
// it adds a test account and sessions.
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;
// 127.0.0.2 plays Nginx; 127.0.0.1 plays a public client that is not trusted. Works on any machine.
process.env.TRUST_PROXY = '127.0.0.2';
const NGINX = '127.0.0.2';
const CLIENT = '127.0.0.1';

const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const { checkDbRole } = require('../src/db-role');
const { listen, request } = require('./helpers');

const username = `iptest_${Date.now()}`;
const password = `Test-${Math.random().toString(36).slice(2)}-9x`;
let server, port, userId;

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  const [row] = await db('users').insert({ full_name: 'IP Test Account', username, role: 'aacc', school_id: null,
    password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
  userId = row.id;
});
test.after(async () => { if (server) server.close(); if (db) await db.destroy(); });

const lastLogin = () => db('audit_log').where({ user_id: userId, action: 'auth.login' }).orderBy('id', 'desc').first();
const cookieOf = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];

test('runtime account is restricted (no superuser, owns nothing)', { skip }, async () => {
  const r = await checkDbRole({ production: true, conn: db }); // throws if the account is too powerful
  assert.equal(r.rolsuper, false);
  assert.equal(r.owned_tables, 0);
});

test('runtime account cannot change or delete audit history, or create tables', { skip }, async () => {
  await assert.rejects(db.raw('UPDATE audit_log SET summary = summary WHERE false'), /permission denied/);
  await assert.rejects(db.raw('DELETE FROM audit_log WHERE false'), /permission denied/);
  await assert.rejects(db.raw('DELETE FROM item_price_changes WHERE false'), /permission denied/);
  await assert.rejects(db.raw('CREATE TABLE should_not_exist (id int)'), /permission denied/);
  await assert.rejects(db.raw('SELECT * FROM knex_migrations'), /permission denied/);
});

test('sign-in works; wrong password refused', { skip }, async () => {
  const bad = await request({ port, from: NGINX, method: 'POST', path: '/api/auth/login', body: { username, password: 'wrong-password-1' }, headers: { 'X-Forwarded-For': '203.0.113.40' } });
  assert.equal(bad.status, 401);
  const ok = await request({ port, from: NGINX, method: 'POST', path: '/api/auth/login', body: { username, password }, headers: { 'X-Forwarded-For': '203.0.113.40' } });
  assert.equal(ok.status, 200);
  const me = await request({ port, from: NGINX, path: '/api/auth/me', cookie: cookieOf(ok) });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.username, username);
  await request({ port, from: NGINX, method: 'POST', path: '/api/auth/logout', cookie: cookieOf(ok) });
});

test('audit log and session record the real client IP, not a forged header (client not behind the proxy)', { skip }, async () => {
  const r = await request({ port, from: CLIENT, method: 'POST', path: '/api/auth/login',
    body: { username, password }, headers: { 'X-Forwarded-For': '6.6.6.6' } });
  assert.equal(r.status, 200);
  assert.equal((await lastLogin()).ip, CLIENT);
  const s = await db('sessions').where({ user_id: userId }).orderBy('created_at', 'desc').first();
  assert.equal(s.ip, CLIENT);
  await request({ port, from: CLIENT, method: 'POST', path: '/api/auth/logout', cookie: cookieOf(r) });
});

test('audit log records the address Nginx added, not the forged part (through Nginx)', { skip }, async () => {
  const r = await request({ port, from: NGINX, method: 'POST', path: '/api/auth/login',
    body: { username, password }, headers: { 'X-Forwarded-For': '6.6.6.6, 203.0.113.41' } });
  assert.equal(r.status, 200);
  assert.equal((await lastLogin()).ip, '203.0.113.41');
  await request({ port, from: NGINX, method: 'POST', path: '/api/auth/logout', cookie: cookieOf(r) });
});

test('normal operations still work with the restricted account', { skip }, async () => {
  const r = await request({ port, from: NGINX, method: 'POST', path: '/api/auth/login', body: { username, password }, headers: { 'X-Forwarded-For': '203.0.113.42' } });
  const cookie = cookieOf(r);
  for (const path of ['/api/schools', '/api/items', '/api/audit', '/api/notifications', '/api/me/profile', '/api/me/sessions']) {
    const g = await request({ port, path, cookie });
    assert.equal(g.status, 200, `${path} -> ${g.status} ${JSON.stringify(g.json)}`);
  }
  const p = await request({ port, from: NGINX, method: 'PUT', path: '/api/me/preferences', body: { theme: 'dark' }, cookie });
  assert.equal(p.status, 200);
  const seen = await request({ port, from: NGINX, method: 'POST', path: '/api/notifications/seen', cookie });
  assert.equal(seen.status, 200);
  const out = await request({ port, from: NGINX, method: 'POST', path: '/api/auth/logout', cookie });
  assert.equal(out.status, 200);
});
