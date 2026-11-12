// Regression tests for audit finding S-02 (client IP spoofing through X-Forwarded-For).
// No database needed: the login rate limiter runs before the database is used, and an empty
// login form is rejected (400) before any query.
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.TRUST_PROXY; // test the default: only Nginx on the same server (loopback) is trusted
const app = require('../src/server');
const { parseTrustProxy } = require('../src/lib/proxy');
const { publicLikeAddress, listen, request } = require('./helpers');

// Shows the IP that Express resolved for a request (the same req.ip the rate limiter and audit log use).
app.get('/__test/ip', (req, res) => res.json({ ip: req.ip }));

const PUBLIC = publicLikeAddress();
const LOGIN_LIMIT = 30; // routes/auth.js loginLimit

let server, port;
test.before(async () => { ({ server, port } = await listen(app)); });
test.after(() => server.close());

test('TRUST_PROXY setting: safe default, and unsafe values refused', () => {
  assert.deepEqual(parseTrustProxy(undefined), ['loopback']);
  assert.deepEqual(parseTrustProxy(''), ['loopback']);
  assert.equal(parseTrustProxy('false'), false);
  assert.deepEqual(parseTrustProxy('10.0.0.5, 10.1.0.0/16'), ['10.0.0.5', '10.1.0.0/16']);
  for (const bad of ['true', '*', '1', '2', 'nginx', '10.0.0.0/99', '1.2.3']) {
    assert.throws(() => parseTrustProxy(bad), undefined, `"${bad}" must be refused`);
  }
});

test('a public client cannot choose its IP with a forged X-Forwarded-For', { skip: !PUBLIC && 'no non-loopback address on this machine' }, async () => {
  const r = await request({ port, host: PUBLIC, from: PUBLIC, path: '/__test/ip', headers: { 'X-Forwarded-For': '6.6.6.6' } });
  assert.equal(r.json.ip, PUBLIC, 'req.ip must be the real connection address, not the header');
});

test('a public client cannot get around the login rate limit with forged X-Forwarded-For values', { skip: !PUBLIC && 'no non-loopback address on this machine' }, async () => {
  for (let i = 1; i <= LOGIN_LIMIT; i++) {
    const r = await request({ port, host: PUBLIC, from: PUBLIC, method: 'POST', path: '/api/auth/login', body: {},
      headers: { 'X-Forwarded-For': `198.51.100.${i}` } });
    assert.equal(r.status, 400, `try ${i} should reach the login check`);
  }
  const blocked = await request({ port, host: PUBLIC, from: PUBLIC, method: 'POST', path: '/api/auth/login', body: {},
    headers: { 'X-Forwarded-For': '198.51.100.250' } });
  assert.equal(blocked.status, 429, 'a new fake IP must not reset the limit');
});

test('through Nginx (loopback), req.ip is the client address that Nginx added', async () => {
  // Nginx with  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;  appends the real address
  // after whatever the client sent. Only the right-most (added by Nginx) is believed.
  let r = await request({ port, path: '/__test/ip', headers: { 'X-Forwarded-For': '6.6.6.6, 203.0.113.9' } });
  assert.equal(r.json.ip, '203.0.113.9');
  // Nginx with  proxy_set_header X-Forwarded-For $remote_addr;
  r = await request({ port, path: '/__test/ip', headers: { 'X-Forwarded-For': '203.0.113.10' } });
  assert.equal(r.json.ip, '203.0.113.10');
});

test('through Nginx, a forged first X-Forwarded-For value does not reset the rate limit', async () => {
  for (let i = 1; i <= LOGIN_LIMIT; i++) {
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: {},
      headers: { 'X-Forwarded-For': `198.51.100.${i}, 203.0.113.20` } });
    assert.equal(r.status, 400, `try ${i} should reach the login check`);
  }
  const blocked = await request({ port, method: 'POST', path: '/api/auth/login', body: {},
    headers: { 'X-Forwarded-For': '198.51.100.251, 203.0.113.20' } });
  assert.equal(blocked.status, 429);
  // Another real client behind the same Nginx is not affected.
  const other = await request({ port, method: 'POST', path: '/api/auth/login', body: {}, headers: { 'X-Forwarded-For': '203.0.113.21' } });
  assert.equal(other.status, 400);
});
