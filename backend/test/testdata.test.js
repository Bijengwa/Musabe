// The Excel test files in docs/test-data load cleanly: items for sale (Items & prices), items to issue, and the
// opening stock for each school (Send stock), confirmed by the librarian. Runs only on a TEST database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;
const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const { listen, request } = require('./helpers');

const DIR = path.join(__dirname, '..', '..', 'docs', 'test-data');
const tag = `d${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const people = {};
let server, port, schools;
const as = (who, method, p, body) => request({ port, method, path: p, body, cookie: people[who].cookie });
const upload = (who, p, file) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { Cookie: people[who].cookie, 'Content-Type': 'application/octet-stream' },
  body: fs.readFileSync(path.join(DIR, file)) }).then(async (r) => ({ status: r.status, json: await r.json() }));

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  schools = await db('schools').orderBy('id');
  const make = [['fm', 'fm', null], ['keeper', 'storekeeper', null], ...schools.map((s) => [`lib_${s.code}`, 'librarian', s.id])];
  for (const [key, role, school] of make) {
    const username = `t_${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: school, password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    people[key] = { id: u.id, cookie: (r.headers['set-cookie'] || [])[0]?.split(';')[0] };
  }
});
test.after(async () => { if (server) server.close(); if (db) await db.destroy(); });

test('test files: items for sale, items to issue, opening stock for the three schools', { skip }, async () => {
  const up = await upload('fm', '/api/items/imports', '1-items-for-sale-and-prices.xlsx');
  if (up.status === 201) {
    const ok = await as('fm', 'POST', `/api/items/imports/${up.json.id}/approve`, {});
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
  } else assert.match(up.json.error, /Nothing to change/); // loaded already by an earlier run

  const used = await upload('keeper', '/api/store/items/import', '2-items-to-issue.xlsx');
  assert.equal(used.status, 200, JSON.stringify(used.json));
  assert.equal(used.json.added + used.json.already, 22);
  assert.equal((await db('items').where({ name: 'MICROSCOPE' }).first()).returnable, true);

  for (const [code, file] of [['pre', '3a-opening-stock-english-medium.xlsx'], ['boys', '3b-opening-stock-boys-secondary.xlsx'], ['girls', '3c-opening-stock-girls-secondary.xlsx']]) {
    const school = schools.find((s) => s.code === code);
    const read = await upload('keeper', '/api/stock/deliveries/read', file);
    assert.equal(read.status, 200, JSON.stringify(read.json));
    assert.deepEqual(read.json.mistakes, []);
    const sent = await as('keeper', 'POST', '/api/stock/deliveries', { schoolId: school.id, note: 'Opening stock (test)', lines: read.json.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })) });
    assert.equal(sent.status, 201, JSON.stringify(sent.json));
    const labels = await as('keeper', 'GET', `/api/store/delivery-labels/${sent.json.delivery.id}`);
    assert.equal(labels.status, 200);
    assert.ok(labels.json.lines.some((l) => l.returnable && l.labels.length > 1), 'books and instruments get one QR per piece');
    const done = await as(`lib_${code}`, 'POST', `/api/stock/deliveries/${sent.json.delivery.id}/confirm-all`, {});
    assert.equal(done.status, 200, JSON.stringify(done.json));
    const rice = await db('items').where({ name: 'RICE' }).first();
    assert.ok((await db('stock_levels').where({ school_id: school.id, item_id: rice.id }).first()).qty >= 200);
  }
});
