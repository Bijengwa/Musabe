// Students: classes, Excel class lists (school's own layout), search, selling to a picked student,
// and notifications (each role only gets what concerns its work).
// Runs only when TEST_DATABASE_URL points to a TEST database that is migrated and seeded. Never point it at real data.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;

const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const { listen, request } = require('./helpers');

const tag = Date.now().toString(36);
const password = `Test-${tag}-9x`;
const people = {};
let server, port, em, boys, cls, cls2;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body, cookie: people[who].cookie });

// Upload raw bytes (the Excel file).
function upload(who, path, buf) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path, headers: { Cookie: people[who].cookie, 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length, 'X-File-Name': 'P.2.xlsx' } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(t || '{}') }));
    });
    req.on('error', reject); req.end(buf);
  });
}

// A class list laid out like the school's own files: a title row, the header on row 2, fee columns.
async function classFile(rows, { shifted = false } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('PRIMARY TWO');
  ws.addRow(['PRIMARY.TWO']);
  ws.addRow(['S/N', 'PREM NUMBER', 'ADMISSION NO.', "PUPIL'S FIRST NAME", "PUPIL'S MIDLE NAME", "PUPIL'S LAST NAME", 'SEX', 'PARENTS NAME', 'CONTACTS', 'DEPTS-2026', 'S/FEES', 'TOTAL']);
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    const sex = shifted ? (prev ? prev[5] : null) : r[5];
    const parent = shifted ? (prev ? prev[6] : null) : r[6];
    ws.addRow([i + 1, r[0], r[1], r[2], r[3], r[4], sex, parent, r[7], 0, 3011000, 3011000]);
  });
  ws.addRow(['.', ' ']);
  wb.addWorksheet('PRIMARY II RE-ADJUSTMENT 2026').addRow(['ignored']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const ADM = (n) => `${tag}${n}`.toUpperCase();
const P2 = () => [
  [20251821878, ADM(1), 'aaron', 'alberto', 'mgulunde', 'm', 'ALBERTO ALFRED MGULUNDE', '759426581'],     // lost 0 in phone
  [20253235252, ADM(2), 'ABIGAEL', 'ANTHONY', 'KASOTA', 'f', 'JUSTINA VICTUS MOSHA', '0768-279191'],
  [null, ADM(3), 'ALVIN', ' ', 'BENARD', 'm', 'JACKLINE PASTORY NUHI', 716399442],                       // no middle name
  [20253235262, ADM(4), 'ANDREW', 'JOHNSON', 'YOHANA', 'm', 'JOHNSON YOHANA MWAMBO', '0714-83523'],     // bad phone: warning only
];

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  em = await db('schools').where({ code: 'pre' }).first();
  boys = await db('schools').where({ code: 'boys' }).first();
  const make = [['sadmin', 'sadmin', em.id], ['bursar', 'bursar', em.id], ['bursar2', 'bursar', em.id], ['librarian', 'librarian', em.id],
    ['acad', 'acad', em.id], ['boysAdmin', 'sadmin', boys.id], ['boysBursar', 'bursar', boys.id], ['acc', 'acc', null], ['fm', 'fm', null]];
  for (const [key, role, school] of make) {
    const username = `s_${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key}`, username, role, school_id: school,
      password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    people[key] = { id: u.id, cookie: cookie(r) };
  }
});
test.after(async () => { if (server) server.close(); if (db) await db.destroy(); });

test('Academic Master makes classes from the built-in list with the school\'s own stream names', { skip }, async () => {
  assert.equal((await as('sadmin', 'POST', '/api/students/classes', { level: 'P2', streams: ['X'] })).status, 403); // School Admin only looks (2026-11-20)
  const a = await as('acad', 'POST', '/api/students/classes', { level: 'P2', streams: [`Blue${tag}`, `Green${tag}`] });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  [cls, cls2] = a.json.classes;
  assert.equal(cls.label, `P 2 BLUE${tag.toUpperCase()}`);
  assert.equal(cls.fullName, `PRIMARY TWO BLUE${tag.toUpperCase()}`);
  assert.equal((await as('acad', 'POST', '/api/students/classes', { level: 'P2', stream: `blue${tag}` })).status, 409); // same class and stream
  assert.equal((await as('acad', 'POST', '/api/students/classes', { level: 'F1' })).status, 400); // not a class of this school
  assert.equal((await as('bursar', 'POST', '/api/students/classes', { level: 'P3' })).status, 403);
});

