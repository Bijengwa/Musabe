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
  [20251821878, ADM(1), 'aaron', 'alberto', 'mgulunde', 'm', 'DANIEL MUSABE DAMIAN', '079 530 9020'],
  [20253235252, ADM(2), 'ABIGAEL', 'ANTHONY', 'KASOTA', 'f', 'DANIEL MUSABE DAMIAN', '0768279191'],
  [null, ADM(3), 'ALVIN', ' ', 'BENARD', 'm', 'DANIEL MUSABE DAMIAN', '0716399442'],
  [20253235262, ADM(4), 'ANDREW', 'JOHNSON', 'YOHANA', 'm', 'JACKLINE PASTORY NUHI', '0784 000 111']
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
  // The old "PARENTS NAME" + "CONTACTS" columns are read as one guardian.
  assert.deepEqual(lines[0].guardians, [{ fullName: 'DANIEL MUSABE DAMIAN', phone: '0795309020', relationship: 'guardian', relationshipLabel: 'Guardian' }]);
  assert.equal(lines[1].guardians[0].phone, '0768279191');
  assert.equal(lines[2].fullName, 'ALVIN BENARD');
  assert.equal(lines[2].guardians[0].phone, '0716399442');
  assert.equal(lines[3].guardians[0].phone, '0784000111');
  assert.equal(summary.shifted, 0);
  const ok = await as('sadmin', 'POST', `/api/students/imports/${up1}/approve`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const list = await as('sadmin', 'GET', `/api/students?class=${cls.id}`);
  assert.equal(list.json.students.length, 4);
});

test('Uploading again: no change; a new phone updates; empty cells never erase', { skip }, async () => {
  const rows = P2();
  rows[1][7] = '0711 222 333';
  rows[2][6] = ''; rows[2][7] = ''; // no guardian written: the saved guardians stay
  const r = await upload('sadmin', `/api/students/imports?class=${cls.id}`, await classFile(rows));
  const rev = await as('sadmin', 'GET', `/api/students/imports/${r.json.id}`);
  assert.equal(rev.json.summary.update, 1);
  assert.equal(rev.json.summary.same, 3);
  await as('sadmin', 'POST', `/api/students/imports/${r.json.id}/approve`);
  const alvin = (await as('sadmin', 'GET', `/api/students?q=${ADM(3)}`)).json.students[0];
  assert.equal(alvin.guardians[0].fullName, 'DANIEL MUSABE DAMIAN');
  const abigael = (await as('sadmin', 'GET', `/api/students?q=${ADM(2)}`)).json.students[0];
  assert.equal(abigael.guardians.length, 1);
  assert.equal(abigael.guardians[0].phone, '0711222333');
  // Search by a guardian's phone finds the children.
  const byPhone = (await as('sadmin', 'GET', '/api/students?q=0711222333')).json.students;
  assert.ok(byPhone.some((x) => x.admissionNo === ADM(2)));
});

