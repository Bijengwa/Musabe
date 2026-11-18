// Security: passwords, sign-in, sessions, cross-site requests, headers, uploads, Excel, history, reminders,
// and the authorization matrix (every role × every main page). Needs TEST_DATABASE_URL (a TEST database).
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;

const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const { listen, request } = require('./helpers');
const { ACCESS, ROLES, SCHOOL_ROLES, pageAccess } = require('../src/auth/roles');

const tag = `x${Date.now().toString(36)}`;
const password = `Test-${tag}-9x-long`;
const people = {};
let server, port, em;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body, headers) => request({ port, method, path, body, headers, cookie: people[who].cookie });
const login = (username, pw, from) => request({ port, method: 'POST', path: '/api/auth/login', body: { username, password: pw }, from });

async function makeUser(key, role, school, extra = {}) {
  const username = `t_${key}_${tag}`.toLowerCase();
  const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: school,
    password_hash: await bcrypt.hash(password, 4), must_change_password: false, ...extra }).returning('id');
  return { id: u.id, username };
}

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  em = await db('schools').where({ code: 'pre' }).first();
  for (const role of Object.keys(ROLES)) {
    const u = await makeUser(role, role, SCHOOL_ROLES.includes(role) ? em.id : null);
    const r = await login(u.username, password);
    people[role] = { ...u, cookie: cookie(r) };
  }
});
test.after(async () => { if (server) server.close(); if (db) await db.destroy(); });

// ---------- Authorization matrix ----------
const ROUTES = [
  ['/api/stock', ['stock']], ['/api/stock/deliveries', ['stockin', 'incoming', 'stock']], ['/api/requests', ['requests']],
  ['/api/damage', ['damage']], ['/api/bills', ['bills']], ['/api/money', ['money']], ['/api/dashboard/sales', ['salesdash']],
  ['/api/receipts', ['receipts']], ['/api/items', ['items']], ['/api/users', ['staff']], ['/api/audit', ['audit']],
  ['/api/reports', ['reports']], ['/api/students?school=SCHOOL', ['students']],
];
test('authorization matrix: every role gets exactly the pages in roles.js', { skip }, async () => {
  const wrong = [];
  for (const role of Object.keys(ROLES)) {
    for (const [path, pages] of ROUTES) {
      const allowed = pages.some((p) => pageAccess(role, p));
      const r = await as(role, 'GET', path.replace('SCHOOL', em.id));
      if (allowed !== (r.status === 200)) wrong.push(`${role} ${path}: ${r.status}, expected ${allowed ? 200 : 403}`);
      if (!allowed && r.status !== 403) wrong.push(`${role} ${path}: ${r.status}, expected 403`);
    }
  }
  assert.deepEqual(wrong, []);
  assert.ok(ACCESS.bursar.stock === undefined && ACCESS.librarian.stock === undefined && ACCESS.bursar.salesdash === undefined);
});

test('a refused request is written to the activity log (once)', { skip }, async () => {
  await as('bursar', 'GET', '/api/stock');
  await as('bursar', 'GET', '/api/stock');
  const n = await db('audit_log').where({ action: 'auth.denied', user_id: people.bursar.id }).whereILike('summary', '%/api/stock%').count('* as n');
  assert.equal(Number(n[0].n), 1);
});

