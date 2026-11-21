// Help chat: the AI gets only the how-to notes of the person's own pages, never data. The AI call is faked here.
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;
process.env.ANTHROPIC_API_KEY = 'test-key';

const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const { listen, request } = require('./helpers');

const tag = `h${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const P = {};
let server, port;
const sent = [];
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.anthropic.com/')) {
    sent.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Fungua Order Book, kisha bonyeza New order.' }] }) };
  }
  return realFetch(url, opts);
};
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body, cookie: P[who].cookie });

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  const em = await db('schools').where({ code: 'pre' }).first();
  for (const [key, role, school] of [['keeper', 'storekeeper', null], ['bursar', 'bursar', em.id]]) {
    const username = `${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: school, password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id, cookie: cookie(r) };
  }
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });

test('Help chat: only the how-to of the person\'s own pages, no data', { skip }, async () => {
  assert.equal((await request({ port, method: 'POST', path: '/api/help/chat', body: { messages: [{ role: 'user', content: 'hi' }] } })).status, 401, 'signed in only');
  assert.equal((await as('keeper', 'POST', '/api/help/chat', { messages: [] })).status, 400);
  let r = await as('keeper', 'POST', '/api/help/chat', { messages: [{ role: 'user', content: 'Nani amelipa ada leo? Na nitaandikaje order?' }] });
  assert.equal(r.status, 200); assert.match(r.json.reply, /Order Book/);
  const k = sent.pop();
  assert.match(k.system, /Store-keeper/); assert.match(k.system, /Order Book/); assert.match(k.system, /NO access to any data/);
  assert.doesNotMatch(k.system, /Sell \(bursar\)/, 'no fees / selling pages for the store-keeper');
  assert.doesNotMatch(k.system, /Test bursar/, 'no names of other people');
  assert.equal(k.tools, undefined, 'the AI gets no tools');
  r = await as('bursar', 'POST', '/api/help/chat', { messages: [{ role: 'user', content: 'How do I sell?' }] });
  const b = sent.pop();
  assert.match(b.system, /Sell \(bursar\)/); assert.doesNotMatch(b.system, /Purchases & orders: the buyer/, 'no store-keeper pages for the bursar');
});
