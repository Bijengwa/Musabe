// Students and classes (Step 1b).
// - School Admin (own school) and Super Admin (any school): classes, add / edit students, load class lists from Excel.
// - Others with the "students" page: look only (own school for school staff).
// - Search (GET /api/students/search) is used by other screens, e.g. the bursar picks the student when selling,
//   so names are never typed by hand (fewer mistakes).
// Students are never deleted: a student who leaves is marked "left" (receipts and marks point to them).
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES, pageAccess } = require('../auth/roles');
const { publish } = require('../realtime');
const { sendExcel, readRows } = require('../lib/excel');

const { uploadLimit } = require('../lib/guard');
const G = require('../lib/guardians');
const router = express.Router();
router.use(requireAuth);

const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// "P 2" + stream "A" -> "P 2 A" (lists, receipts). Full: "PRIMARY TWO A".
const classLabel = (c) => (c ? [c.short_name || c.name, c.stream].filter(Boolean).join(' ') : '');
const classFull = (c) => (c ? [c.name, c.stream].filter(Boolean).join(' ') : '');
// P 1, P 2 ... P 10 in number order, then by stream.
const byShort = (a, b) => classLabel(a).localeCompare(classLabel(b), 'en', { numeric: true, sensitivity: 'base' });
const SEX = { M: 'Boy', F: 'Girl' };

// Which school a request is about: own school for school staff; ?school= / body.schoolId for administration.
async function schoolOf(req, given) {
  if (!allSchools(req.user)) return req.user.school_id;
  const id = Number(given ?? req.query.school);
  if (!id) throw new HttpError(400, 'Choose a school first (top of the page).');
  if (!(await db('schools').where({ id }).first('id'))) throw new HttpError(404, 'School not found.');
  return id;
}