test('Mistakes block approval and show the row; shifted rows are warned', { skip }, async () => {
  const bad = P2().map((r, i) => (i === 1 ? [r[0], '', ...r.slice(2)] : i === 2 ? [...r.slice(0, 5), 'x', ...r.slice(6)] : r));
  bad.push([...P2()[0]]); // same admission number twice
  bad.push([null, ADM('T1'), 'TITLE', '', 'NAME', 'f', 'Mr John', '0755 000 001']); // a title, not names
  bad.push([null, ADM('T2'), 'ONE', '', 'NAME', 'f', 'GRACE', '0755 000 002']); // one name only
  bad.push([null, ADM('T3'), 'BAD', '', 'PHONE', 'f', 'GRACE TIBAIJUKA', '079530902']); // phone too short
  bad.push([null, ADM('T4'), 'NO', '', 'GUARDIAN', 'f', '', '']); // a new student needs a guardian
  const r = await upload('sadmin', `/api/students/imports?class=${cls2.id}`, await classFile(bad));
  const rev = await as('sadmin', 'GET', `/api/students/imports/${r.json.id}`);
  assert.equal(rev.json.summary.errors, 7, JSON.stringify(rev.json.lines.map((l) => l.errors)));
  const err = (adm) => rev.json.lines.find((l) => l.admissionNo === ADM(adm)).errors.join(' ');
  assert.match(err('T1'), /starts with a title/);
  assert.match(err('T2'), /at least two names/);
  assert.match(err('T3'), /not a correct mobile number/);
  assert.match(err('T4'), /at least one guardian/);
  assert.equal(rev.json.lines[1].row, 4);
  assert.match(rev.json.lines[1].errors[0], /Admission No/);
  assert.equal((await as('sadmin', 'POST', `/api/students/imports/${r.json.id}/approve`)).status, 400);
  await as('sadmin', 'POST', `/api/students/imports/${r.json.id}/discard`);

  const many = Array.from({ length: 6 }, (_, i) => [null, ADM(`S${i}`), `KID${'ABCDEF'[i]}`, `MID${'ABCDEF'[i]}`, `FAM${'ABCDEF'[i]}`, i % 2 ? 'f' : 'm', `MID${'ABCDEF'[i]} X FAM${'ABCDEF'[i]}`, `07550001${i}0`]);
  const s = await upload('sadmin', `/api/students/imports?class=${cls2.id}`, await classFile(many, { shifted: true }));
  const rs = await as('sadmin', 'GET', `/api/students/imports/${s.json.id}`);
  assert.ok(rs.json.summary.shifted >= 3, JSON.stringify(rs.json.summary));
  assert.ok(rs.json.summary.errors >= 1); // first row lost its sex
  assert.match((await as('sadmin', 'POST', `/api/students/imports/${s.json.id}/approve`)).json.error, /mistake|moved one row/);
  await as('sadmin', 'POST', `/api/students/imports/${s.json.id}/discard`);
});

test('Guardians: any number, real names, verify, edit keeps the verified mark', { skip }, async () => {
  const six = ['father', 'mother', 'brother', 'grandmother', 'uncle', 'aunt'].map((relationship, i) => ({ fullName: `guardian${i} musabe`, phone: `07541234${i}0`, relationship }));
  six[0] = { fullName: 'Daniel Musabe Damian', phone: '079 530 9020', relationship: 'Father' };
  const a = await as('sadmin', 'POST', '/api/students', { admissionNo: ADM(20), firstName: 'guardian', lastName: 'student', sex: 'M', classId: cls.id, guardians: six });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  const id = a.json.student.id;
  let p = await as('sadmin', 'GET', `/api/students/${id}`);
  assert.equal(p.json.student.guardians.length, 6); // more than 4
  assert.equal(p.json.student.guardians[0].fullName, 'DANIEL MUSABE DAMIAN');
  assert.equal(p.json.student.guardians[0].phone, '0795309020');
  assert.equal(p.json.student.guardians[3].relationshipLabel, 'Grandmother');
  // Brothers and sisters: AARON has the same guardian phone.
  assert.ok(p.json.siblings.some((x) => x.fullName === 'AARON ALBERTO MGULUNDE'));
  const guardianId = p.json.student.guardians[0].id;
  const v = await as('sadmin', 'PATCH', `/api/students/${id}/guardians/${guardianId}/verify`, { verificationMethod: 'Phone call by school staff', verificationNote: 'Confirmed by calling 0795309020' });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal(v.json.guardian.verified, true);
  assert.equal((await as('bursar', 'PATCH', `/api/students/${id}/guardians/${guardianId}/verify`, { verificationMethod: 'phone' })).status, 403);
  // Keep only the first two; the first stays verified (same name and phone).
  const keep = p.json.student.guardians.slice(0, 2).map((g) => ({ id: g.id, fullName: g.fullName, phone: g.phone, relationship: g.relationship }));
  const edited = await as('sadmin', 'PATCH', `/api/students/${id}`, { guardians: keep });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  p = await as('sadmin', 'GET', `/api/students/${id}`);
  assert.equal(p.json.student.guardians.length, 2);
  assert.equal(p.json.student.guardians[0].verified, true);
  assert.ok(p.json.history.some((h) => /guardians: DANIEL MUSABE DAMIAN \(Father, 0795309020\)/.test(h.summary)));
  // Wrong names, titles, phones, relationships, empty list.
  const bad = async (g) => (await as('sadmin', 'PATCH', `/api/students/${id}`, { guardians: g })).json.error;
  assert.match(await bad([{ fullName: 'Mr John', phone: '0754000001', relationship: 'father' }]), /title/);
  assert.match(await bad([{ fullName: 'Mama Simon', phone: '0754000001', relationship: 'mother' }]), /title/);
  assert.match(await bad([{ fullName: 'Grace', phone: '0754000001', relationship: 'mother' }]), /two names/);
  assert.match(await bad([{ fullName: 'GRACE tibaijuka', phone: '0714-83523', relationship: 'mother' }]), /mobile number/);
  assert.match(await bad([{ fullName: 'GRACE tibaijuka', phone: '0754000001', relationship: 'cousin' }]), /not known/);
  assert.match(await bad([]), /at least one guardian/);
  assert.match(await bad([{ fullName: 'GRACE TIBAIJUKA', phone: '0754000001', relationship: 'mother' }, { fullName: 'JOHN MATHIAS', phone: '0754 000 001', relationship: 'father' }]), /same as guardian 1/);
});

