// Same S-02 regression checks, with Nginx at an explicit address (TRUST_PROXY=127.0.0.2).
// This runs on any machine: 127.0.0.2 plays Nginx, and 127.0.0.1 plays a public client that is NOT trusted.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TRUST_PROXY = '127.0.0.2';
const app = require('../src/server');
const { listen, request } = require('./helpers');

app.get('/__test/ip', (req, res) => res.json({ ip: req.ip }));

const NGINX = '127.0.0.2';
const CLIENT = '127.0.0.1';
const LOGIN_LIMIT = 30;
let server, port;
test.before(async () => { ({ server, port } = await listen(app)); });
test.after(() => server.close());

const canUse127002 = async () => {
  try { await request({ port, from: NGINX, path: '/__test/ip' }); return true; } catch { return false; }
};

test('an untrusted client cannot choose its IP with X-Forwarded-For', async () => {
  const r = await request({ port, from: CLIENT, path: '/__test/ip', headers: { 'X-Forwarded-For': '6.6.6.6' } });
  assert.equal(r.json.ip, CLIENT);
});

test('an untrusted client cannot get around the login rate limit with forged X-Forwarded-For values', async () => {
  for (let i = 1; i <= LOGIN_LIMIT; i++) {
    const r = await request({ port, from: CLIENT, method: 'POST', path: '/api/auth/login', body: {}, headers: { 'X-Forwarded-For': `198.51.100.${i}` } });
    assert.equal(r.status, 400, `try ${i} should reach the login check`);
  }
  const blocked = await request({ port, from: CLIENT, method: 'POST', path: '/api/auth/login', body: {}, headers: { 'X-Forwarded-For': '198.51.100.250' } });
  assert.equal(blocked.status, 429);
});

test('the configured proxy is believed, but only for the address it added', async (t) => {
  if (!(await canUse127002())) return t.skip('this machine cannot use 127.0.0.2');
  let r = await request({ port, from: NGINX, path: '/__test/ip', headers: { 'X-Forwarded-For': '6.6.6.6, 203.0.113.50' } });
  assert.equal(r.json.ip, '203.0.113.50');
  r = await request({ port, from: NGINX, path: '/__test/ip' });
  assert.equal(r.json.ip, NGINX, 'no header: the proxy itself');
  // Legitimate users behind the proxy still sign in: the limit is per real client, not per proxy.
  const ok = await request({ port, from: NGINX, method: 'POST', path: '/api/auth/login', body: {}, headers: { 'X-Forwarded-For': '203.0.113.51' } });
  assert.equal(ok.status, 400);
});
