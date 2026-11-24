// Timetable grid: empty at first, generate from lessons per week, teacher clashes, Excel round trip (2026-11-24).
// Runs only when TEST_DATABASE_URL points to a TEST database that is migrated and seeded. Never point it at real data.
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;
const ExcelJS = URL ? require('exceljs') : null; // loaded first: it is slow and would block the server in the middle of a request

const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const { listen, request } = require('./helpers');

const tag = `g${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const P = {};
let server, port, school, c1, c2, subs = [];
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body, rawBody) => request({ port, method, path, body, rawBody, cookie: P[who].cookie, headers: rawBody ? { 'Content-Type': 'application/octet-stream' } : {} });
const Q = '&year=2031&term=1';

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  [school] = await db('schools').insert({ code: `tg${tag}`.slice(0, 20), name: `Grid School ${tag}`, short_name: `GS ${tag}`.slice(0, 60), receipt_prefix: `G${tag.slice(-3)}`.toUpperCase().slice(0, 4) }).returning('*');
  [c1] = await db('classes').insert({ school_id: school.id, name: 'PRIMARY FOUR', stream: 'PINK', level: 'P4', short_name: 'P 4', curriculum: 'new' }).returning('*');
  [c2] = await db('classes').insert({ school_id: school.id, name: 'PRIMARY FOUR', stream: 'BLUE', level: 'P4', short_name: 'P 4', curriculum: 'new' }).returning('*');
  for (const [key, role] of [['acad', 'acad'], ['teacher', 'teacher'], ['t1', 'teacher'], ['t2', 'teacher']]) {
    const username = `tg_${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: school.id, password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id ?? u, cookie: cookie(r) };
  }
  let sn = 1;
  for (const [name, short, teacher] of [['Mathematics', 'MTC', 't1'], ['English', 'ENG', 't2'], ['Kiswahili', 'KISW', 't1'], ['Science', 'SCI', 't2']]) {
    const [s] = await db('academic_subjects').insert({ school_id: school.id, name: `${name} ${tag}`, short_name: short, stage: 'primary', level: 'P4', curriculum: 'new', sn: sn++, created_by: P.acad.id }).returning('*');
    subs.push(s);
    // the same two teachers teach both streams: the generator must keep them from being in two places at once
    await db('class_subjects').insert([{ class_id: c1.id, subject_id: s.id, teacher_id: P[teacher].id, created_by: P.acad.id }, { class_id: c2.id, subject_id: s.id, teacher_id: P[teacher].id, created_by: P.acad.id }]);
  }
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });

test('an unwritten timetable is an empty table; only the Academic Master / Head writes', { skip }, async () => {
  const g = (await as('acad', 'GET', `/api/timetable/grid?class=${c1.id}${Q}`)).json;
  assert.equal(g.written, false); assert.equal(g.periods.length, 0); assert.equal(g.cells.length, 0); assert.equal(g.subjects.length, 4);
  assert.equal((await as('teacher', 'GET', `/api/timetable/grid?class=${c1.id}${Q}`)).status, 200, 'teachers may look');
  assert.equal((await as('teacher', 'PUT', '/api/timetable/grid', { year: 2031, term: 1, grids: [{ classId: c1.id, periods: [], cells: [] }] })).status, 403);
  assert.equal((await as('acad', 'GET', `/api/timetable/grid?class=${c1.id}&year=2031&term=3`)).status, 400, 'two terms only');
});