test('Excel download = the screen, and uploads back with no change', { skip }, async () => {
  const res = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: `/api/students/export.xlsx?class=${cls.id}`, headers: { Cookie: people.sadmin.cookie } }, (r) => {
      const parts = []; r.on('data', (c) => parts.push(c)); r.on('end', () => resolve(Buffer.concat(parts)));
    }).on('error', reject);
  });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(res);
  const ws = wb.worksheets[0];
  const head = ws.getRow(2).values.slice(1);
  assert.deepEqual(head.slice(0, 9), ['S/N', 'Admission No.', 'First name', 'Middle name', 'Last name', 'Sex', 'Guardian 1 Name', 'Guardian 1 Phone', 'Guardian 1 Relationship']);
  assert.ok(head.includes('Guardian 2 Name') && !head.includes('Guardian 3 Name')); // as many groups as the student with most guardians (at least 2)
  assert.ok(!head.some((h) => /parent/i.test(h)));
  const screen = (await as('sadmin', 'GET', `/api/students?class=${cls.id}`)).json.students;
  const names = []; ws.eachRow((r, n) => { if (n > 2) names.push(r.getCell(2).text); });
  assert.deepEqual(names, screen.map((x) => x.admissionNo)); // same students, same order
  const g1 = []; ws.eachRow((r, n) => { if (n > 2) g1.push(r.getCell(7).text); });
  assert.deepEqual(g1, screen.map((x) => x.guardians[0]?.fullName || ''));
  const up = await upload('sadmin', `/api/students/imports?class=${cls.id}`, res);
  assert.equal(up.status, 201, JSON.stringify(up.json));
  const rev = await as('sadmin', 'GET', `/api/students/imports/${up.json.id}`);
  assert.equal(rev.json.summary.errors, 0, JSON.stringify(rev.json.lines.filter((l) => l.errors.length)));
  assert.equal(rev.json.summary.changes, 0, JSON.stringify(rev.json.lines.filter((l) => l.change !== 'No change')));
  await as('sadmin', 'POST', `/api/students/imports/${up.json.id}/discard`);
});