// ---------- Cleaning what people type or what comes from Excel ----------
const up = (v) => String(v ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase();
// Names: letters, spaces, apostrophe and hyphen only. "  aaron " -> "AARON". "." or "-" alone = empty.
function nameText(v) {
  const s = up(v).replace(/[^A-Z' -]/g, '').replace(/\s+/g, ' ').trim();
  return /^[-' ]*$/.test(s) ? '' : s;
}
function sexOf(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (/^(m|male|me|boy|b|mvulana|ms)$/.test(s)) return 'M';
  if (/^(f|female|ke|girl|g|msichana)$/.test(s)) return 'F';
  return null;
}
// Day scholar or boarder (2026-11-26). Empty = not set. The fees use it (routes/fees.js).
function residenceOf(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (/^(d|day|day scholar|day scholars|day pupil|mchana|day school)$/.test(s)) return 'day';
  if (/^(b|boarding|boarder|boarders|boarding school|bweni|wa bweni)$/.test(s)) return 'boarding';
  return null;
}
const RESIDENCE = { day: 'Day scholar', boarding: 'Boarding' };
const { phoneOf } = G;
const admOf = (v) => String(v ?? '').trim().replace(/\.0+$/, '').replace(/\s+/g, '').toUpperCase();

// Check one student. Returns { data, errors: [], warnings: [] }. Never throws.
function checkStudent(b) {
  const errors = [], warnings = [];
  const data = {
    admission_no: admOf(b.admissionNo),
    first_name: nameText(b.firstName), middle_name: nameText(b.middleName) || null, last_name: nameText(b.lastName),
    sex: sexOf(b.sex), note: String(b.note ?? '').trim().slice(0, 200) || null,
  };
  if (!data.admission_no) errors.push('Admission No. is empty.');
  else if (!/^[A-Z0-9/-]{1,20}$/.test(data.admission_no)) errors.push(`Admission No. "${b.admissionNo}" has wrong characters.`);
  if (!data.first_name) errors.push('First name is empty.');
  if (!data.last_name) errors.push('Last name is empty.');
  if (!data.sex) errors.push(String(b.sex ?? '').trim() ? `Sex "${b.sex}" is not known. Use M or F.` : 'Sex is empty (M or F).');
  // Residence is optional. Only a known value is kept in data, so an empty cell never erases what is saved.
  const res = residenceOf(b.residence);
  if (res) data.residence = res;
  else if (String(b.residence ?? '').trim()) errors.push(`Day or boarding "${b.residence}" is not known. Write Day or Boarding.`);
  for (const k of ['first_name', 'middle_name', 'last_name']) if (data[k] && data[k].length > 40) errors.push('A name is too long.');
  data.full_name = [data.first_name, data.middle_name, data.last_name].filter(Boolean).join(' ');
  return { data, errors, warnings };
}

// ---------- Classes ----------
// Classes come from the levels built into the system (lib/levels.js). The Academic Master of the school (and the
// Super Admin) adds a level with its stream(s) and sets the curriculum; nobody types class names (2026-11-20).
// Old classes typed by hand before this keep working; if their level was not found, the Academic Master picks it.
const { levelsFor, levelOf, CURRICULA } = require('../lib/levels');
const classOut = (c) => ({ id: c.id, schoolId: c.school_id, name: c.name, shortName: c.short_name, stream: c.stream, label: classLabel(c), fullName: classFull(c), active: c.active,
  level: c.level, curriculum: c.curriculum || levelOf(c.level)?.curriculum || null,
  curriculumLabel: CURRICULA[c.curriculum || levelOf(c.level)?.curriculum] || null,
  students: Number(c.students || 0), boys: Number(c.boys || 0), girls: Number(c.girls || 0), boarders: Number(c.boarders || 0), dayScholars: Number(c.day_scholars || 0) });

const schoolCode = async (schoolId) => (await db('schools').where({ id: schoolId }).first('code'))?.code;
async function classList(schoolId) {
  const order = levelsFor(await schoolCode(schoolId)).map((l) => l.key);
  const rank = (c) => (order.indexOf(c.level) < 0 ? 999 : order.indexOf(c.level));
  const rows = await db('classes as c').where('c.school_id', schoolId)
    .leftJoin('students as s', (j) => j.on('s.class_id', 'c.id').andOn(db.raw("s.status = 'active'")))
    .groupBy('c.id')
    .select('c.*', db.raw('count(s.id) as students'), db.raw("count(s.id) filter (where s.sex='M') as boys"), db.raw("count(s.id) filter (where s.sex='F') as girls"),
      db.raw("count(s.id) filter (where s.residence='boarding') as boarders"), db.raw("count(s.id) filter (where s.residence='day') as day_scholars"));
  return rows.sort((a, b) => rank(a) - rank(b) || byShort(a, b)).map(classOut);
}

router.get('/classes', requirePage('students'), async (req, res) => {
  const schoolId = await schoolOf(req);
  res.json({ classes: await classList(schoolId),
    levels: levelsFor(await schoolCode(schoolId)).map((l) => ({ key: l.key, name: l.name, shortName: l.short, curriculum: l.curriculum })),
    curricula: CURRICULA });
});

const keep = (v) => up(v).replace(/[^A-Z0-9' .()/-]/g, '').replace(/\s+/g, ' ').trim();
async function readLevel(schoolId, key) {
  const l = levelOf(String(key || '').toUpperCase());
  if (!l || !levelsFor(await schoolCode(schoolId)).includes(l)) throw new HttpError(400, 'Choose the class from the list.');
  return l;
}
function readCurriculum(v, level) {
  if (v === undefined || v === null || v === '') return level?.curriculum || null;
  if (!CURRICULA[v]) throw new HttpError(400, 'Choose the curriculum: 2027, 2026 and before, or the school\'s own.');
  return v;
}
// The same class twice (same level, or same name, with the same stream) is refused.
async function sameClass(schoolId, c, notId) {
  const q = db('classes').where({ school_id: schoolId })
    .where((w) => { if (c.level) w.where('level', c.level); w.orWhereRaw('lower(name) = lower(?)', [c.name]).orWhereRaw('lower(short_name) = lower(?)', [c.short_name]); })
    .whereRaw("lower(coalesce(stream,'')) = lower(?)", [c.stream || '']);
  if (notId) q.whereNot('id', notId);
  return q.first();
}

// Add a level with one or more streams at once: { level: 'F1', streams: ['A', 'B'] } (no streams = one class).
router.post('/classes', requirePage('classlist', 'f'), async (req, res) => {
  const b = req.body || {};
  const schoolId = await schoolOf(req, b.schoolId);
  const l = await readLevel(schoolId, b.level);
  const curriculum = readCurriculum(b.curriculum, l);
  const streams = [...new Set((Array.isArray(b.streams) ? b.streams : [b.stream]).map((x) => keep(x) || null))];
  if (streams.length > 12) throw new HttpError(400, 'At most 12 streams at once.');
  if (streams.length > 1 && streams.some((x) => !x)) throw new HttpError(400, 'Add the class first. Streams are made inside the class (Create streams).');
  if (streams.some((x) => x && x.length > 30)) throw new HttpError(400, 'A stream name is too long.');
  const made = await db.transaction(async (trx) => {
    const rows = [];
    for (const stream of streams) {
      const c = { level: l.key, name: l.name, short_name: l.short, stream, curriculum };
      const twin = await sameClass(schoolId, c);
      if (twin) throw new HttpError(409, `${classFull(twin)} (${classLabel(twin)}) already exists.`);
      const [row] = await trx('classes').insert({ ...c, school_id: schoolId, created_by: req.user.id }).returning('*');
      rows.push(row);
    }
    return rows;
  });
  await audit(req, 'class.create', `Added ${made.map((r) => classLabel(r)).join(', ')} (${CURRICULA[curriculum] || 'curriculum not set'})`,
    { schoolId, detail: { classIds: made.map((r) => r.id) } });
  res.status(201).json({ classes: made.map(classOut), class: classOut(made[0]) });
});

router.patch('/classes/:id', requirePage('classlist', 'f'), async (req, res) => {
  const cls = await db('classes').where({ id: Number(req.params.id) }).first();
  if (!cls || (!allSchools(req.user) && cls.school_id !== req.user.school_id)) throw new HttpError(404, 'Class not found.');
  const b = req.body || {};
  // The level can be chosen only for an old class that has none (typed before the built-in list).
  let l = levelOf(cls.level);
  if (b.level !== undefined && b.level !== cls.level) {
    if (cls.level) throw new HttpError(400, 'The class level cannot be changed. Add the right class and move the students.');
    l = await readLevel(cls.school_id, b.level);
  }
  const stream = b.stream !== undefined ? keep(b.stream) || null : cls.stream;
  if (stream && stream.length > 30) throw new HttpError(400, 'The stream name is too long.');
  const c = { level: l?.key || null, name: l ? l.name : cls.name, short_name: l ? l.short : cls.short_name, stream,
    curriculum: b.curriculum !== undefined ? readCurriculum(b.curriculum, l) : cls.curriculum || l?.curriculum || null };
  const active = b.active === undefined ? cls.active : !!b.active;
  const twin = await sameClass(cls.school_id, c, cls.id);
  if (twin) throw new HttpError(409, `${classFull(twin)} (${classLabel(twin)}) already exists.`);
  if (!active && cls.active) {
    const [{ n }] = await db('students').where({ class_id: cls.id, status: 'active' }).count('* as n');
    if (Number(n)) throw new HttpError(409, `${classLabel(cls)} still has ${plural(Number(n), 'student')}. Move them to another class first.`);
  }
  const [row] = await db('classes').where({ id: cls.id }).update({ ...c, active, updated_at: db.fn.now() }).returning('*');
  const what = [(classLabel(cls) !== classLabel(row) || classFull(cls) !== classFull(row)) && `now ${classFull(row)} (${classLabel(row)})`,
    (cls.curriculum || null) !== (row.curriculum || null) && `curriculum: ${CURRICULA[row.curriculum] || 'not set'}`,
    cls.active !== active && (active ? 'switched on' : 'switched off')].filter(Boolean);
  if (what.length) await audit(req, 'class.update', `Class ${classLabel(cls)}: ${what.join(', ')}`, { schoolId: cls.school_id, detail: { classId: cls.id } });
  else publish({ topics: ['class'], schoolId: cls.school_id });
  res.json({ class: classOut(row) });
});

// ---------- Students ----------
// Guardians (2026-11-23): only in student_guardians (lib/guardians.js). The screen, the Excel download,
// the bulk editor and the student's page all read the same list.
const COLS = ['s.*', 'c.name as class_name', 'c.short_name as class_short', 'c.stream as class_stream', 'sc.short_name as school_short', 'sc.code as school_code'];
const base = () => db('students as s').leftJoin('classes as c', 'c.id', 's.class_id').join('schools as sc', 'sc.id', 's.school_id');
const out = (s, guardians) => ({
  id: s.id, schoolId: s.school_id, school: s.school_short, schoolCode: s.school_code,
  admissionNo: s.admission_no, firstName: s.first_name, middleName: s.middle_name, lastName: s.last_name,
  fullName: s.full_name, sex: s.sex, sexLabel: SEX[s.sex], residence: s.residence || null, residenceLabel: RESIDENCE[s.residence] || null, classId: s.class_id,
  className: classLabel({ name: s.class_name, short_name: s.class_short, stream: s.class_stream }), classFullName: classFull({ name: s.class_name, stream: s.class_stream }),
  status: s.status, note: s.note, createdAt: s.created_at, updatedAt: s.updated_at,
  ...(guardians ? { guardians: guardians.map(G.out) } : {}),
});
// Students with their guardians (lists, search, Sell).
async function withGuardians(rows) {
  const map = await G.forStudents(db, rows.map((s) => s.id));
  return rows.map((s) => out(s, map.get(s.id) || []));
}

// Words in any order: "neema masanja" finds NEEMA JOHN MASANJA. A number finds the admission number,
// or the student of a guardian with that phone (0754123456 or the last digits, at least 6).
function search(q, text) {
  const words = up(text).split(' ').filter(Boolean).slice(0, 5);
  for (const w of words) {
    const digits = w.replace(/\D/g, '');
    q.where((x) => {
      x.whereRaw('lower(s.full_name) like ?', [`%${w.toLowerCase()}%`]).orWhereRaw('lower(s.admission_no) = ?', [w.toLowerCase()]);
      if (digits.length >= 6 && digits === w) x.orWhereExists(db('student_guardians as gx').whereRaw('gx.student_id = s.id').andWhere('gx.phone', 'like', `%${digits.slice(-9)}`));
    });
  }
  return q;
}

router.get('/', requirePage('students'), async (req, res) => {
  const schoolId = await schoolOf(req);
  const { q, status = 'active', sex, residence } = req.query;
  const cls = req.query.class;
  const query = base().where('s.school_id', schoolId);
  if (cls === 'none') query.whereNull('s.class_id');
  else if (cls) query.where('s.class_id', Number(cls));
  if (status !== 'all') query.where('s.status', status === 'left' ? 'left' : 'active');
  if (sex === 'M' || sex === 'F') query.where('s.sex', sex);
  if (residence === 'day' || residence === 'boarding') query.where('s.residence', residence);
  else if (residence === 'none') query.whereNull('s.residence');
  if (req.query.guardians === 'none') query.whereNotExists(db('student_guardians as gx').whereRaw('gx.student_id = s.id'));
  if (q) search(query, q);
  const rows = await query.orderBy('s.full_name').limit(3000).select(COLS);
  res.json({ students: await withGuardians(rows) });
});

// The picker used by other screens (e.g. Sell). Own school, active students, best matches first.
router.get('/search', async (req, res) => {
  if (!pageAccess(req.user.role, 'students') && !pageAccess(req.user.role, 'sell')) throw new HttpError(403, 'Your account is not allowed to do this.');
  const text = String(req.query.q || '').trim();
  if (!text) return res.json({ students: [] });
  const schoolId = await schoolOf(req);
  const query = search(base().where('s.school_id', schoolId).where('s.status', 'active'), text);
  const first = up(text).split(' ')[0].toLowerCase();
  const rows = await query
    .orderByRaw('CASE WHEN lower(s.admission_no) = ? THEN 0 WHEN lower(s.full_name) LIKE ? THEN 1 ELSE 2 END', [first, `${first}%`])
    .orderBy('s.full_name').limit(12).select(COLS);
  res.json({ students: await withGuardians(rows) });
});

// ---------- Excel: download a class list, the template ----------
// The download and the upload use the SAME columns, so a downloaded list can be edited in Excel and uploaded back.
// Guardians: as many "Guardian N Name / Phone / Relationship" groups as needed (Guardian 1, 2, 3, 4, 5 ...).
const BASE_COLUMNS = [
  { header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'Admission No.', key: 'adm', width: 14 },
  { header: 'First name', key: 'first', width: 16 }, { header: 'Middle name', key: 'middle', width: 16 }, { header: 'Last name', key: 'last', width: 16 },
  { header: 'Sex', key: 'sex', width: 6 }, { header: 'Day or Boarding', key: 'residence', width: 16 },
];
const guardianColumns = (n) => Array.from({ length: n }, (_, i) => [
  { header: `Guardian ${i + 1} Name`, key: `g${i + 1}name`, width: 28 },
  { header: `Guardian ${i + 1} Phone`, key: `g${i + 1}phone`, width: 14 },
  { header: `Guardian ${i + 1} Relationship`, key: `g${i + 1}rel`, width: 14 },
]).flat();
const HOW = [
  'One file for ONE class. On the Students page choose the class, then upload the file.',
  'Columns: Admission No., First name, Middle name, Last name, Sex, Day or Boarding, then the guardians. Other columns (fees, PREM number ...) are ignored.',
  'Guardians: Guardian 1 Name, Guardian 1 Phone, Guardian 1 Relationship, then Guardian 2 ..., Guardian 3 ... For more guardians add Guardian 4, Guardian 5 ... columns the same way. There is no limit.',
  'Every new student needs at least one guardian. Leave the extra guardian columns empty when a student has fewer guardians.',
  'Guardian name: the real names, at least two, e.g. JOHN MATHIAS or GRACE TIBAIJUKA. Not "Mr John", "Mrs Grace", "Mama Simon".',
  `Relationship: ${G.RELATIONS.map((r) => G.LABEL[r]).join(', ')}.`,
  'Phone: 10 digits starting 06 or 07 (0754 123 456). Format the phone columns as Text so Excel keeps the 0.',
  'One phone is one person: if a guardian has several children at school, write the same name and phone on each child.',
  'Admission No.: needed for every student. It is the student\'s number in the system.',
  'Sex: M or F.',
  'Day or Boarding: write Day or Boarding (also accepted: Day scholar, Boarder, D, B). Optional. An empty cell never erases what is saved.',
  'A student already in the system (same Admission No.) is updated, or moved to this class. Empty cells never erase what is saved.',
  'If you fill any guardian column for a student already in the system, the whole guardian list of that student is replaced by the list in the file.',
  'Bulk edit with Excel: download the students (one class or the whole school), change anything, then upload with "Many classes". Each row goes to the class in its Class column (e.g. P 1 A). Write Left in the Status column for a student who left school.',
  'To erase a middle name write a dash (-) in the Middle name cell.',
  'After upload a review page opens. Mistakes are shown in red with the row number. Nothing is saved until you press Approve.',
];

router.get('/export.xlsx', requirePage('students'), async (req, res) => {
  const schoolId = await schoolOf(req);
  const query = base().where('s.school_id', schoolId);
  if (req.query.class === 'none') query.whereNull('s.class_id');
  else if (req.query.class) query.where('s.class_id', Number(req.query.class));
  if (req.query.status !== 'all') query.where('s.status', req.query.status === 'left' ? 'left' : 'active');
  if (req.query.sex === 'M' || req.query.sex === 'F') query.where('s.sex', req.query.sex);
  if (req.query.q) search(query, req.query.q);
  // Same order as the screen: by name (the screen and the file must match).
  const rows = await query.orderBy('s.full_name').select(COLS);
  const cls = req.query.class && req.query.class !== 'none' ? await db('classes').where({ id: Number(req.query.class), school_id: schoolId }).first() : null;
  const gmap = await G.forStudents(db, rows.map((s) => s.id));
  const n = Math.max(2, ...rows.map((s) => (gmap.get(s.id) || []).length));
  await sendExcel(res, `musabe-students${cls ? `-${classLabel(cls).replace(/\W+/g, '-')}` : ''}`, [{
    name: 'Students', title: `Musabe Schools: ${cls ? classLabel(cls) : 'students'} (${rows[0]?.school_short || ''})`,
    columns: [...BASE_COLUMNS, ...guardianColumns(n), { header: 'Class', key: 'cls', width: 10 }, { header: 'Status', key: 'status', width: 9 }],
    notes: HOW,
    rows: rows.map((s, i) => {
      const r = { sn: i + 1, adm: s.admission_no, first: s.first_name, middle: s.middle_name, last: s.last_name, sex: s.sex, residence: RESIDENCE[s.residence] || '',
        cls: classLabel({ name: s.class_name, short_name: s.class_short, stream: s.class_stream }), status: s.status === 'left' ? 'Left' : 'Active' };
      (gmap.get(s.id) || []).forEach((g, k) => { r[`g${k + 1}name`] = g.full_name; r[`g${k + 1}phone`] = g.phone; r[`g${k + 1}rel`] = G.LABEL[g.relationship] || g.relationship; });
      return r;
    }),
  }]);
});

router.get('/template.xlsx', requirePage('students', 'f'), async (req, res) => {
  await sendExcel(res, 'musabe-class-list-template', [{ name: 'Class list', title: 'Musabe Schools: class list. One file for one class.', columns: [...BASE_COLUMNS, ...guardianColumns(3)], rows: [], notes: HOW }]);
});

// ---------- Load a class list from Excel: upload -> review -> approve ----------
// Columns are found by their names, so the school's own files work (fee columns are ignored).
// Guardian columns: "Guardian 1 Name", "Guardian 2 Phone", "Guardian 12 Relationship" ... any number.
// Old school files with one "Parent's name" + "Contacts" column: that parent is read as a guardian.
function columnOf(h) {
  const t = h.toLowerCase().replace(/[’'.]/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const g = t.match(/^(?:guardian|parent|mzazi)\s*(\d{1,2})\s*[-_/:]?\s*(name|full name|names|jina|phone|phone no|phone number|contact|contacts|mobile|tel|simu|relationship|relation|uhusiano)$/);
  if (g) {
    const field = /name|jina/.test(g[2]) ? 'Name' : /phone|contact|mobile|tel|simu/.test(g[2]) ? 'Phone' : 'Rel';
    return `g:${Number(g[1])}:${field}`;
  }
  if (/admission|^adm\b|^reg/.test(t)) return 'admissionNo';
  if (/first/.test(t)) return 'firstName';
  if (/mid+le|^mid\b|second name/.test(t)) return 'middleName';
  if (/last|surname/.test(t)) return 'lastName';
  if (/^(sex|gender|jinsia)$/.test(t)) return 'sex';
  if (/^(day or boarding|day\/boarding|day boarding|day or boarder|residence|boarding status|boarding|boarder|day scholar|aina ya mwanafunzi)$/.test(t)) return 'residence';
  if (/^(class|darasa|class name|stream|class and stream)$/.test(t)) return 'className';
  if (/^(status|hali)$/.test(t)) return 'status';
  if (/relationship|relation|uhusiano/.test(t)) return 'parentRel';
  if (/contact|phone|simu|mobile|tel/.test(t)) return 'parentPhone';
  if (/parent|guardian|mzazi/.test(t)) return 'parentName';
  if (/^(name|full name|names|pupils name|students name|student name|jina)$/.test(t)) return 'fullName';
  return null;
}

// The guardians written on one Excel row, in order.
function rowGuardians(get, cols) {
  const list = [];
  if (cols.parentName !== undefined || cols.parentPhone !== undefined) {
    list.push({ fullName: get('parentName'), phone: get('parentPhone'), relationship: get('parentRel') || 'guardian', old: true });
  }
  const numbers = [...new Set(Object.keys(cols).filter((k) => k.startsWith('g:')).map((k) => Number(k.split(':')[1])))].sort((a, b) => a - b);
  for (const n of numbers) list.push({ fullName: get(`g:${n}:Name`), phone: get(`g:${n}:Phone`), relationship: get(`g:${n}:Rel`) });
  return list.filter((g) => String(g.fullName).trim() || String(g.phone).trim() || (!g.old && String(g.relationship).trim()));
}

// Class written in a cell ("P 1 A", "p1a", "PRIMARY ONE A") -> the class of the school.
const classKey = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// classId = null: a "many classes" file (bulk edit). Each row's class comes from its Class column.
// fixes: corrections typed on the review page, by Excel row number (they win over the cells of that row);
// { skip: true } leaves the row out.
async function checkFile(buffer, schoolId, classId, fixes = {}) {
  const { rows: raw, sheet, sheets } = await readRows(buffer);
  // Header: the first row near the top that names the student's name columns.
  let head = null, cols = {};
  for (const r of raw.slice(0, 15)) {
    const map = {};
    r.cells.forEach((c, i) => { const k = columnOf(c); if (k && map[k] === undefined) map[k] = i; });
    if ((map.firstName !== undefined && map.lastName !== undefined) || map.fullName !== undefined) { head = r.row; cols = map; break; }
  }
  if (!head) throw new HttpError(400, 'Could not find the name columns. The file needs columns like "First name", "Middle name", "Last name" (or one "Name" column), "Sex" and "Admission No.". Download the template to see.');
  if (cols.admissionNo === undefined) throw new HttpError(400, 'The file has no "Admission No." column. Every student needs one.');
  if (cols.sex === undefined) throw new HttpError(400, 'The file has no "Sex" column (M or F).');

  const many = !classId;
  const cls = many ? null : await db('classes').where({ id: classId, school_id: schoolId }).first();
  if (!many && !cls) throw new HttpError(404, 'Class not found.');
  if (many && cols.className === undefined) throw new HttpError(400, 'For many classes the file needs a "Class" column (e.g. P 1 A). Download the students from the system to get it, or choose one class.');
  const allClasses = await db('classes').where({ school_id: schoolId });
  const classByKey = new Map();
  for (const c of allClasses) for (const k of [classLabel(c), classFull(c), [c.level, c.stream].filter(Boolean).join(' ')]) if (k && !classByKey.has(classKey(k))) classByKey.set(classKey(k), c);
  const existing = await db('students as s').leftJoin('classes as c', 'c.id', 's.class_id').where('s.school_id', schoolId)
    .select('s.*', 'c.name as class_name', 'c.short_name as class_short', 'c.stream as class_stream');
  const byAdm = new Map(existing.map((s) => [s.admission_no.toLowerCase(), s]));
  const byName = new Map(existing.map((s) => [s.full_name, s]));
  const savedG = await G.forStudents(db, existing.map((s) => s.id));
  // One phone = one person: names already saved in the school for each phone.
  const phoneName = new Map();
  for (const [sid, list] of savedG) for (const g of list) if (!phoneName.has(g.phone)) phoneName.set(g.phone, { name: g.full_name, sid });

  const lines = [], seen = new Map(), filePhone = new Map();
  let prevLast = null;
  for (const r of raw.filter((x) => x.row > head)) {
    const fix = fixes[r.row] || null;
    const cell = (k) => (cols[k] === undefined ? '' : r.cells[cols[k]] || '');
    const get = (k) => (fix && !fix.skip && fix[k] !== undefined ? String(fix[k] ?? '') : cell(k));
    const input = { admissionNo: get('admissionNo'), sex: get('sex'), residence: get('residence') };
    const eraseMiddle = String(get('middleName')).trim() === '-' || (fix && !fix.skip && fix.middleName === '' && !!cell('middleName'));
    if (fix && !fix.skip) Object.assign(input, { firstName: get('firstName'), middleName: get('middleName'), lastName: get('lastName') });
    else if (cols.fullName !== undefined && cols.firstName === undefined) {
      const w = nameText(get('fullName')).split(' ').filter(Boolean);
      Object.assign(input, { firstName: w[0] || '', middleName: w.slice(1, -1).join(' '), lastName: w.length > 1 ? w[w.length - 1] : '' });
    } else Object.assign(input, { firstName: get('firstName'), middleName: get('middleName'), lastName: get('lastName') });
    // Empty rows and rows like "." at the end are skipped.
    if (!nameText(input.firstName) && !nameText(input.lastName) && !admOf(input.admissionNo)) continue;
    // What the row says, to fill the "Fix" form on the review page.
    const typedIn = { ...input, middleName: eraseMiddle ? '' : input.middleName, className: get('className'), status: get('status'),
      guardians: fix && !fix.skip && fix.guardians ? fix.guardians : rowGuardians(cell, cols).map(({ old, ...g }) => g) }; // eslint-disable-line no-unused-vars
    if (fix?.skip) {
      lines.push({ row: r.row, admissionNo: admOf(input.admissionNo), fullName: [input.firstName, input.middleName, input.lastName].map(nameText).filter(Boolean).join(' '),
        sex: sexOf(input.sex), className: '', guardians: [], change: 'Skipped', from: '', errors: [], warnings: [], skipped: true, fixed: true, input: typedIn });
      continue;
    }

    const { data, errors, warnings } = checkStudent(input);
    // Class of this row: the chosen class, or (many classes) the Class column.
    let rowCls = cls;
    if (many) {
      const typedCls = String(get('className')).trim();
      rowCls = typedCls ? classByKey.get(classKey(typedCls)) : null;
      if (typedCls && !rowCls) errors.push(`Class "${typedCls}" is not a class of this school. Write it like ${classLabel(allClasses.find((c) => c.active) || { short_name: 'P 1' })}.`);
      else if (rowCls && !rowCls.active) errors.push(`${classLabel(rowCls)} is switched off.`);
    }
    const st = String(get('status')).trim().toLowerCase();
    const leftNow = /^(left|left school|ameondoka|ameacha)$/.test(st);
    if (st && !leftNow && !/^(active|at school|yupo)$/.test(st)) errors.push(`Status "${get('status')}" is not known. Write Active or Left.`);
    const typed = fix && fix.guardians ? fix.guardians : rowGuardians(cell, cols);
    const gc = G.check(typed);
    errors.push(...gc.errors);
    const guardians = gc.list;
    const line = { row: r.row, admissionNo: data.admission_no, fullName: data.full_name, sex: data.sex, residence: data.residence || '', className: rowCls ? classLabel(rowCls) : '',
      guardians: guardians.map((g) => ({ fullName: g.full_name, phone: g.phone, relationship: g.relationship, relationshipLabel: G.LABEL[g.relationship] })),
      change: '', from: '', errors, warnings, data, fixed: !!fix, input: typedIn };
    if (data.admission_no) {
      const key = data.admission_no.toLowerCase();
      if (seen.has(key)) errors.push(`Admission No. ${data.admission_no} is also on row ${seen.get(key)}.`);
      else seen.set(key, r.row);
    }
    // Rows shifted by one: the first guardian's name belongs to the student on the row above.
    const own = [data.last_name, data.middle_name, data.first_name].filter(Boolean);
    const pw = (guardians[0]?.full_name || '').split(' ');
    line.shifted = !!(prevLast && guardians[0] && pw.includes(prevLast) && !own.some((n) => pw.includes(n)));
    prevLast = data.last_name || null;

    const old = data.admission_no && byAdm.get(data.admission_no.toLowerCase());
    // One phone = one person, inside the file and against what is saved (other students).
    for (const g of guardians) {
      const inFile = filePhone.get(g.phone);
      if (inFile && inFile.name !== g.full_name) warnings.push(`Phone ${g.phone} is ${inFile.name} on row ${inFile.row}, but ${g.full_name} here. One phone should be one person.`);
      else if (!inFile) filePhone.set(g.phone, { name: g.full_name, row: r.row });
      const saved = phoneName.get(g.phone);
      if (!inFile && saved && saved.name !== g.full_name && (!old || saved.sid !== old.id)) warnings.push(`Phone ${g.phone} is saved as ${saved.name} for another student, here it is ${g.full_name}.`);
    }

    if (!errors.length) {
      if (!old) {
        line.change = 'New';
        line.classId = rowCls?.id;
        if (!rowCls) errors.push('Write the class of this new student in the Class column.');
        if (leftNow) errors.push('A new student cannot be "Left". Remove the row or write Active.');
        if (!guardians.length) errors.push('No guardian. Every new student needs at least one guardian (name, phone, relationship).');
        const twin = byName.get(data.full_name);
        if (twin) warnings.push(`${data.full_name} is already in the system with Admission No. ${twin.admission_no}. Is this the same student?`);
      } else {
        // Empty cells never erase what is saved.
        const diff = ['first_name', 'middle_name', 'last_name', 'sex', 'residence'].filter((k) => data[k] && String(data[k]) !== String(old[k] ?? ''));
        if (eraseMiddle && old.middle_name) { data.middle_name = null; diff.push('middle_name'); }
        const before = savedG.get(old.id) || [];
        const gChanged = guardians.length > 0 && !G.same(before, guardians);
        line.diff = [...diff.map((k) => FIELD_LABEL[k]), ...(gChanged ? ['guardians'] : [])];
        line.id = old.id;
        const toCls = rowCls || (old.class_id ? { id: old.class_id } : null);
        line.set = { class_id: toCls?.id ?? null, status: leftNow ? 'left' : 'active' };
        if (!toCls && !leftNow) warnings.push('This student has no class. Write the class in the Class column.');
        for (const k of diff) line.set[k] = data[k];
        if (gChanged) { line.newGuardians = guardians; line.oldGuardians = before.map((g) => g.full_name); }
        const nm = { first: data.first_name || old.first_name, middle: eraseMiddle ? null : data.middle_name || old.middle_name, last: data.last_name || old.last_name };
        line.set.full_name = [nm.first, nm.middle, nm.last].filter(Boolean).join(' ');
        if (leftNow) line.change = old.status === 'left' ? (line.diff.length ? 'Update' : 'No change') : 'Left school';
        else if (old.status === 'left') line.change = 'Back at school';
        else if (toCls && old.class_id !== toCls.id) { line.change = 'Move'; line.from = classLabel({ name: old.class_name, short_name: old.class_short, stream: old.class_stream }) || 'no class'; }
        else line.change = line.diff.length ? 'Update' : 'No change';
        if (old.full_name !== data.full_name) warnings.push(`Saved name is ${old.full_name}.`);
        if (!guardians.length && !before.length) warnings.push('No guardian saved for this student. Add at least one.');
      }
    }
    lines.push(line);
  }
  if (!lines.length) throw new HttpError(400, 'The file has no students under the header row.');
  if (lines.length > (many ? 6000 : 1500)) throw new HttpError(400, many ? 'Too many rows (more than 6000). Split the file.' : 'Too many rows for one class (more than 1500).');
  // A real shift moves every row below it, so only runs of 3+ such rows next to each other count
  // (a mother whose surname is the surname of the child above is not a shift).
  for (let i = 0; i < lines.length;) {
    let j = i; while (j < lines.length && lines[j].shifted) j++;
    if (j - i < 3) for (let k = i; k < j; k++) lines[k].shifted = false;
    i = Math.max(j, i + 1);
  }
  const shifted = lines.filter((l) => l.shifted);
  if (shifted.length >= 3) for (const l of shifted) l.warnings.push("Guardian's name looks like it belongs to the student on the row above. Check the Sex and Guardian columns: they may have moved one row down.");
  const count = (c) => lines.filter((l) => !l.errors.length && l.change === c).length;
  const summary = {
    rows: lines.length, errors: lines.filter((l) => l.errors.length).length,
    errorRows: lines.filter((l) => l.errors.length).map((l) => l.row), warnings: lines.filter((l) => l.warnings.length).length,
    skipped: lines.filter((l) => l.skipped).length, fixed: lines.filter((l) => l.fixed && !l.skipped).length,
    new: count('New'), update: count('Update'), move: count('Move'), back: count('Back at school'), left: count('Left school'), same: count('No change'), many,
    boys: lines.filter((l) => l.sex === 'M').length, girls: lines.filter((l) => l.sex === 'F').length,
    guardians: lines.reduce((n, l) => n + l.guardians.length, 0), maxGuardians: Math.max(0, ...lines.map((l) => l.guardians.length)),
    shifted: shifted.length >= 3 ? shifted.length : 0, className: many ? 'Many classes' : classLabel(cls), sheet, otherSheets: sheets.filter((n) => n !== sheet),
  };
  summary.changes = summary.new + summary.update + summary.move + summary.back + summary.left;
  return { lines, summary, cls };
}

const IMPORT_COLS = ['m.id', 'm.school_id', 'm.class_id', 'm.file_name', 'm.status', 'm.summary', 'm.created_at', 'm.decided_at', 'm.uploaded_by',
  'u.full_name as uploaded_by_name', 'd.full_name as decided_by_name', 'c.name as class_name', 'c.short_name as class_short', 'c.stream as class_stream'];
const importQuery = () => db('student_imports as m').join('users as u', 'u.id', 'm.uploaded_by').leftJoin('users as d', 'd.id', 'm.decided_by')
  .leftJoin('classes as c', 'c.id', 'm.class_id');
const importOut = (m, user) => ({ id: m.id, schoolId: m.school_id, classId: m.class_id,
  className: m.class_id ? classLabel({ name: m.class_name, short_name: m.class_short, stream: m.class_stream }) : 'Many classes',
  fileName: m.file_name, status: m.status, summary: m.summary, createdAt: m.created_at, decidedAt: m.decided_at,
  uploadedBy: m.uploaded_by_name, decidedBy: m.decided_by_name, mine: m.uploaded_by === user.id });
async function getImport(req) {
  const m = await importQuery().where('m.id', Number(req.params.id)).first(IMPORT_COLS);
  if (!m || (!allSchools(req.user) && m.school_id !== req.user.school_id)) throw new HttpError(404, 'This upload was not found.');
  return m;
}

router.post('/imports', requirePage('students', 'f'), uploadLimit, express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
  const schoolId = await schoolOf(req);
  // ?class=many: a file with the Class column (bulk edit of many classes, or the whole school).
  const cls = req.query.class === 'many' ? null : await checkClass(req.query.class, schoolId);
  if (!cls && req.query.class !== 'many') throw new HttpError(400, 'Choose the class first (or "Many classes").');
  const { summary } = await checkFile(req.body, schoolId, cls?.id || null);
  let rawName = req.get('X-File-Name') || 'class-list.xlsx';
  try { rawName = decodeURIComponent(rawName); } catch { /* keep as sent */ }
  const fileName = String(rawName).replace(/[^\w .()-]/g, '_').slice(0, 200);
  const [{ id }] = await db('student_imports').insert({ school_id: schoolId, class_id: cls?.id || null, file_name: fileName, file: req.body, uploaded_by: req.user.id, summary: JSON.stringify(summary) }).returning('id');
  publish({ topics: ['studentimport'], schoolId });
  res.status(201).json({ id });
});

router.get('/imports', requirePage('students'), async (req, res) => {
  const schoolId = await schoolOf(req);
  const pending = await importQuery().where({ 'm.school_id': schoolId, 'm.status': 'pending' }).orderBy('m.created_at', 'desc').select(IMPORT_COLS);
  const recent = await importQuery().where('m.school_id', schoolId).whereNot('m.status', 'pending').orderBy('m.decided_at', 'desc').limit(10).select(IMPORT_COLS);
  res.json({ pending: pending.map((m) => importOut(m, req.user)), recent: recent.map((m) => importOut(m, req.user)) });
});

router.get('/imports/:id', requirePage('students'), async (req, res) => {
  const m = await getImport(req);
  if (m.status !== 'pending') return res.json({ upload: importOut(m, req.user), lines: [], summary: m.summary });
  const { file, fixes } = await db('student_imports').where({ id: m.id }).first('file', 'fixes');
  const { lines, summary } = await checkFile(file, m.school_id, m.class_id, fixes || {}); // checked again: shows what would change today
  res.json({ upload: importOut(m, req.user), lines: lines.map(({ data, set, newGuardians, ...l }) => l), summary }); // eslint-disable-line no-unused-vars
});

router.post('/imports/:id/approve', requirePage('students', 'f'), async (req, res) => {
  const m = await getImport(req);
  if (m.status !== 'pending') throw new HttpError(409, `This upload was already ${m.status}.`);
  const { file, fixes } = await db('student_imports').where({ id: m.id }).first('file', 'fixes');
  const { lines, summary } = await checkFile(file, m.school_id, m.class_id, fixes || {});
  // Rows with mistakes: fix them on this page, or save the good rows and leave the wrong ones out (skipMistakes).
  if (summary.errors && !req.body?.skipMistakes) throw new HttpError(400, `${plural(summary.errors, 'row')} still ${summary.errors === 1 ? 'has a mistake' : 'have mistakes'}. Fix ${summary.errors === 1 ? 'it' : 'them'} with "Fix", or save the good rows and leave ${summary.errors === 1 ? 'it' : 'them'} out.`);
  if (!summary.changes) throw new HttpError(400, 'Nothing to save: every good row is already saved like this.');
  // Rows left out are kept in the summary, so they can be downloaded as Excel, fixed and uploaded later.
  summary.leftOut = lines.filter((l) => l.errors.length || l.skipped).map((l) => ({ row: l.row, admissionNo: l.admissionNo, fullName: l.fullName,
    reason: l.skipped ? 'Skipped on the review page' : l.errors.join(' '), input: l.input }));
  if (summary.shifted && !req.body?.checkedShifted)
    throw new HttpError(400, `${summary.shifted} rows look moved one row down (Sex and Guardian columns). Check the file, or tick that you checked it.`);
  await db.transaction(async (trx) => {
    const n = await trx('student_imports').where({ id: m.id, status: 'pending' })
      .update({ status: 'approved', decided_at: trx.fn.now(), decided_by: req.user.id, summary: JSON.stringify(summary) });
    if (!n) throw new HttpError(409, 'This upload was already approved or discarded.');
    for (const l of lines) {
      if (l.change === 'No change' || l.skipped || l.errors.length) continue;
      const d = l.data;
      if (l.change === 'New') {
        const [student] = await trx('students').insert({ ...d, school_id: m.school_id, class_id: l.classId, import_id: m.id, created_by: req.user.id, updated_by: req.user.id }).returning('id');
        await G.save(trx, { studentId: student.id, schoolId: m.school_id, userId: req.user.id, list: l.guardians.map((g) => ({ full_name: g.fullName, phone: g.phone, relationship: g.relationship })) });
      } else {
        await trx('students').where({ id: l.id, school_id: m.school_id }).update({ ...l.set, updated_by: req.user.id, updated_at: trx.fn.now() });
        if (l.newGuardians) await G.save(trx, { studentId: l.id, schoolId: m.school_id, userId: req.user.id, list: l.newGuardians.map((g) => ({ ...g, id: null })) });
      }
    }
    const parts = [summary.new && `${summary.new} new`, summary.update && `${summary.update} updated`, summary.move && `${summary.move} moved${summary.many ? '' : ' here'}`,
      summary.back && `${summary.back} back at school`, summary.left && `${summary.left} left school`,
      summary.leftOut.length && `${summary.leftOut.length} row${summary.leftOut.length === 1 ? '' : 's'} left out`, summary.fixed && `${summary.fixed} fixed on the review page`].filter(Boolean);
    await audit(req, 'student.import', `${summary.many ? 'Excel bulk edit' : `Loaded ${summary.className}`} from ${m.file_name}: ${parts.join(', ')}`,
      { schoolId: m.school_id, detail: { importId: m.id, classId: m.class_id, studentIds: lines.filter((l) => l.id && l.change !== 'No change').map((l) => l.id) } }, trx);
    publish({ topics: ['studentimport', 'student'], schoolId: m.school_id }, trx);
  });
  res.json({ ok: true, summary });
});

// Fix one row of a waiting upload (or skip it, or undo the fix). The Excel file itself is not changed.
// Body: { skip: true } | { undo: true } | { admissionNo, firstName, middleName, lastName, sex, className, status, guardians: [...] }
router.put('/imports/:id/rows/:row', requirePage('students', 'f'), async (req, res) => {
  const m = await getImport(req);
  if (m.status !== 'pending') throw new HttpError(409, `This upload was already ${m.status}.`);
  const row = Number(req.params.row);
  if (!Number.isInteger(row) || row < 1) throw new HttpError(400, 'Wrong row.');
  const b = req.body || {};
  const fixes = { ...((await db('student_imports').where({ id: m.id }).first('fixes')).fixes || {}) };
  const str = (v, n) => String(v ?? '').slice(0, n);
  if (b.undo) delete fixes[row];
  else if (b.skip) fixes[row] = { skip: true };
  else {
    if (b.guardians !== undefined && !Array.isArray(b.guardians)) throw new HttpError(400, 'Guardians must be a list.');
    fixes[row] = { admissionNo: str(b.admissionNo, 30), firstName: str(b.firstName, 60), middleName: str(b.middleName, 60), lastName: str(b.lastName, 60),
      sex: str(b.sex, 10), residence: str(b.residence, 20), className: str(b.className, 40), status: str(b.status, 20),
      guardians: (b.guardians || []).slice(0, G.MAX).map((g) => ({ fullName: str(g.fullName, 120), phone: str(g.phone, 20), relationship: str(g.relationship, 20) })) };
  }
  await db('student_imports').where({ id: m.id, status: 'pending' }).update({ fixes: JSON.stringify(fixes) });
  publish({ topics: ['studentimport'], schoolId: m.school_id });
  const { file } = await db('student_imports').where({ id: m.id }).first('file');
  const { lines, summary } = await checkFile(file, m.school_id, m.class_id, fixes);
  const line = lines.find((l) => l.row === row);
  if (!line && !b.undo) throw new HttpError(404, `Row ${row} is not a student row of this file.`);
  res.json({ line: line ? (({ data, set, newGuardians, ...l }) => l)(line) : null, summary }); // eslint-disable-line no-unused-vars
});

// Rows left out when an upload was approved: an Excel file with the same columns, to fix and upload again.
router.get('/imports/:id/left-out.xlsx', requirePage('students'), async (req, res) => {
  const m = await getImport(req);
  const rows = m.summary?.leftOut || [];
  if (!rows.length) throw new HttpError(404, 'No rows were left out of this upload.');
  const n = Math.max(2, ...rows.map((r) => (r.input?.guardians || []).length));
  await sendExcel(res, `musabe-left-out-rows-${m.id}`, [{
    name: 'Students', columns: [...BASE_COLUMNS, ...guardianColumns(n), { header: 'Class', key: 'cls', width: 10 }, { header: 'Status', key: 'status', width: 9 }, { header: 'Why left out', key: 'why', width: 60 }],
    notes: HOW,
    rows: rows.map((r, i) => {
      const x = r.input || {};
      const o = { sn: i + 1, adm: x.admissionNo, first: x.firstName, middle: x.middleName, last: x.lastName, sex: x.sex, residence: x.residence || '',
        cls: x.className || (m.class_id ? importOut(m, req.user).className : ''), status: x.status, why: `Row ${r.row}: ${r.reason}` };
      (x.guardians || []).forEach((g, k) => { o[`g${k + 1}name`] = g.fullName; o[`g${k + 1}phone`] = g.phone; o[`g${k + 1}rel`] = g.relationship; });
      return o;
    }),
  }]);
});

router.post('/imports/:id/discard', requirePage('students', 'f'), async (req, res) => {
  const m = await getImport(req);
  if (m.status !== 'pending') throw new HttpError(409, `This upload was already ${m.status}.`);
  await db('student_imports').where({ id: m.id, status: 'pending' }).update({ status: 'discarded', decided_at: db.fn.now(), decided_by: req.user.id });
  publish({ topics: ['studentimport'], schoolId: m.school_id });
  res.json({ ok: true });
});

// Move many students at once: to another class (end of year, new streams), or mark them as left school.
router.post('/move', requirePage('students', 'f'), async (req, res) => {
  const b = req.body || {};
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw new HttpError(400, 'Tick the students to move.');
  if (ids.length > 3000) throw new HttpError(400, 'Too many students at once.');
  const rows = await db('students').whereIn('id', ids);
  if (rows.length !== ids.length) throw new HttpError(404, 'Some students were not found. Reload the page.');
  const schoolId = rows[0].school_id;
  if (rows.some((r) => r.school_id !== schoolId) || (!allSchools(req.user) && schoolId !== req.user.school_id))
    throw new HttpError(403, 'You can only move students of your own school.');
  const left = !!b.left;
  const to = left ? null : await checkClass(b.classId, schoolId);
  if (!left && !to) throw new HttpError(400, 'Choose the class to move them to.');
  const from = [...new Set(rows.map((r) => r.class_id))];
  const fromLabel = (await db('classes').whereIn('id', from.filter(Boolean))).map(classLabel).join(', ') || 'no class';
  await db.transaction(async (trx) => {
    await trx('students').whereIn('id', ids).update(left
      ? { status: 'left', updated_by: req.user.id, updated_at: trx.fn.now() }
      : { class_id: to.id, status: 'active', updated_by: req.user.id, updated_at: trx.fn.now() });
    await audit(req, left ? 'student.left' : 'student.move',
      left ? `Marked ${plural(ids.length, 'student')} of ${fromLabel} as left school` : `Moved ${plural(ids.length, 'student')} from ${fromLabel} to ${classLabel(to)}`,
      { schoolId, detail: { studentIds: ids, classId: to?.id ?? null } }, trx);
  });
  res.json({ ok: true, moved: ids.length });
});

// ---------- Bulk edit (many students on one screen) ----------
// Body: { rows: [{ id, admissionNo, firstName, middleName, lastName, sex, classId, guardians: [...] }] }.
// Every row is checked first. If any row has a mistake nothing is saved and the mistakes come back per row.
router.post('/bulk', requirePage('students', 'f'), async (req, res) => {
  const input = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!input.length) throw new HttpError(400, 'Nothing to save.');
  if (input.length > 1000) throw new HttpError(400, 'At most 1000 students at once.');
  const ids = input.map((r) => Number(r.id));
  if (ids.some((x) => !Number.isInteger(x)) || new Set(ids).size !== ids.length) throw new HttpError(400, 'Each student may be in the list once. Reload the page.');
  const saved = await db('students').whereIn('id', ids);
  if (saved.length !== ids.length) throw new HttpError(404, 'Some students were not found. Reload the page.');
  const schoolId = saved[0].school_id;
  if (saved.some((s) => s.school_id !== schoolId) || (!allSchools(req.user) && schoolId !== req.user.school_id))
    throw new HttpError(403, 'You can only edit students of your own school.');
  const byId = new Map(saved.map((s) => [s.id, s]));
  const oldG = await G.forStudents(db, ids);
  const classes = new Map((await db('classes').where({ school_id: schoolId })).map((c) => [c.id, c]));
  const problems = [], work = [];
  const admSeen = new Map();
  for (const r of input) {
    const s = byId.get(Number(r.id));
    const errors = [];
    const { data, errors: e1 } = checkStudent({
      admissionNo: r.admissionNo ?? s.admission_no, firstName: r.firstName ?? s.first_name,
      middleName: r.middleName !== undefined ? r.middleName : s.middle_name, lastName: r.lastName ?? s.last_name, sex: r.sex ?? s.sex, residence: r.residence !== undefined ? r.residence : s.residence, note: s.note,
    });
    errors.push(...e1);
    if (r.classId !== undefined && r.classId !== null && r.classId !== '') {
      const c = classes.get(Number(r.classId));
      if (!c) errors.push('Choose a class of this school.');
      else if (!c.active && c.id !== s.class_id) errors.push(`${classLabel(c)} is switched off.`);
      else data.class_id = c.id;
    }
    let list = null;
    if (r.guardians !== undefined) {
      const gc = G.check(r.guardians);
      errors.push(...gc.errors);
      list = gc.list;
      if (!gc.errors.length && !list.length) errors.push('At least one guardian is needed.');
    }
    const key = data.admission_no.toLowerCase();
    if (admSeen.has(key)) errors.push(`Admission No. ${data.admission_no} is also given to ${admSeen.get(key)}.`);
    admSeen.set(key, data.full_name);
    if (errors.length) { problems.push({ id: s.id, name: s.full_name, errors }); continue; }
    const changed = ['admission_no', 'first_name', 'middle_name', 'last_name', 'sex', 'residence', 'class_id'].filter((k) => k in data && String(data[k] ?? '') !== String(s[k] ?? ''));
    const gChanged = list && !G.same(oldG.get(s.id) || [], list);
    if (changed.length || gChanged) work.push({ s, data, changed, list: gChanged ? list : null });
  }
  // Admission numbers must stay unique in the school.
  for (const w of work.filter((x) => x.changed.includes('admission_no'))) {
    const t = await db('students').where({ school_id: schoolId }).whereRaw('lower(admission_no) = lower(?)', [w.data.admission_no]).whereNotIn('id', ids).first('full_name');
    if (t) problems.push({ id: w.s.id, name: w.s.full_name, errors: [`Admission No. ${w.data.admission_no} is already used by ${t.full_name}.`] });
  }
  if (problems.length) {
    const e = new HttpError(400, `${plural(problems.length, 'student')} ${problems.length === 1 ? 'has' : 'have'} mistakes. Nothing was saved.`);
    e.extra = { rows: problems };
    throw e;
  }
  if (!work.length) return res.json({ ok: true, saved: 0 });
  const warnings = [];
  for (const w of work) if (w.list) warnings.push(...(await G.samePerson(db, schoolId, w.list, ids)).map((t) => `${w.data.full_name}: ${t}`));
  await db.transaction(async (trx) => {
    // Admission numbers swapped between two students: free them first.
    for (const w of work.filter((x) => x.changed.includes('admission_no'))) await trx('students').where({ id: w.s.id }).update({ admission_no: `~${w.s.id}` });
    for (const w of work) {
      const set = { updated_by: req.user.id, updated_at: trx.fn.now() };
      for (const k of w.changed) set[k] = w.data[k];
      if (w.changed.some((k) => /name/.test(k))) set.full_name = w.data.full_name;
      if (w.changed.includes('admission_no')) set.admission_no = w.data.admission_no;
      await trx('students').where({ id: w.s.id }).update(set);
      if (w.list) await G.save(trx, { studentId: w.s.id, schoolId, userId: req.user.id, list: w.list });
      const what = [...w.changed.map((k) => FIELD_LABEL[k]), ...(w.list ? [`guardians: ${G.text(w.list)}`] : [])];
      await audit(req, 'student.update', `Bulk edit: changed ${what.join(', ')} for ${w.data.full_name} (${w.data.admission_no})`, { schoolId, detail: { studentId: w.s.id } }, trx);
    }
  });
  res.json({ ok: true, saved: work.length, warnings: warnings.slice(0, 50) });
});

// Last, so /classes, /search, /imports ... are matched first.
// ---------- One student ----------
async function getStudent(req) {
  if (!/^\d+$/.test(req.params.id)) throw new HttpError(404, 'Not found.');
  const s = await base().where('s.id', Number(req.params.id)).first(COLS);
  if (!s || (!allSchools(req.user) && s.school_id !== req.user.school_id)) throw new HttpError(404, 'Student not found.');
  return s;
}

router.get('/:id', requirePage('students'), async (req, res) => {
  const s = await getStudent(req);
  const [by, receipts, history, imp, mates, gmap] = await Promise.all([
    db('users').whereIn('id', [s.created_by, s.updated_by].filter(Boolean)).select('id', 'full_name'),
    db('receipts as r').where('r.student_id', s.id).orderBy('r.sold_at', 'desc').limit(50)
      .select('r.id', 'r.number', 'r.total', 'r.status', 'r.sold_at', 'r.method',
        db.raw(`(SELECT string_agg(l.qty || ' × ' || l.item_name, ', ' ORDER BY l.id) FROM receipt_lines l WHERE l.receipt_id = r.id) as items`)),
    db('audit_log as a').leftJoin('users as u', 'u.id', 'a.user_id')
      .whereRaw(`a.detail ->> 'studentId' = ?`, [String(s.id)]).orWhere((w) => w.whereRaw(`a.detail -> 'studentIds' @> ?::jsonb`, [JSON.stringify([s.id])]))
      .orderBy('a.at', 'desc').limit(50).select('a.id', 'a.at', 'a.action', 'a.summary', 'u.full_name as by'),
    s.import_id ? db('student_imports as m').join('users as u', 'u.id', 'm.uploaded_by').where('m.id', s.import_id).first('m.file_name', 'm.decided_at', 'u.full_name as by') : null,
    // Previous / next student in the same class (by name), to go through a class one by one.
    s.class_id ? db('students').where({ class_id: s.class_id, status: s.status }).orderBy('full_name').orderBy('id').select('id', 'full_name') : [],
    G.forStudents(db, [s.id]),
  ]);
  const guardians = gmap.get(s.id) || [];
  // Brothers and sisters: other students with a guardian of the same phone.
  const phones = guardians.map((g) => g.phone);
  const siblings = phones.length ? await db('student_guardians as g').join('students as x', 'x.id', 'g.student_id').leftJoin('classes as c', 'c.id', 'x.class_id')
    .whereIn('g.phone', phones).whereNot('x.id', s.id).where('x.school_id', s.school_id)
    .distinct('x.id', 'x.full_name', 'x.status', 'c.name as class_name', 'c.short_name as class_short', 'c.stream as class_stream').orderBy('x.full_name') : [];
  const iv = s.interview_id ? await db('admission_interviews').where({ id: s.interview_id }).first() : null;
  const name = (id) => by.find((u) => u.id === id)?.full_name || null;
  const at = mates.findIndex((m) => m.id === s.id);
  res.json({
    student: { ...out(s, guardians), createdBy: name(s.created_by), updatedBy: name(s.updated_by),
      addedFrom: imp ? { fileName: imp.file_name, at: imp.decided_at, by: imp.by } : null,
      interview: iv ? require('./interviews').ivOut(iv) : null },
    siblings: siblings.map((x) => ({ id: x.id, fullName: x.full_name, status: x.status, className: classLabel({ name: x.class_name, short_name: x.class_short, stream: x.class_stream }) })),
    receipts: receipts.map((r) => ({ id: r.id, number: r.number, total: r.total, status: r.status, soldAt: r.sold_at, method: r.method, items: r.items })),
    history: history.map((h) => ({ id: h.id, at: h.at, action: h.action, summary: h.summary, by: h.by })),
    place: at < 0 ? null : { index: at + 1, of: mates.length, prev: mates[at - 1] || null, next: mates[at + 1] || null },
  });
});

async function checkClass(classId, schoolId) {
  if (classId == null || classId === '') return null;
  const c = await db('classes').where({ id: Number(classId), school_id: schoolId }).first();
  if (!c) throw new HttpError(400, 'Choose a class of this school.');
  if (!c.active) throw new HttpError(400, `${classLabel(c)} is switched off.`);
  return c;
}
async function admTaken(schoolId, adm, notId) {
  const q = db('students').where({ school_id: schoolId }).whereRaw('lower(admission_no) = lower(?)', [adm]);
  if (notId) q.whereNot('id', notId);
  return q.first('full_name');
}

router.post('/', requirePage('students', 'f'), async (req, res) => {
  const b = req.body || {};
  const schoolId = await schoolOf(req, b.schoolId);
  const { data, errors } = checkStudent(b);
  if (errors.length) throw new HttpError(400, errors[0]);
  const list = G.clean(b.guardians || []).map((g) => ({ ...g, id: null }));
  if (!list.length) throw new HttpError(400, 'Add at least one guardian (full names, phone, relationship).');
  const cls = await checkClass(b.classId, schoolId);
  if (!cls) throw new HttpError(400, 'Choose the class.');
  const taken = await admTaken(schoolId, data.admission_no);
  if (taken) throw new HttpError(409, `Admission No. ${data.admission_no} is already used by ${taken.full_name}.`);
  // Registered from an admission interview (2026-11-20): the interview stays linked for follow-up.
  let iv = null;
  if (b.interviewId) {
    iv = await db('admission_interviews').where({ id: Number(b.interviewId), school_id: schoolId }).first();
    if (!iv) throw new HttpError(404, 'Admission interview not found for this school.');
    if (iv.student_id) throw new HttpError(409, `${iv.full_name} is already registered as a student.`);
  }
  const warnings = await G.samePerson(db, schoolId, list);
  const row = await db.transaction(async (trx) => {
    const [r] = await trx('students').insert({ ...data, school_id: schoolId, class_id: cls.id, interview_id: iv?.id || null, created_by: req.user.id, updated_by: req.user.id }).returning('id');
    if (iv) await trx('admission_interviews').where({ id: iv.id }).update({ student_id: r.id, updated_at: db.fn.now() });
    await G.save(trx, { studentId: r.id, schoolId, userId: req.user.id, list });
    await audit(req, 'student.create', `Added student ${data.full_name} (${data.admission_no}) to ${classLabel(cls)}${iv ? ' from the admission interview' : ''}. Guardians: ${G.text(list)}`,
      { schoolId, detail: { studentId: r.id, interviewId: iv?.id } }, trx);
    return r;
  });
  const s = await base().where('s.id', row.id).first(COLS);
  res.status(201).json({ student: (await withGuardians([s]))[0], warnings });
});

const FIELD_LABEL = { admission_no: 'admission no.', first_name: 'first name', middle_name: 'middle name', last_name: 'last name',
  sex: 'sex', residence: 'day or boarding', note: 'note', class_id: 'class', status: 'status' };

router.patch('/:id/guardians/:guardianId/verify', async (req, res) => {
  if (!['sadmin', 'head', 'acad', 'teacher', 'super'].includes(req.user.role)) throw new HttpError(403, 'Only school staff can verify guardians.');
  const s = await getStudent(req);
  const g = await db('student_guardians').where({ id: Number(req.params.guardianId), student_id: s.id }).first();
  if (!g) throw new HttpError(404, 'Guardian not found.');
  const method = String(req.body?.verificationMethod || '').trim().slice(0, 120);
  const note = String(req.body?.verificationNote || '').trim().slice(0, 300);
  if (!method) throw new HttpError(400, 'Record the verification method, for example phone call by school staff.');
  await db('student_guardians').where({ id: g.id }).update({ verified: true, verification_method: method,
    verification_note: note || null, verified_by: req.user.id, verified_at: db.fn.now(), updated_by: req.user.id, updated_at: db.fn.now() });
  await audit(req, 'student.guardian', `Verified guardian ${g.full_name} (${g.phone}) for ${s.full_name}: ${method}`,
    { schoolId: s.school_id, detail: { studentId: s.id, guardianId: g.id } });
  const row = (await G.forStudents(db, [s.id])).get(s.id).find((x) => x.id === g.id);
  res.json({ guardian: G.out(row) });
});

router.patch('/:id', requirePage('students', 'f'), async (req, res) => {
  const s = await getStudent(req);
  const b = req.body || {};
  const merged = {
    admissionNo: b.admissionNo ?? s.admission_no,
    firstName: b.firstName ?? s.first_name, middleName: b.middleName !== undefined ? b.middleName : s.middle_name, lastName: b.lastName ?? s.last_name,
    sex: b.sex ?? s.sex, residence: b.residence !== undefined ? b.residence : s.residence, note: b.note !== undefined ? b.note : s.note,
  };
  const { data, errors } = checkStudent(merged);
  if (errors.length) throw new HttpError(400, errors[0]);
  if (b.classId !== undefined) data.class_id = (await checkClass(b.classId, s.school_id))?.id ?? null;
  if (b.status !== undefined) data.status = b.status === 'left' ? 'left' : 'active';
  if (data.status === 'active' && !(data.class_id ?? s.class_id)) throw new HttpError(400, 'Choose the class.');
  const taken = await admTaken(s.school_id, data.admission_no, s.id);
  if (taken) throw new HttpError(409, `Admission No. ${data.admission_no} is already used by ${taken.full_name}.`);
  let list = null;
  if (b.guardians !== undefined) {
    list = G.clean(b.guardians);
    if (!list.length) throw new HttpError(400, 'Keep at least one guardian.');
    if (G.same((await G.forStudents(db, [s.id])).get(s.id) || [], list)) list = null;
  }
  const changed = Object.keys(data).filter((k) => FIELD_LABEL[k] && String(data[k] ?? '') !== String(s[k] ?? ''));
  const warnings = list ? await G.samePerson(db, s.school_id, list, [s.id]) : [];
  if (changed.length || list) {
    await db.transaction(async (trx) => {
      if (changed.length) await trx('students').where({ id: s.id }).update({ ...data, updated_by: req.user.id, updated_at: trx.fn.now() });
      else await trx('students').where({ id: s.id }).update({ updated_by: req.user.id, updated_at: trx.fn.now() });
      if (list) await G.save(trx, { studentId: s.id, schoolId: s.school_id, userId: req.user.id, list });
      const action = changed.includes('status') ? (data.status === 'left' ? 'student.left' : 'student.back') : changed.includes('class_id') ? 'student.move' : 'student.update';
      const what = [...changed.map((k) => FIELD_LABEL[k]), ...(list ? [`guardians: ${G.text(list)}`] : [])];
      await audit(req, action, `Changed ${what.join(', ')} for ${data.full_name} (${data.admission_no})`, { schoolId: s.school_id, detail: { studentId: s.id } }, trx);
    });
  }
  const row = await base().where('s.id', s.id).first(COLS);
  res.json({ student: (await withGuardians([row]))[0], warnings });
});

module.exports = router;
module.exports.classLabel = classLabel;
module.exports.clean = { nameText, sexOf, phoneOf, up };