test('generate: right number of lessons, no teacher in two classes at the same time; nothing saved until she saves', { skip }, async () => {
  const periods = [['07:20', '08:00', 'lesson'], ['08:00', '08:55', 'lesson'], ['08:55', '09:50', 'lesson'], ['09:50', '10:30', 'break'], ['10:30', '11:25', 'lesson'], ['11:25', '12:20', 'lesson']].map(([starts, ends, kind]) => ({ starts, ends, kind }));
  const r = await as('acad', 'POST', '/api/timetable/generate', { year: 2031, term: 1, classIds: [c1.id, c2.id], days: 5, periods });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  // with two classes sharing teachers, each class has its own periods (none were stored): 8 default lessons x 5 days
  for (const g of r.json.grids) { assert.ok(g.placed > 0); assert.equal(g.cells.every((c) => c.subjectId && c.teacherId), true); }
  const [a, b] = r.json.grids;
  for (const x of a.cells) for (const y of b.cells) if (x.teacherId === y.teacherId && x.day === y.day) assert.notEqual(x.period, y.period, 'same teacher, same box in two classes');
  assert.equal((await db('academic_timetable_entries').where({ school_id: school.id }).count('* as n'))[0].n, '0');
  // a single class with her own periods and lessons per week
  const one = await as('acad', 'POST', '/api/timetable/generate', { year: 2031, term: 1, classIds: [c1.id], days: 5, periods, perWeek: { [c1.id]: { [subs[0].id]: 6, [subs[1].id]: 5, [subs[2].id]: 4, [subs[3].id]: 3 } } });
  const g = one.json.grids[0];
  assert.equal(g.wanted, 18); assert.equal(g.placed, 18); assert.equal(g.cells.filter((c) => c.subjectId === subs[0].id).length, 6);
  assert.equal(g.cells.some((c) => g.periods[c.period - 1].kind !== 'lesson'), false, 'nothing in the break');
  global.__grid = g;
});

test('save, clash detection, activities and reading back', { skip }, async () => {
  const g = global.__grid;
  const body = { year: 2031, term: 1, grids: [{ classId: c1.id, periods: g.periods, cells: [...g.cells, { day: 1, period: 4, activity: 'BREAK' }] }] };
  const bad = await as('acad', 'PUT', '/api/timetable/grid', { ...body, grids: [{ classId: c1.id, periods: g.periods, cells: [{ day: 1, period: 4, subjectId: subs[0].id }] }] });
  assert.equal(bad.status, 400, 'no subject in a break');
  const ok = await as('acad', 'PUT', '/api/timetable/grid', body);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const back = (await as('acad', 'GET', `/api/timetable/grid?class=${c1.id}${Q}`)).json;
  assert.equal(back.written, true); assert.equal(back.periods.length, 6); assert.equal(back.cells.length, g.cells.length + 1);
  assert.equal(back.periods[3].kind, 'break'); assert.equal(back.periods[0].starts, '07:20');
  // a clash: the same teacher in the other class at the same time
  const first = g.cells[0];
  const clash = await as('acad', 'PUT', '/api/timetable/grid', { year: 2031, term: 1, grids: [{ classId: c2.id, periods: g.periods, cells: [{ day: first.day, period: first.period, subjectId: first.subjectId }] }] });
  assert.equal(clash.status, 409); assert.equal(clash.json.clashes.length, 1);
  assert.equal((await as('acad', 'PUT', '/api/timetable/grid', { year: 2031, term: 1, force: true, grids: [{ classId: c2.id, periods: g.periods, cells: [{ day: first.day, period: first.period, subjectId: first.subjectId }] }] })).status, 200);
  // the teacher's own lessons now come from the grid
  const ent = await db('academic_timetable_entries').where({ class_id: c1.id }).count('* as n');
  assert.equal(Number(ent[0].n), g.cells.length + 1);
});