test('One wrong row: fix it on the review page, skip it, or save the good rows and leave it out', { skip }, async () => {
  const rows = [
    [null, ADM('F1'), 'GOOD', '', 'ONE', 'f', 'ASHA JUMA HAMISI', '0754 777 001'],
    [null, ADM('F2'), 'BAD', '', 'GUARDIAN', 'm', 'Mr John', '0754 777 002'],
    [null, ADM('F3'), 'BAD', '', 'PHONE', 'f', 'GRACE TIBAIJUKA', '07547'],
    [null, ADM('F4'), 'GOOD', '', 'FOUR', 'm', 'PETER JOHN MREMA', '0754 777 004'],
  ];
  const up = await upload('sadmin', `/api/students/imports?class=${cls2.id}`, await classFile(rows));
  const id = up.json.id;
  let rev = (await as('sadmin', 'GET', `/api/students/imports/${id}`)).json;
  assert.equal(rev.summary.errors, 2);
  const bad = rev.lines.find((l) => l.admissionNo === ADM('F2'));
  assert.equal(bad.input.firstName, 'BAD'); // what the row says, to fill the Fix form
  assert.equal(bad.input.guardians[0].fullName, 'Mr John');
  // Approve is refused while mistakes remain (unless the good rows are saved and the bad ones left out).
  assert.match((await as('sadmin', 'POST', `/api/students/imports/${id}/approve`)).json.error, /Fix/);
  // Fix row F2 here.
  const fx = await as('sadmin', 'PUT', `/api/students/imports/${id}/rows/${bad.row}`, { admissionNo: ADM('F2'), firstName: 'Bad', middleName: '', lastName: 'Guardian', sex: 'M',
    guardians: [{ fullName: 'JOHN MATHIAS', phone: '0754777002', relationship: 'father' }] });
  assert.equal(fx.status, 200, JSON.stringify(fx.json));
  assert.deepEqual(fx.json.line.errors, []);
  assert.equal(fx.json.line.fixed, true);
  assert.equal(fx.json.summary.errors, 1);
  assert.equal((await as('bursar', 'PUT', `/api/students/imports/${id}/rows/${bad.row}`, { skip: true })).status, 403);
  // Skip and undo.
  const f3 = rev.lines.find((l) => l.admissionNo === ADM('F3'));
  let sk = await as('sadmin', 'PUT', `/api/students/imports/${id}/rows/${f3.row}`, { skip: true });
  assert.equal(sk.json.summary.errors, 0); assert.equal(sk.json.summary.skipped, 1);
  sk = await as('sadmin', 'PUT', `/api/students/imports/${id}/rows/${f3.row}`, { undo: true });
  assert.equal(sk.json.summary.errors, 1);
  // Save the good rows (F1, fixed F2, F4); F3 is left out and can be downloaded.
  const ok = await as('sadmin', 'POST', `/api/students/imports/${id}/approve`, { skipMistakes: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.summary.new, 3);
  assert.deepEqual(ok.json.summary.leftOut.map((x) => x.admissionNo), [ADM('F3')]);
  const f2 = (await as('sadmin', 'GET', `/api/students?q=${ADM('F2')}`)).json.students[0];
  assert.equal(f2.guardians[0].fullName, 'JOHN MATHIAS');
  assert.equal((await as('sadmin', 'GET', `/api/students?q=${ADM('F3')}`)).json.students.length, 0);
  const xl = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: `/api/students/imports/${id}/left-out.xlsx`, headers: { Cookie: people.sadmin.cookie } }, (r) => {
      const parts = []; r.on('data', (c) => parts.push(c)); r.on('end', () => resolve({ status: r.statusCode, buf: Buffer.concat(parts) }));
    }).on('error', reject);
  });
  assert.equal(xl.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xl.buf);
  const r3 = wb.worksheets[0].getRow(2).values;
  assert.ok(r3.includes(ADM('F3')) && r3.includes('GRACE TIBAIJUKA'));
  // The left-out file, fixed, uploads again normally.
  wb.worksheets[0].getRow(2).getCell(8).value = '0754777003';
  const again = await upload('sadmin', `/api/students/imports?class=${cls2.id}`, Buffer.from(await wb.xlsx.writeBuffer()));
  const rev2 = (await as('sadmin', 'GET', `/api/students/imports/${again.json.id}`)).json;
  assert.equal(rev2.summary.errors, 0, JSON.stringify(rev2.lines.map((l) => l.errors)));
  assert.equal(rev2.summary.new, 1);
  await as('sadmin', 'POST', `/api/students/imports/${again.json.id}/discard`);
  const ids = [];
  for (const a of ['F1', 'F2', 'F4']) ids.push((await as('sadmin', 'GET', `/api/students?q=${ADM(a)}`)).json.students[0].id);
  await as('sadmin', 'POST', '/api/students/move', { ids, left: true });
});

