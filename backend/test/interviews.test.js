// Classes from built-in levels (Academic Master) and admission interviews (2026-11-20).
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

const tag = `i${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const nt = tag.replace(/[0-9]/g, (d) => 'abcdefghij'[d]);   // names keep letters only
const P = {};
let server, port, boys, em;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body, cookie: P[who].cookie });
function upload(who, path, buf) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path, headers: { Cookie: P[who].cookie, 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length, 'X-File-Name': 'usaili.xlsx' } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(t || '{}') }));
    });
    req.on('error', reject); req.end(buf);
  });
}

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  boys = await db('schools').where({ code: 'boys' }).first();
  em = await db('schools').where({ code: 'pre' }).first();
  const make = [['acad', 'acad', boys.id], ['sadmin', 'sadmin', boys.id], ['head', 'head', boys.id], ['acadEm', 'acad', em.id],
    ['secretary', 'secretary', null], ['adirector', 'adirector', null], ['bursar', 'bursar', boys.id]];
  for (const [key, role, school] of make) {
    const username = `${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: school, password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id, cookie: cookie(r) };
  }
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });

test('Academic Master adds classes from the built-in list with streams; the School Admin only looks', { skip }, async () => {
  let r = await as('sadmin', 'GET', '/api/students/classes');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.levels.map((l) => l.key), ['F1', 'F2', 'F3', 'F4'], 'secondary school: Form I-IV');
  assert.equal((await as('sadmin', 'POST', '/api/students/classes', { level: 'F1', streams: ['A'] })).status, 403, 'School Admin cannot add classes now');
  assert.equal((await as('acad', 'POST', '/api/students/classes', { level: 'P1', streams: ['A'] })).status, 400, 'P 1 is not a class of a secondary school');
  const st = `${tag}`.slice(-4).toUpperCase();
  r = await as('acad', 'POST', '/api/students/classes', { level: 'F4', streams: [`${st}A`, `${st}B`] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual(r.json.classes.map((c) => c.label), [`F 4 ${st}A`, `F 4 ${st}B`]);
  assert.equal(r.json.classes[0].name, 'FORM FOUR');
  assert.equal(r.json.classes[0].curriculum, 'old', 'Form Four follows the old curriculum by default');
  assert.equal((await as('acad', 'POST', '/api/students/classes', { level: 'F4', streams: [`${st}A`] })).status, 409, 'twice refused');
  r = await as('acad', 'PATCH', `/api/students/classes/${r.json.classes[1].id}`, { curriculum: 'new', stream: `${st}C` });
  assert.equal(r.status, 200); assert.equal(r.json.class.label, `F 4 ${st}C`); assert.equal(r.json.class.curriculum, 'new');
  assert.equal((await as('acad', 'PATCH', `/api/students/classes/${r.json.class.id}`, { level: 'F1' })).status, 400, 'level is fixed');
  // A class typed by hand before: the Academic Master picks its level later.
  const [old] = await db('classes').insert({ school_id: em.id, name: `OLD ${tag}`.toUpperCase(), short_name: 'X9', stream: nt.toUpperCase().slice(0, 20) }).returning('*');
  r = await as('acadEm', 'PATCH', `/api/students/classes/${old.id}`, { level: 'PP1' });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.class.name, 'PREP ONE'); assert.equal(r.json.class.shortName, 'PP 1');
  assert.equal((await as('acad', 'PATCH', `/api/students/classes/${old.id}`, { stream: 'Z' })).status, 404, 'another school');
});

