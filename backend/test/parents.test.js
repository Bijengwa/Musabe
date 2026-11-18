// Parents' mobile app: sign-in by SMS code, a parent sees only their own children (any school),
// "my child is missing" requests answered by the School Admin of that school.
// Runs only when TEST_DATABASE_URL points to a TEST database that is migrated and seeded. Never point it at real data.
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

const tag = Date.now().toString(36);
const rnd = () => `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const phone = rnd(), other = rnd();
let server, port, schools, kids = [], stranger, adminCookie;
let lastCode = null;
let token = null; // from the first sign-in (only 3 codes per phone every 15 minutes)
const realSend = sms.send;

const app_ = (method, path, { body, token, lang = 'sw' } = {}) => request({ port, method, path, body,
  headers: { 'X-Lang': lang, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
async function signIn(p) {
  const s = await app_('POST', '/api/parent/auth/start', { body: { phone: p } });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const v = await app_('POST', '/api/parent/auth/verify', { body: { phone: p, code: lastCode, device: 'test' } });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  return v.json.token;
}

test.before(async () => {
  if (skip) return;
  sms.send = async (_to, text) => { lastCode = /(\d{6})/.exec(text)[1]; return true; };
  ({ server, port } = await listen(app));
  schools = await db('schools').orderBy('id').limit(2);
  // Children left by earlier runs would crowd the name search of this test: rename them.
  await db('students').where({ first_name: 'CHAUSIKU', last_name: 'TEST' }).update({ last_name: 'OLDRUN' });
  const add = async (school, adm, first, ph) => (await db('students').insert({ school_id: school.id, admission_no: `${adm}-${tag}`, first_name: first, last_name: 'TEST',
    full_name: `${first} TEST`, sex: 'F', parent_name: 'MAMA TEST', parent_phone: ph }).returning('id'))[0].id;
  kids = [await add(schools[0], 'P1', 'AMANI', phone), await add(schools[1], 'P2', 'BARAKA', phone)];
  stranger = await add(schools[1], 'P3', 'CHAUSIKU', other);
  const hash = await bcrypt.hash(`Pw-${tag}-long-9x`, 4);
  await db('users').insert({ full_name: 'TEST SCHOOL ADMIN', username: `sadmin_${tag}`, password_hash: hash, role: 'sadmin', school_id: schools[1].id, must_change_password: false });
  const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username: `sadmin_${tag}`, password: `Pw-${tag}-long-9x` } });
  adminCookie = r.headers['set-cookie'][0].split(';')[0];
});
test.after(async () => { sms.send = realSend; if (server) server.close(); if (db) await db.destroy(); });

test('a number not on any student record cannot get a code', { skip }, async () => {
  const r = await app_('POST', '/api/parent/auth/start', { body: { phone: '0600000001' }, lang: 'en' });
  assert.equal(r.status, 404);
  assert.match(r.json.error, /not written as a parent/);
});

test('the code works once; a wrong code is refused', { skip }, async () => {
  await app_('POST', '/api/parent/auth/start', { body: { phone } });
  const bad = await app_('POST', '/api/parent/auth/verify', { body: { phone, code: lastCode === '000000' ? '111111' : '000000' } });
  assert.equal(bad.status, 400);
  const ok = await app_('POST', '/api/parent/auth/verify', { body: { phone, code: lastCode } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.parent.fullName, 'MAMA TEST');
  token = ok.json.token;
  const again = await app_('POST', '/api/parent/auth/verify', { body: { phone, code: lastCode } });
  assert.equal(again.status, 400);
});

test('a parent sees their children in both schools, and nobody else', { skip }, async () => {
  const t = token;
  const me = await app_('GET', '/api/parent/me', { token: t });
  assert.deepEqual(me.json.children.map((c) => c.id).sort(), [...kids].sort());
  assert.equal(new Set(me.json.children.map((c) => c.school.id)).size, 2);
  assert.equal((await app_('GET', `/api/parent/children/${stranger}`, { token: t })).status, 404);
  assert.equal((await app_('GET', `/api/parent/children/${stranger}/receipts`, { token: t })).status, 404);
  assert.equal((await app_('GET', '/api/parent/me')).status, 401);
});

test('a missing child: request → School Admin links → parent sees the child', { skip }, async () => {
  const t = token;
  const r = await app_('POST', '/api/parent/requests', { token: t, body: { schoolId: schools[1].id, childName: 'chausiku test', relation: 'mother' } });
  assert.equal(r.status, 200);
  const list = await request({ port, method: 'GET', path: '/api/parent-requests', cookie: adminCookie });
  const mine = list.json.requests.find((x) => x.parentPhone === phone);
  assert.ok(mine.matches.some((m) => m.id === stranger));
  const l = await request({ port, method: 'POST', path: `/api/parent-requests/${mine.id}/link`, cookie: adminCookie, body: { studentId: stranger } });
  assert.equal(l.status, 200);
  assert.match(l.json.how, /second parent/);
  const me = await app_('GET', '/api/parent/me', { token: t });
  assert.ok(me.json.children.some((c) => c.id === stranger));
  // The first parent's phone on the record is not replaced.
  assert.equal((await db('students').where({ id: stranger }).first()).parent_phone, other);
});

test('signing out ends the token', { skip }, async () => {
  const t = await signIn(phone);
  assert.equal((await app_('POST', '/api/parent/auth/logout', { token: t })).status, 200);
  assert.equal((await app_('GET', '/api/parent/me', { token: t })).status, 401);
});