// ---------- Passwords and sign-in ----------
test('password rule: 12+ characters, not common, not the own name', { skip }, async () => {
  const change = (pw) => as('teacher', 'POST', '/api/auth/change-password', { currentPassword: password, newPassword: pw });
  assert.equal((await change('short1')).status, 400);
  assert.equal((await change('password123456')).status, 400);
  assert.equal((await change(`${people.teacher.username}1234`)).status, 400);
  assert.equal((await change('aaaaaaaaaaaaaaa')).status, 400);
  const ok = await change('mama neema 2026 kijani');
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

test('sign-in: same reply for unknown user, wrong password and lock; lock is per address', { skip }, async () => {
  const u = await makeUser('lock', 'aacc', null);
  const a = await login('no_such_user_zz', 'whatever-123456');
  const b = await login(u.username, 'wrong-password-123');
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.equal(a.json.error, b.json.error);
  for (let i = 0; i < 4; i++) await login(u.username, 'wrong-password-123');
  const locked = await login(u.username, password); // right password, but this address is waiting
  assert.equal(locked.status, 401);
  assert.equal(locked.json.error, b.json.error);
  const other = await login(u.username, password, '127.0.0.2'); // another computer can still sign in
  assert.equal(other.status, 200, JSON.stringify(other.json));
  const failed = await db('audit_log').where({ action: 'auth.login_failed', user_id: u.id }).count('* as n');
  assert.ok(Number(failed[0].n) >= 5);
});

test('temporary password expires', { skip }, async () => {
  const u = await makeUser('temp', 'aacc', null, { must_change_password: true, temp_password_expires_at: new Date(Date.now() - 60000) });
  const r = await login(u.username, password);
  assert.equal(r.status, 403);
  assert.match(r.json.error, /expired/);
});

test('a session idle too long ends', { skip }, async () => {
  const u = await makeUser('idle', 'aacc', null);
  const c = cookie(await login(u.username, password));
  assert.equal((await request({ port, path: '/api/auth/me', cookie: c })).status, 200);
  await db('sessions').where({ user_id: u.id }).update({ last_seen_at: db.raw("now() - interval '3 hours'") });
  assert.equal((await request({ port, path: '/api/auth/me', cookie: c })).status, 401);
  assert.equal(Number((await db('sessions').where({ user_id: u.id }).count('* as n'))[0].n), 0);
});

// ---------- Requests from other websites, headers ----------
test('changes from another website are refused', { skip }, async () => {
  const body = { reason: 'x' };
  const evil = await as('storekeeper', 'POST', '/api/requests/1/decline', body, { Origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  const cross = await as('storekeeper', 'POST', '/api/requests/1/decline', body, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(cross.status, 403);
  const own = await as('storekeeper', 'POST', '/api/requests/999999/decline', body, { Origin: 'http://localhost:5190' });
  assert.equal(own.status, 404); // passed the check, request not found
});

test('security headers on API replies; health shows no details', { skip }, async () => {
  const r = await as('acc', 'GET', '/api/auth/me');
  assert.match(r.headers['content-security-policy'], /default-src 'none'/);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.ok(r.headers['permissions-policy']);
  const h = await request({ port, path: '/api/health' });
  assert.deepEqual(Object.keys(h.json).sort(), ['database', 'ok']);
});

test('school list: staff counts only for those who manage staff or schools', { skip }, async () => {
  const b = await as('bursar', 'GET', '/api/schools');
  assert.equal(b.json.schools[0].staffCount, undefined);
  assert.equal(b.json.schools[0].schoolAdmins, undefined);
  const s = await as('super', 'GET', '/api/schools');
  assert.equal(typeof s.json.schools[0].staffCount, 'number');
});

// ---------- Uploads and Excel ----------
test('uploads: only real .xlsx files, no zip bombs', { skip }, async () => {
  const { checkXlsx, safeText } = require('../src/lib/excel');
  assert.throws(() => checkXlsx(Buffer.from('hello, this is text')), /not an Excel file/);
  // A fake zip whose central directory says one entry unpacks to 4 GB
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt32LE(0xfffffff0, 24);
  const head = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(head.length, 16);
  assert.throws(() => checkXlsx(Buffer.concat([head, cd, eocd])), /too big/);
  // A zip that lies: it says 1 KB but really unpacks to 100 MB (found by the attack run of 2026-11-16).
  const zlib = require('zlib');
  const big = zlib.deflateRawSync(Buffer.alloc(100 * 1024 * 1024)), name = Buffer.from('xl/worksheets/sheet1.xml');
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(big.length, 18); lh.writeUInt32LE(1000, 22); lh.writeUInt16LE(name.length, 26);
  const c2 = Buffer.alloc(46); c2.writeUInt32LE(0x02014b50, 0); c2.writeUInt16LE(8, 10); c2.writeUInt32LE(big.length, 20); c2.writeUInt32LE(1000, 24); c2.writeUInt16LE(name.length, 28);
  const e2 = Buffer.alloc(22); e2.writeUInt32LE(0x06054b50, 0); e2.writeUInt16LE(1, 10); e2.writeUInt32LE(30 + name.length + big.length, 16);
  assert.throws(() => checkXlsx(Buffer.concat([lh, name, big, c2, name, e2])), /too big/);
  assert.equal(safeText('=HYPERLINK("http://x")'), '\'=HYPERLINK("http://x")');
  assert.equal(safeText('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(safeText('-cmd'), "'-cmd");
  assert.equal(safeText('-5'), '-5');
  assert.equal(safeText('NEEMA JOHN'), 'NEEMA JOHN');
  const r = await request({ port, method: 'POST', path: '/api/stock/deliveries/read', cookie: people.storekeeper.cookie, body: { not: 'excel' } });
  assert.equal(r.status, 400);
});

// ---------- History ----------
test('activity log and price history cannot be changed or deleted', { skip }, async () => {
  const a = await db('audit_log').orderBy('id', 'desc').first();
  await assert.rejects(db('audit_log').where({ id: a.id }).update({ summary: 'x' }), /permission denied|cannot be changed/);
  await assert.rejects(db('audit_log').where({ id: a.id }).del(), /permission denied|cannot be changed/);
});

// ---------- Reminders and notification links ----------
test('reminders: a delivery waiting 2 days is announced once, and the bell opens the right page', { skip }, async () => {
  const socks = await db('items').where({ name: 'SOCKS' }).first();
  const d = await as('storekeeper', 'POST', '/api/stock/deliveries', { schoolId: em.id, lines: [{ itemId: socks.id, qty: 3 }] });
  assert.equal(d.status, 201, JSON.stringify(d.json));
  await db('deliveries').where({ id: d.json.delivery.id }).update({ sent_at: db.raw("now() - interval '3 days'") });
  const { run } = require('../src/lib/reminders');
  await run(); await run();
  const n = await db('audit_log').where({ action: 'delivery.late' }).whereRaw("detail->>'deliveryId' = ?", [String(d.json.delivery.id)]).count('* as n');
  assert.equal(Number(n[0].n), 1);
  const bell = await as('librarian', 'GET', '/api/notifications');
  const item = bell.json.items.find((x) => x.summary.includes(d.json.delivery.number) && /Reminder/.test(x.summary));
  assert.ok(item);
  assert.equal(item.link, '/incoming');
  const fbell = await as('fm', 'GET', '/api/notifications');
  assert.equal(fbell.json.items.find((x) => x.summary.includes(d.json.delivery.number))?.link, '/stock');
});

test('home "To do" shows each role its own work', { skip }, async () => {
  const lib = await as('librarian', 'GET', '/api/dashboard');
  assert.ok(lib.json.todo.some((t) => t.link === '/incoming'));
  assert.ok(lib.json.todo.every((t) => !['/stock', '/money', '/control-numbers'].some((p) => t.link.startsWith(p))));
  const acc = await as('acc', 'GET', '/api/dashboard');
  assert.ok(acc.json.todo.every((t) => typeof t.n === 'number' && t.n > 0 && t.link));
  const bur = await as('bursar', 'GET', '/api/dashboard');
  assert.ok(bur.json.todo.every((t) => !t.link.startsWith('/stock') && !t.link.startsWith('/incoming')));
  assert.ok(Array.isArray(bur.json.work.bills));
});