test('level table: one table for all streams, fixed parts cannot be filled, layout saved', { skip }, async () => {
  const g = await as('acad', 'GET', `/api/timetable/level?school=${school.id}&group=P4${Q}`);
  assert.equal(g.status, 200, JSON.stringify(g.json));
  assert.equal(g.json.classes.length, 2);
  const L = g.json.layout; const lessons = L.periods.map((p, i) => ({ ...p, n: i + 1 })).filter((p) => p.kind === 'lesson');
  const fixedP = L.periods.map((p, i) => ({ ...p, n: i + 1 })).find((p) => p.kind !== 'lesson');
  assert.ok(lessons.length > 3 && fixedP);
  const cells = [{ classId: c1.id, day: 1, period: lessons[0].n, subjectId: subs[0].id }, { classId: c2.id, day: 1, period: lessons[1].n, subjectId: subs[1].id },
    { classId: c1.id, day: 1, period: fixedP.n, subjectId: subs[0].id }];
  assert.equal((await as('teacher', 'PUT', '/api/timetable/level', { schoolId: school.id, group: 'P4', year: 2031, term: 1, cells })).status, 403);
  const put = await as('acad', 'PUT', '/api/timetable/level', { schoolId: school.id, group: 'P4', year: 2031, term: 1, cells });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const back = await as('acad', 'GET', `/api/timetable/level?school=${school.id}&group=P4${Q}`);
  assert.equal(back.json.cells.length, 2, 'the box on a fixed period is dropped');
  // change a time and a fixed part
  const L2 = { ...L, periods: L.periods.map((p, i) => (i === lessons[0].n - 1 ? { ...p, starts: '07:30' } : p)) };
  const s2 = await as('acad', 'PUT', '/api/timetable/level', { schoolId: school.id, group: 'P4', year: 2031, term: 1, layout: L2, cells: back.json.cells });
  assert.equal(s2.status, 200, JSON.stringify(s2.json));
  const b2 = await as('acad', 'GET', `/api/timetable/level?school=${school.id}&group=P4${Q}`);
  assert.equal(b2.json.layout.periods[lessons[0].n - 1].starts, '07:30'); assert.equal(b2.json.layout.isDefault, false);
  // generate respects the fixed parts
  const gen = await as('acad', 'POST', '/api/timetable/generate', { schoolId: school.id, year: 2031, term: 1, classIds: [c1.id, c2.id], layout: true });
  assert.equal(gen.status, 200, JSON.stringify(gen.json));
  for (const gr of gen.json.grids) for (const c of gr.cells) assert.equal(gr.periods[c.period - 1].kind, 'lesson');
});

test('Excel in the paper layout: dropdowns, read back', { skip }, async () => {
  const r = await request({ port, method: 'GET', path: `/api/timetable/template.xlsx?${Q.slice(1)}`, cookie: P.acad.cookie, binary: true });
  assert.equal(r.status, 200);
  const buf = Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.body, 'binary');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const info = await as('acad', 'GET', `/api/timetable/level?school=${school.id}&group=P4${Q}`);
  const L = info.json.layout; const N = info.json.classes.length;
  const sheet = wb.getWorksheet(info.json.group.label.slice(0, 31)); assert.ok(sheet && wb.getWorksheet('Lists'));
  assert.equal(sheet.getRow(4).getCell(1).value, 'DAY');
  const idx = info.json.classes.findIndex((c) => c.id === c2.id);
  const p = L.periods.findIndex((x) => x.kind === 'lesson') + 1; const q = p + 1;
  const row = sheet.getRow(5 + 2 * N + idx); // Wednesday
  assert.ok(sheet.getCell(row.number, 3 + p).dataValidation, 'the box has a drop-down');
  row.getCell(3 + p).value = 'MTC'; row.getCell(3 + q).value = 'XYZ';
  const out = Buffer.from(await wb.xlsx.writeBuffer());
  const up = await as('acad', 'POST', '/api/timetable/excel', null, out);
  assert.equal(up.status, 200, JSON.stringify(up.json));
  const lv = up.json.levels.find((x) => x.group === 'P4');
  const cell = (pp) => lv.cells.find((c) => c.classId === c2.id && c.day === 3 && c.period === pp);
  assert.equal(cell(p).subjectId, subs[0].id); assert.ok(cell(p).teacherId); assert.equal(cell(q).activity, 'XYZ');
  assert.ok(up.json.warnings.some((w) => /XYZ/.test(w)));
  assert.equal((await as('teacher', 'POST', '/api/timetable/excel', null, out)).status, 403);
});