test('Bulk edit with Excel: whole school file, Class and Status columns decide', { skip }, async () => {
  const get = (path) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers: { Cookie: people.sadmin.cookie } }, (r) => {
      const parts = []; r.on('data', (c) => parts.push(c)); r.on('end', () => resolve(Buffer.concat(parts)));
    }).on('error', reject);
  });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await get('/api/students/export.xlsx'));
  const ws = wb.worksheets[0];
  const head = ws.getRow(2).values;
  const col = (h) => head.indexOf(h);
  const rowOf = (adm) => { let x = null; ws.eachRow((r, n) => { if (n > 2 && r.getCell(col('Admission No.')).text === adm) x = r; }); return x; };
  rowOf(ADM(1)).getCell(col('Class')).value = cls2.label;           // move
  rowOf(ADM(4)).getCell(col('Status')).value = 'Left';             // left school
  rowOf(ADM(2)).getCell(col('Middle name')).value = '-';           // erase middle name
  const n = ws.rowCount + 1;
  ws.getRow(n).values = [, '', ADM('X1'), 'NEW', '', 'KID', 'F', 'ASHA JUMA HAMISI', '0754999888', 'Mother'];
  let buf = Buffer.from(await wb.xlsx.writeBuffer());
  let up = await upload('sadmin', '/api/students/imports?class=many', buf);
  assert.equal(up.status, 201, JSON.stringify(up.json));
  let rev = (await as('sadmin', 'GET', `/api/students/imports/${up.json.id}`)).json;
  assert.equal(rev.summary.many, true);
  assert.match(rev.lines.find((l) => l.admissionNo === ADM('X1')).errors.join(' '), /Write the class/);
  await as('sadmin', 'POST', `/api/students/imports/${up.json.id}/discard`);
  ws.getRow(n).getCell(col('Class')).value = cls.label;
  buf = Buffer.from(await wb.xlsx.writeBuffer());
  up = await upload('sadmin', '/api/students/imports?class=many', buf);
  rev = (await as('sadmin', 'GET', `/api/students/imports/${up.json.id}`)).json;
  assert.equal(rev.summary.errors, 0, JSON.stringify(rev.lines.filter((l) => l.errors.length)));
  assert.equal(rev.summary.new, 1); assert.equal(rev.summary.left, 1); assert.ok(rev.summary.move >= 1); assert.ok(rev.summary.update >= 1);
  assert.equal(rev.upload.className, 'Many classes');
  const ok = await as('sadmin', 'POST', `/api/students/imports/${up.json.id}/approve`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const find = async (adm) => (await as('sadmin', 'GET', `/api/students?status=all&q=${adm}`)).json.students[0];
  assert.equal((await find(ADM(1))).classId, cls2.id);
  assert.equal((await find(ADM(4))).status, 'left');
  assert.equal((await find(ADM(2))).middleName, null);
  assert.equal((await find(ADM('X1'))).classId, cls.id);
  const page = (await as('sadmin', 'GET', `/api/students/${(await find(ADM(1))).id}`)).json;
  assert.ok(page.history.some((h) => /^Excel bulk edit/.test(h.summary)));
  // Put things back for the next tests.
  await as('sadmin', 'POST', '/api/students/move', { ids: [(await find(ADM(1))).id, (await find(ADM(4))).id], classId: cls.id });
  await as('sadmin', 'PATCH', `/api/students/${(await find(ADM(2))).id}`, { middleName: 'ANTHONY' });
  await as('sadmin', 'POST', '/api/students/move', { ids: [(await find(ADM('X1'))).id], left: true });
});

