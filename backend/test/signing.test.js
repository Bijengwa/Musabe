// Signing core: signature + PIN in My profile, PIN needed to sign, lockout, SMS code for big money, seal breaks when a number changes, QR check.
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;
process.env.SESSION_CODE_MODE = 'off';
const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const sms = require('../src/lib/sms');
const { listen, request } = require('./helpers');

const tag = `s${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const PIN = '2468';
const PNG = `data:image/png;base64,${'A'.repeat(1200)}`;
const P = {};
let server, port, lastSms = null;
const realSend = sms.send;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body, cookie: P[who].cookie });
const make = async (key, role, extra = {}) => {
  const username = `sg_${key}_${tag}`.toLowerCase();
  const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, password_hash: await bcrypt.hash(password, 4), must_change_password: false, phone: '0712000001', ...extra }).returning('id');
  const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
  P[key] = { id: u.id, cookie: cookie(r) };
};

test.before(async () => {
  if (!URL) return;
  sms.send = async (_to, text) => { lastSms = text; return true; };
  ({ server, port } = await listen(app));
  const pinHash = await bcrypt.hash(PIN, 4);
  for (const [k, r] of [['aacc', 'aacc'], ['fm', 'fm'], ['fm2', 'fm'], ['cashier', 'cashier']]) await make(k, r, { signature_image: PNG, signing_pin_hash: pinHash });
  await make('bare', 'aacc');   // no signature and no PIN yet
});
test.after(async () => { sms.send = realSend; if (server) server.close(); if (db) await db.destroy(); });

const voucher = (amount = 50000) => ({ payeeName: 'TEST PAYEE', purpose: 'Test payment', lines: [{ detail: 'Work done', amount }], pin: PIN });

test('profile: signature and PIN are set with the password; weak PINs refused', { skip }, async () => {
  assert.equal((await as('bare', 'POST', '/api/payments', voucher())).status, 403, 'cannot sign before setting up');
  assert.equal((await as('bare', 'PUT', '/api/me/signature', { image: PNG, password: 'wrong' })).status, 403);
  assert.equal((await as('bare', 'PUT', '/api/me/signature', { image: 'data:image/png;base64,AAAA', password })).status, 400);
  assert.equal((await as('bare', 'PUT', '/api/me/signature', { image: PNG, password })).status, 200);
  assert.equal((await as('bare', 'PUT', '/api/me/pin', { pin: '1234', password })).status, 400);
  assert.equal((await as('bare', 'PUT', '/api/me/pin', { pin: '0000', password })).status, 400);
  assert.equal((await as('bare', 'PUT', '/api/me/pin', { pin: '12', password })).status, 400);
  assert.equal((await as('bare', 'PUT', '/api/me/pin', { pin: '7391', password })).status, 200);
  const me = await as('bare', 'GET', '/api/me/profile');
  assert.equal(me.json.user.hasSignature, true);
  assert.equal(me.json.user.hasPin, true);
  assert.equal(me.json.user.signingPinHash, undefined);
  assert.equal((await as('bare', 'POST', '/api/payments', { ...voucher(), pin: '7391' })).status, 201);
});

test('wrong PIN is counted and locks signing after 5 tries', { skip }, async () => {
  await make('lock', 'aacc', { signature_image: PNG, signing_pin_hash: await bcrypt.hash(PIN, 4) });
  for (let i = 1; i <= 4; i++) assert.equal((await as('lock', 'POST', '/api/payments', { ...voucher(), pin: '9999' })).status, 403);
  const fifth = await as('lock', 'POST', '/api/payments', { ...voucher(), pin: '9999' });
  assert.equal(fifth.status, 403);
  assert.match(fifth.json.error, /locked/i);
  const right = await as('lock', 'POST', '/api/payments', voucher());
  assert.equal(right.status, 429, 'even the right PIN waits while locked');
});

test('seal breaks when a number is changed after signing; QR check says so', { skip }, async () => {
  const c = await as('aacc', 'POST', '/api/payments', voucher(80000));
  const v = c.json.payment;
  assert.equal(v.seal.status, 'valid');
  const q = (code) => request({ port, method: 'GET', path: `/api/verify/voucher/${v.id}?c=${code}` });
  let r = await q(v.seal.code);
  assert.equal(r.status, 200);
  assert.equal(r.json.genuine, true);
  assert.equal(r.json.number, v.number);
  assert.equal(JSON.stringify(r.json).includes('TEST PAYEE'), false, 'the public check does not show the payee');
  assert.equal((await q('AAAA-BBBB-CCCC')).json.genuine, false, 'a wrong code is not genuine');
  // Someone with database access changes the amount behind the system's back.
  await db('payment_lines').where({ payment_id: v.id }).update({ amount: 8000000 });
  await db('payment_requests').where({ id: v.id }).update({ amount: 8000000 });
  const d = await as('fm', 'GET', `/api/payments/${v.id}`);
  assert.equal(d.json.payment.seal.status, 'broken');
  assert.match(d.json.payment.seal.reason, /changed/);
  r = await q(v.seal.code);
  assert.equal(r.json.genuine, false);
});

test('a person cannot sign two steps of one voucher; big money needs an SMS code', { skip }, async () => {
  const big = await as('aacc', 'POST', '/api/payments', voucher(2500000));
  assert.equal(big.status, 201, JSON.stringify(big.json));
  const id = big.json.payment.id;
  lastSms = null;
  let r = await as('fm', 'POST', `/api/payments/${id}/authorize`, { approve: true, pin: PIN });
  assert.equal(r.status, 428);
  assert.equal(r.json.needSmsCode, true);
  assert.ok(lastSms, 'the code was sent by SMS');
  const code = /(\d{6})/.exec(lastSms)[1];
  r = await as('fm', 'POST', `/api/payments/${id}/authorize`, { approve: true, pin: PIN, smsCode: code === '000000' ? '111111' : '000000' });
  assert.equal(r.status, 403);
  r = await as('fm', 'POST', `/api/payments/${id}/authorize`, { approve: true, pin: PIN, smsCode: code });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.payment.status, 'pending');
  r = await as('fm', 'POST', `/api/payments/${id}/authorize`, { approve: true, pin: PIN, smsCode: code });
  assert.notEqual(r.status, 200, 'cannot authorize twice (the SMS code is used up)');
  const sigs = await db('signatures').where({ doc_type: 'voucher', doc_id: id }).orderBy('id');
  assert.deepEqual(sigs.map((s) => s.step), ['prepared', 'authorized']);
  assert.equal(sigs[1].prev_mac, sigs[0].mac, 'signatures are chained');
  await assert.rejects(() => db('signatures').where({ id: sigs[0].id }).update({ user_name: 'X' }), /cannot be changed/);
});