test('Secretary enters interviews (form and Excel); School Admin registers the child who passed; interview shows on the student', { skip }, async () => {
  assert.equal((await as('sadmin', 'POST', '/api/interviews', { schoolId: boys.id, firstName: 'A', lastName: 'B', sex: 'M' })).status, 403);
  assert.equal((await as('bursar', 'GET', '/api/interviews')).status, 403);
  assert.equal((await as('secretary', 'POST', '/api/interviews', { firstName: 'A', lastName: 'B', sex: 'M' })).status, 400, 'school needed');
  let r = await as('secretary', 'POST', '/api/interviews', { schoolId: boys.id, year: 2027, firstName: 'juma', middleName: 'ally', lastName: `Test${nt}`, sex: 'M', level: 'F 1',
    examCentre: 'Buhongwa', previousSchool: 'Igogo Primary', interviewDate: '2026-11-14', parentPhone: '754123456', parentPhone2: '12',
    marks: [{ subject: 'Mathematics', marks: 78, outOf: 100 }, { subject: 'English', marks: 64, outOf: 100 }], result: 'passed' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const iv = r.json.interview;
  assert.equal(iv.total, 142); assert.equal(iv.outOf, 200); assert.equal(iv.percent, 71); assert.equal(iv.levelName, 'F 1');
  assert.equal(iv.parentPhone, '0754123456'); assert.equal(iv.parentPhone2, null, 'bad second phone dropped'); assert.equal(iv.interviewDate, '2026-11-14');
  assert.equal((await as('secretary', 'POST', '/api/interviews', { schoolId: boys.id, firstName: 'X', lastName: 'Y', sex: 'M', marks: [{ subject: 'Maths', marks: 120, outOf: 100 }] })).status, 400, 'more than out of');

  // Excel: a subject column the school added (Physics), Result words in Kiswahili.
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Usaili');
  ws.addRow(['MATOKEO YA USAILI 2027']);
  ws.addRow(['S/N', 'Name', 'Sex', 'Class', 'Exam centre', 'Previous school', 'Parent phone', 'Interview date', 'Mathematics', 'Physics', 'Result']);
  ws.addRow([1, `NEEMA ${nt} MOSHI`, 'F', 'FORM ONE', 'Buhongwa', 'Nyamagana', '0768279191', '14/11/2026', 55, 60, 'amefaulu']);
  ws.addRow([2, `PETER ${nt} JOHN`, 'M', 'F1', 'Buhongwa', 'Mkuyuni', '', '14/11/2026', 20, 31, 'ameshindwa']);
  ws.addRow([3, `BAD ${nt} ROW`, 'X', 'P 1', '', '', '', '31/13/2026', 'abc', '', 'maybe']);
  let buf = Buffer.from(await wb.xlsx.writeBuffer());
  r = await upload('secretary', `/api/interviews/import?school=${boys.id}&year=2027&check=1`, buf);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.summary.rows, 3); assert.equal(r.json.summary.errors, 1); assert.deepEqual(r.json.summary.subjects, ['MATHEMATICS', 'PHYSICS']);
  assert.ok(r.json.lines[2].errors.some((e) => /Date/.test(e)) && r.json.lines[2].errors.length >= 5, JSON.stringify(r.json.lines[2].errors));
  assert.equal((await upload('secretary', `/api/interviews/import?school=${boys.id}&year=2027`, buf)).status, 400, 'not saved with mistakes');
  ws.spliceRows(5, 1);
  buf = Buffer.from(await wb.xlsx.writeBuffer());
  r = await upload('secretary', `/api/interviews/import?school=${boys.id}&year=2027`, buf);
  assert.equal(r.status, 201, JSON.stringify(r.json)); assert.equal(r.json.saved, 2);

  r = await as('sadmin', 'GET', `/api/interviews?q=${nt}&result=passed&registered=no`);
  assert.equal(r.status, 200); assert.equal(r.json.interviews.length, 2);
  assert.equal(r.json.interviews[0].id, iv.id, 'highest marks first (142 > 115)');
  // Edit by the Assistant Director
  const neema = r.json.interviews.find((x) => x.sex === 'F');
  r = await as('adirector', 'PATCH', `/api/interviews/${neema.id}`, { result: 'reserve', note: 'Second list' });
  assert.equal(r.status, 200); assert.equal(r.json.interview.result, 'reserve');
  const home = await as('sadmin', 'GET', '/api/dashboard');
  assert.ok(home.json.todo.some((t) => /admission interview/.test(t.label)), JSON.stringify(home.json.todo));

  // School Admin registers Juma from the interview.
  const [cls] = await db('classes').insert({ school_id: boys.id, level: 'F1', name: 'FORM ONE', short_name: 'F 1', stream: `R${tag}`.toUpperCase().slice(0, 10) }).returning('*');
  r = await as('sadmin', 'POST', '/api/students', { admissionNo: `IV${tag}`.slice(0, 18), firstName: 'Juma', middleName: 'Ally', lastName: `Test${nt}`, sex: 'M', classId: cls.id, interviewId: iv.id });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const sid = r.json.student.id;
  assert.equal((await as('sadmin', 'POST', '/api/students', { admissionNo: `IW${tag}`.slice(0, 18), firstName: 'Juma', lastName: 'Two', sex: 'M', classId: cls.id, interviewId: iv.id })).status, 409, 'registered once');
  r = await as('head', 'GET', `/api/students/${sid}`);
  assert.equal(r.status, 200); assert.equal(r.json.student.interview.previousSchool, 'IGOGO PRIMARY'); assert.equal(r.json.student.interview.total, 142);
  r = await as('head', 'GET', `/api/interviews/${iv.id}`);
  assert.equal(r.json.interview.studentId, sid);
  assert.equal((await as('acadEm', 'GET', `/api/interviews/${iv.id}`)).status, 404, 'other school');
  assert.equal((await request({ port, method: 'DELETE', path: '/api/interviews/1', cookie: P.secretary.cookie })).status, 404);
  await assert.rejects(db('admission_interviews').where({ id: iv.id }).del(), 'never deleted');
});