test('Bulk edit: many students at once; one mistake saves nothing', { skip }, async () => {
  const list = (await as('sadmin', 'GET', `/api/students?class=${cls.id}`)).json.students.filter((x) => [ADM(1), ADM(3)].includes(x.admissionNo));
  const [aaron, alvin] = list;
  const rows = [
    { id: aaron.id, firstName: 'Aaron', middleName: 'Alberto', lastName: 'Mgulunde', sex: 'M', admissionNo: aaron.admissionNo, classId: cls.id,
      guardians: [{ fullName: 'DANIEL MUSABE DAMIAN', phone: '0795309020', relationship: 'father' }, { fullName: 'pendo costantine mbeikya', phone: '0713 111 222', relationship: 'mother' }] },
    { id: alvin.id, sex: 'M', guardians: [{ fullName: 'Ms Grace', phone: '0713111223', relationship: 'mother' }] },
  ];
  const no = await as('sadmin', 'POST', '/api/students/bulk', { rows });
  assert.equal(no.status, 400);
  assert.equal(no.json.rows.length, 1);
  assert.equal(no.json.rows[0].id, alvin.id);
  assert.equal((await as('sadmin', 'GET', `/api/students/${aaron.id}`)).json.student.guardians.length, 1); // nothing saved
  rows[1].guardians = [{ fullName: 'GRACE TIBAIJUKA', phone: '0713111223', relationship: 'aunt' }];
  rows[1].classId = cls2.id;
  const ok = await as('sadmin', 'POST', '/api/students/bulk', { rows });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.saved, 2);
  const a2 = (await as('sadmin', 'GET', `/api/students/${aaron.id}`)).json;
  assert.deepEqual(a2.student.guardians.map((g) => g.fullName), ['DANIEL MUSABE DAMIAN', 'PENDO COSTANTINE MBEIKYA']);
  assert.ok(a2.history.some((h) => /^Bulk edit/.test(h.summary)));
  const b2 = (await as('sadmin', 'GET', `/api/students/${alvin.id}`)).json.student;
  assert.equal(b2.classId, cls2.id);
  assert.equal(b2.guardians[0].relationship, 'aunt');
  await as('sadmin', 'POST', '/api/students/move', { ids: [alvin.id], classId: cls.id });
  // Saving the same again changes nothing; other school and bursar cannot.
  assert.equal((await as('sadmin', 'POST', '/api/students/bulk', { rows })).json.saved, 1); // only the class (moved back above)
  assert.equal((await as('boysAdmin', 'POST', '/api/students/bulk', { rows })).status, 403);
  assert.equal((await as('bursar', 'POST', '/api/students/bulk', { rows })).status, 403);
});

test('Add, edit, move and mark as left; admission numbers stay unique', { skip }, async () => {
  const mum = [{ fullName: 'asha juma', phone: '0754 123 456', relationship: 'mother' }];
  assert.match((await as('sadmin', 'POST', '/api/students', { admissionNo: ADM(9), firstName: 'neema', lastName: 'masanja', sex: 'F', classId: cls.id })).json.error, /at least one guardian/);
  const a = await as('sadmin', 'POST', '/api/students', { admissionNo: ADM(9), firstName: 'neema', middleName: 'john', lastName: 'masanja', sex: 'F', classId: cls.id, guardians: mum });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.equal(a.json.student.fullName, 'NEEMA JOHN MASANJA');
  assert.equal((await as('sadmin', 'POST', '/api/students', { admissionNo: ADM(9), firstName: 'x', lastName: 'y', sex: 'M', classId: cls.id, guardians: mum })).status, 409);
  assert.equal((await as('sadmin', 'POST', '/api/students', { admissionNo: ADM(8), firstName: 'x', lastName: 'y', sex: 'M', classId: cls.id, guardians: [{ ...mum[0], phone: '0714-83523' }] })).status, 400);
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
