// An account may be signed in on several devices at once (the "one device only" rule was removed 2026-11-18).
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;
const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const sms = require('../src/lib/sms');
const { listen, request } = require('./helpers');

const tag = `u${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
let server, port, username, userId;
const realSend = sms.send;
const savedMode = process.env.SESSION_CODE_MODE;
const login = () => request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });

test.before(async () => {
  if (!URL) return;
  delete process.env.SESSION_CODE_MODE;
  sms.send = async () => true;
  ({ server, port } = await listen(app));
  username = `inuse_${tag}`;
  [{ id: userId }] = await db('users').insert({ full_name: `Test ${tag}`, username, role: 'head', school_id: (await db('schools').first()).id, password_hash: await bcrypt.hash(password, 4), must_change_password: false, phone: '0712000002' }).returning('id');
});
test.after(async () => {
  sms.send = realSend;
  if (savedMode === undefined) delete process.env.SESSION_CODE_MODE; else process.env.SESSION_CODE_MODE = savedMode;
  if (server) server.close(); if (db) await db.destroy();
});

test('the same account can be signed in on two devices at once; neither is signed out', { skip }, async () => {
  const a = await login(); const b = await login();
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(b.json.needsCode, undefined, 'no SMS code, no "account in use" block');
  const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
  assert.equal((await request({ port, path: '/api/auth/me', cookie: cookie(a) })).status, 200, 'the first device is still signed in');
  assert.equal((await request({ port, path: '/api/auth/me', cookie: cookie(b) })).status, 200);
  assert.equal(Number((await db('sessions').where({ user_id: userId }).count('* as n'))[0].n), 2);
});