let up1;
test('Excel in the school\'s own layout: columns found, phones cleaned, fees ignored', { skip }, async () => {
  const r = await upload('sadmin', `/api/students/imports?class=${cls.id}`, await classFile(P2()));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  up1 = r.json.id;
  const rev = await as('sadmin', 'GET', `/api/students/imports/${up1}`);
  const { summary, lines } = rev.json;
  assert.equal(summary.rows, 4);
  assert.equal(summary.new, 4);
  assert.equal(summary.errors, 0);
  assert.deepEqual(summary.otherSheets, ['PRIMARY II RE-ADJUSTMENT 2026']);
  assert.equal(lines[0].fullName, 'AARON ALBERTO MGULUNDE');
  assert.equal(lines[0].parentPhone, '0759426581');
  assert.equal(lines[1].parentPhone, '0768279191');
  assert.equal(lines[2].fullName, 'ALVIN BENARD');
  assert.equal(lines[3].parentPhone, null);
  assert.match(lines[3].warnings.join(' '), /not a correct mobile number/);
  const ok = await as('sadmin', 'POST', `/api/students/imports/${up1}/approve`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const list = await as('sadmin', 'GET', `/api/students?class=${cls.id}`);
  assert.equal(list.json.students.length, 4);
});

test('Uploading again: no change; a new phone updates; empty cells never erase', { skip }, async () => {
  const rows = P2();
  rows[1][7] = '0711 222 333';
  rows[2][6] = '';
  const r = await upload('sadmin', `/api/students/imports?class=${cls.id}`, await classFile(rows));
  const rev = await as('sadmin', 'GET', `/api/students/imports/${r.json.id}`);
  assert.equal(rev.json.summary.update, 1);
  assert.equal(rev.json.summary.same, 3);
  await as('sadmin', 'POST', `/api/students/imports/${r.json.id}/approve`);
  const alvin = (await as('sadmin', 'GET', `/api/students?q=alvin%20benard`)).json.students[0];
  assert.equal(alvin.parentName, 'JACKLINE PASTORY NUHI');
});

test('Mistakes block approval and show the row; shifted rows are warned', { skip }, async () => {
  const bad = P2().map((r, i) => (i === 1 ? [r[0], '', ...r.slice(2)] : i === 2 ? [...r.slice(0, 5), 'x', ...r.slice(6)] : r));
  bad.push([...P2()[0]]); // same admission number twice
  const r = await upload('sadmin', `/api/students/imports?class=${cls2.id}`, await classFile(bad));
  const rev = await as('sadmin', 'GET', `/api/students/imports/${r.json.id}`);
  assert.equal(rev.json.summary.errors, 3);
  assert.equal(rev.json.lines[1].row, 4);
  assert.match(rev.json.lines[1].errors[0], /Admission No/);
  assert.equal((await as('sadmin', 'POST', `/api/students/imports/${r.json.id}/approve`)).status, 400);
  await as('sadmin', 'POST', `/api/students/imports/${r.json.id}/discard`);

  const many = Array.from({ length: 6 }, (_, i) => [null, ADM(`S${i}`), `KID${'ABCDEF'[i]}`, `MID${'ABCDEF'[i]}`, `FAM${'ABCDEF'[i]}`, i % 2 ? 'f' : 'm', `MID${'ABCDEF'[i]} X FAM${'ABCDEF'[i]}`, '']);
  const s = await upload('sadmin', `/api/students/imports?class=${cls2.id}`, await classFile(many, { shifted: true }));
  const rs = await as('sadmin', 'GET', `/api/students/imports/${s.json.id}`);
  assert.ok(rs.json.summary.shifted >= 3, JSON.stringify(rs.json.summary));
  assert.ok(rs.json.summary.errors >= 1); // first row lost its sex
  assert.match((await as('sadmin', 'POST', `/api/students/imports/${s.json.id}/approve`)).json.error, /mistake|moved one row/);
  await as('sadmin', 'POST', `/api/students/imports/${s.json.id}/discard`);
});

test('Add, edit, move and mark as left; admission numbers stay unique', { skip }, async () => {
  const a = await as('sadmin', 'POST', '/api/students', { admissionNo: ADM(9), firstName: 'neema', middleName: 'john', lastName: 'masanja', sex: 'F', classId: cls.id, parentPhone: '0754 123 456' });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.equal(a.json.student.fullName, 'NEEMA JOHN MASANJA');
  assert.equal((await as('sadmin', 'POST', '/api/students', { admissionNo: ADM(9), firstName: 'x', lastName: 'y', sex: 'M', classId: cls.id })).status, 409);
  assert.equal((await as('sadmin', 'POST', '/api/students', { admissionNo: ADM(8), firstName: 'x', lastName: 'y', sex: 'M', classId: cls.id, parentPhone: '0714-83523' })).status, 400);
  const id = a.json.student.id;
  const e = await as('sadmin', 'PATCH', `/api/students/${id}`, { middleName: '', classId: cls2.id });
  assert.equal(e.json.student.fullName, 'NEEMA MASANJA');
  assert.equal(e.json.student.classId, cls2.id);
  assert.equal((await as('sadmin', 'PATCH', `/api/students/${id}`, { status: 'left' })).json.student.status, 'left');
  assert.equal((await as('sadmin', 'PATCH', `/api/students/${id}`, { status: 'active' })).json.student.status, 'active');
  // Other school cannot see or change it
  assert.equal((await as('boysAdmin', 'PATCH', `/api/students/${id}`, { firstName: 'X' })).status, 404);
  assert.equal((await as('bursar', 'PATCH', `/api/students/${id}`, { firstName: 'X' })).status, 403);
});

test('Bursar search: words in any order, admission number; own school only', { skip }, async () => {
  const s = await as('bursar', 'GET', `/api/students/search?q=${encodeURIComponent('mgulunde aar')}`);
  assert.equal(s.json.students[0].fullName, 'AARON ALBERTO MGULUNDE');
  const n = await as('bursar', 'GET', `/api/students/search?q=${ADM(2)}`);
  assert.equal(n.json.students[0].fullName, 'ABIGAEL ANTHONY KASOTA');
  const other = await as('boysBursar', 'GET', `/api/students/search?q=${encodeURIComponent('aaron alberto mgulunde')}`);
  assert.equal(other.json.students.length, 0);
});

test('Selling to a picked student: name, class and sex come from the list', { skip }, async () => {
  const st = (await as('bursar', 'GET', `/api/students/search?q=${ADM(2)}`)).json.students[0];
  const special = await db('items').where({ name: 'SPECIAL UNIFORM' }).first();
  const r = await as('bursar', 'POST', '/api/receipts', { studentId: st.id, studentName: 'wrong name', method: 'cash', lines: [{ itemId: special.id, qty: 1 }] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.receipt.studentName, 'ABIGAEL ANTHONY KASOTA');
  assert.equal(r.json.receipt.studentClass, cls.label);
  assert.equal(r.json.receipt.total, 41000); // girl's price
  assert.equal((await as('boysBursar', 'POST', '/api/receipts', { studentId: st.id, method: 'cash', lines: [{ itemId: special.id, qty: 1 }] })).status, 400);
});

test('Notifications: each role only what concerns it', { skip }, async () => {
  const bell = async (who) => (await as(who, 'GET', '/api/notifications')).json.items.map((x) => x.summary);
  const sweater = await db('items').where({ name: 'SWEATER' }).first();
  await as('bursar2', 'POST', '/api/receipts', { studentName: `Notif ${tag}`, studentClass: 'STD 1', method: 'cash', lines: [{ itemId: sweater.id, qty: 1 }] });
  const mine = `NOTIF ${tag.toUpperCase()}`;
  assert.ok((await bell('librarian')).some((t) => t.includes(mine)), 'librarian is told about a new receipt');
  assert.ok(!(await bell('bursar')).some((t) => t.includes(mine)), 'another bursar is not');
  assert.ok(!(await bell('acc')).some((t) => t.includes(mine)), 'accountant is not told about every sale');
  // A price change in English Medium: its bursar is told, Boys Secondary's bursar is not.
  const price = (await db('item_prices').where({ item_id: sweater.id, school_id: em.id }).first()).price;
  await as('fm', 'PATCH', `/api/items/${sweater.id}`, { prices: { [em.id]: { price: price + 1000 } } });
  await as('fm', 'PATCH', `/api/items/${sweater.id}`, { prices: { [em.id]: { price } } });
  assert.ok((await bell('bursar')).some((t) => /Price of SWEATER at English Medium/.test(t)));
  assert.ok(!(await bell('boysBursar')).some((t) => /SWEATER/.test(t)));
  // Students loaded: the bursar is not told; School Admin's own upload is not shown to herself.
  const loaded = (t) => t.startsWith('Loaded') && t.includes(tag.toUpperCase());
  assert.ok(!(await bell('bursar')).some(loaded));
  assert.ok(!(await bell('sadmin')).some(loaded));
});

test('Student page: details, receipts, history, previous / next in the class', { skip }, async () => {
  const list = (await as('sadmin', 'GET', `/api/students?class=${cls.id}`)).json.students;
  const abigael = list.find((x) => x.admissionNo === ADM(2));
  const p = await as('sadmin', 'GET', `/api/students/${abigael.id}`);
  assert.equal(p.status, 200);
  assert.equal(p.json.student.addedFrom.fileName, 'P.2.xlsx');
  assert.ok(p.json.receipts.some((r) => /SPECIAL UNIFORM/.test(r.items)));
  assert.equal(p.json.place.of, list.length);
  assert.equal(p.json.place.prev.full_name, 'AARON ALBERTO MGULUNDE');
  await as('sadmin', 'PATCH', `/api/students/${abigael.id}`, { note: 'Asthma inhaler in office' });
  const h = await as('sadmin', 'GET', `/api/students/${abigael.id}`);
  assert.ok(h.json.history.some((x) => /note/.test(x.summary)));
});

test('Move / promote many students; mark leavers', { skip }, async () => {
  const list = (await as('sadmin', 'GET', `/api/students?class=${cls.id}`)).json.students;
  const ids = list.slice(0, 2).map((x) => x.id);
  const m = await as('sadmin', 'POST', '/api/students/move', { ids, classId: cls2.id });
  assert.equal(m.status, 200, JSON.stringify(m.json));
  assert.equal((await as('sadmin', 'GET', `/api/students?class=${cls2.id}`)).json.students.filter((x) => ids.includes(x.id)).length, 2);
  const page = await as('sadmin', 'GET', `/api/students/${ids[0]}`);
  assert.ok(page.json.history.some((x) => /^Moved 2 students/.test(x.summary)));
  assert.equal((await as('sadmin', 'POST', '/api/students/move', { ids: [ids[0]], left: true })).status, 200);
  assert.equal((await as('sadmin', 'GET', `/api/students/${ids[0]}`)).json.student.status, 'left');
  assert.equal((await as('boysAdmin', 'POST', '/api/students/move', { ids, classId: cls.id })).status, 403);
  assert.equal((await as('bursar', 'POST', '/api/students/move', { ids, classId: cls.id })).status, 403);
});
