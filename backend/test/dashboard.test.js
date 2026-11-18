// Home pages: each role gets its own set of numbers, and school staff only their own school.
// Runs only when TEST_DATABASE_URL points to a TEST database that is migrated and seeded. Never point it at real data.
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;
const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const { listen, request } = require('./helpers');

const tag = Date.now().toString(36);
const password = `Test-${tag}-9x`;
let server, port;

test.before(async () => { if (URL) ({ server, port } = await listen(app)); });
test.after(async () => { if (server) server.close(); if (db) await db.destroy(); });

async function home(role, schoolCode) {
  const school = schoolCode ? (await db('schools').where({ code: schoolCode }).first()).id : null;
  const username = `d_${role}_${schoolCode || "admin"}_${tag}`;
  await db('users').insert({ full_name: `Dash ${role}`, username, role, school_id: school, password_hash: await bcrypt.hash(password, 4), must_change_password: false });
  const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
  const d = await request({ port, path: '/api/dashboard', cookie: (r.headers['set-cookie'] || [])[0]?.split(';')[0] });
  assert.equal(d.status, 200, JSON.stringify(d.json));
  return d.json;
}

test('each role gets its own home page data', { skip }, async () => {
  const keys = (d) => Object.keys(d).filter((k) => !['role', 'school', 'todo'].includes(k)).sort().join(',');
  assert.equal(keys(await home('director')), 'bySchool,open,sales,students,topItems,trend');
  assert.equal(keys(await home('manager')), 'bySchool,open,sales,topItems');
  assert.equal(keys(await home('fm')), 'bySchool,items,open,sales,stock,topItems,trend');
  assert.equal(keys(await home('acc')), 'bursars,open,sales,stock,trend');
  assert.equal(keys(await home('sadmin', 'pre')), 'pendingLists,students');
  assert.equal(keys(await home('head', 'pre')), 'library,open,sales,students,topItems,trend');
  assert.equal(keys(await home('bursar', 'pre')), 'open,recent,sales,work');
  assert.equal(keys(await home('librarian', 'pre')), 'library,open,work');
  assert.equal(keys(await home('teacher', 'pre')), 'students');
});

test('school staff see only their own school', { skip }, async () => {
  const boys = await db('schools').where({ code: 'boys' }).first();
  const lib = await home('librarian', 'boys');
  assert.equal(lib.school, boys.id);
  const others = await db('receipts').whereNot('school_id', boys.id).whereIn('status', ['waiting', 'part']).count('* as n');
  if (Number(others[0].n)) assert.ok(lib.open.oldest.every((r) => r.code === 'boys'));
  const bursar = await home('bursar', 'boys');
  assert.equal(bursar.sales.today.n, 0); // a new bursar has sold nothing: only their own sales count
});
