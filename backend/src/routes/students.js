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
const GUARDIAN_RELATIONS = ['mother', 'father', 'brother', 'sister', 'guardian', 'other'];

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
// Phone: any way it is written in Excel -> 0754123456. 754123456 (lost 0), 255754123456, 0754-123456 all work.
function phoneOf(v) {
  let d = String(v ?? '').replace(/\.0+$/, '').replace(/\D/g, '');
  if (!d) return { phone: null };
  if (d.startsWith('255') && d.length === 12) d = `0${d.slice(3)}`;
  if (d.length === 9 && /^[67]/.test(d)) d = `0${d}`;
  if (/^0[67]\d{8}$/.test(d)) return { phone: d };
  return { phone: null, bad: String(v).trim() };
}
const admOf = (v) => String(v ?? '').trim().replace(/\.0+$/, '').replace(/\s+/g, '').toUpperCase();

// Check one student. Returns { data, errors: [], warnings: [] }. Never throws.
function checkStudent(b) {
  const errors = [], warnings = [];
  const data = {
    admission_no: admOf(b.admissionNo),
    first_name: nameText(b.firstName), middle_name: nameText(b.middleName) || null, last_name: nameText(b.lastName),
    sex: sexOf(b.sex), parent_name: up(b.parentName).replace(/[^A-Z0-9' .-]/g, '').trim() || null, note: String(b.note ?? '').trim().slice(0, 200) || null,
  };
  if (!data.admission_no) errors.push('Admission No. is empty.');
  else if (!/^[A-Z0-9/-]{1,20}$/.test(data.admission_no)) errors.push(`Admission No. "${b.admissionNo}" has wrong characters.`);
  if (!data.first_name) errors.push('First name is empty.');
  if (!data.last_name) errors.push('Last name is empty.');
  if (!data.sex) errors.push(String(b.sex ?? '').trim() ? `Sex "${b.sex}" is not known. Use M or F.` : 'Sex is empty (M or F).');
  const p = phoneOf(b.parentPhone);
  data.parent_phone = p.phone;
  if (p.bad) warnings.push(`Phone "${p.bad}" is not a correct mobile number (10 digits, 06/07). Saved without phone.`);
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
  students: Number(c.students || 0), boys: Number(c.boys || 0), girls: Number(c.girls || 0) });

const schoolCode = async (schoolId) => (await db('schools').where({ id: schoolId }).first('code'))?.code;
async function classList(schoolId) {
  const order = levelsFor(await schoolCode(schoolId)).map((l) => l.key);
  const rank = (c) => (order.indexOf(c.level) < 0 ? 999 : order.indexOf(c.level));
  const rows = await db('classes as c').where('c.school_id', schoolId)
    .leftJoin('students as s', (j) => j.on('s.class_id', 'c.id').andOn(db.raw("s.status = 'active'")))
    .groupBy('c.id')
    .select('c.*', db.raw('count(s.id) as students'), db.raw("count(s.id) filter (where s.sex='M') as boys"), db.raw("count(s.id) filter (where s.sex='F') as girls"));
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
  if (!CURRICULA[v]) throw new HttpError(400, 'Choose the curriculum: new, old or the school\'s own.');
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
  if (streams.some((x) => !x)) throw new HttpError(400, 'Fixed classes are created by the system. Add a named stream, for example A or PINK.');
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
const COLS = ['s.*', 'c.name as class_name', 'c.short_name as class_short', 'c.stream as class_stream', 'sc.short_name as school_short', 'sc.code as school_code'];
const base = () => db('students as s').leftJoin('classes as c', 'c.id', 's.class_id').join('schools as sc', 'sc.id', 's.school_id');
const out = (s) => ({
  id: s.id, schoolId: s.school_id, school: s.school_short, schoolCode: s.school_code,
  admissionNo: s.admission_no, firstName: s.first_name, middleName: s.middle_name, lastName: s.last_name,
  fullName: s.full_name, sex: s.sex, sexLabel: SEX[s.sex], classId: s.class_id,
  className: classLabel({ name: s.class_name, short_name: s.class_short, stream: s.class_stream }), classFullName: classFull({ name: s.class_name, stream: s.class_stream }),
  parentName: s.parent_name, parentPhone: s.parent_phone, status: s.status, note: s.note, createdAt: s.created_at, updatedAt: s.updated_at,
});

// Words in any order: "neema masanja" finds NEEMA JOHN MASANJA. A number finds the admission number.
function search(q, text) {
  const words = up(text).split(' ').filter(Boolean).slice(0, 5);
  for (const w of words) {
    q.where((x) => x.whereRaw('lower(s.full_name) like ?', [`%${w.toLowerCase()}%`])
      .orWhereRaw('lower(s.admission_no) = ?', [w.toLowerCase()]));
  }
  return q;
}

router.get('/', requirePage('students'), async (req, res) => {
  const schoolId = await schoolOf(req);
  const { q, status = 'active', sex } = req.query;
  const cls = req.query.class;
  const query = base().where('s.school_id', schoolId);
  if (cls === 'none') query.whereNull('s.class_id');
  else if (cls) query.where('s.class_id', Number(cls));
  if (status !== 'all') query.where('s.status', status === 'left' ? 'left' : 'active');
  if (sex === 'M' || sex === 'F') query.where('s.sex', sex);
  if (q) search(query, q);
  const rows = await query.orderBy('s.full_name').limit(2000).select(COLS);
  res.json({ students: rows.map(out) });
});

function guardianOut(g, byName) {
  return { id: g.id, fullName: g.full_name, phone: g.phone, relationship: g.relationship,
    verified: g.verified, verificationMethod: g.verification_method, verificationNote: g.verification_note,
    verifiedBy: g.verified_by_name || byName?.(g.verified_by) || null, verifiedAt: g.verified_at,
    createdAt: g.created_at, updatedAt: g.updated_at };
}

function cleanGuardians(input, schoolId, studentId) {
  if (input === undefined) return null;
  if (!Array.isArray(input)) throw new HttpError(400, 'Guardians must be a list.');
  if (input.length > 10) throw new HttpError(400, 'At most 10 guardians can be recorded for a student.');
  const ids = new Set();
  return input.map((g, i) => {
    const fullName = nameText(g.fullName); const phone = phoneOf(g.phone).phone;
    const relationship = String(g.relationship || '').trim().toLowerCase();
    if (!fullName) throw new HttpError(400, `Guardian ${i + 1}: full name is required.`);
    if (!phone) throw new HttpError(400, `Guardian ${i + 1}: phone must be 10 digits starting with 06 or 07.`);
    if (!GUARDIAN_RELATIONS.includes(relationship)) throw new HttpError(400, `Guardian ${i + 1}: choose a valid relationship.`);
    if (g.id != null) {
      const id = Number(g.id); if (!Number.isInteger(id)) throw new HttpError(400, 'Invalid guardian id.'); ids.add(id);
    }
    return { id: g.id != null ? Number(g.id) : null, full_name: fullName, phone, relationship,
      school_id: schoolId, student_id: studentId,
      ...(g.verificationMethod !== undefined ? { verification_method: String(g.verificationMethod || '').trim().slice(0, 120) || null } : {}),
      ...(g.verificationNote !== undefined ? { verification_note: String(g.verificationNote || '').trim().slice(0, 300) || null } : {}) };
  });
}

async function replaceGuardians(trx, studentId, schoolId, userId, guardians) {
  if (guardians === null) return;
  const existing = await trx('student_guardians').where({ student_id: studentId, school_id: schoolId }).select('id');
  const allowed = new Set(existing.map((g) => g.id));
  if (guardians.some((g) => g.id != null && !allowed.has(g.id))) throw new HttpError(400, 'Guardian does not belong to this student.');
  const keep = new Set(guardians.filter((g) => g.id != null).map((g) => g.id));
  await trx('student_guardians').where({ student_id: studentId, school_id: schoolId }).whereNotIn('id', [...keep]).del();
  for (const g of guardians) {
    const values = { full_name: g.full_name, phone: g.phone, relationship: g.relationship,
      updated_by: userId, updated_at: trx.fn.now() };
    if (g.verification_method !== undefined) values.verification_method = g.verification_method;
    if (g.verification_note !== undefined) values.verification_note = g.verification_note;
    if (g.id != null) await trx('student_guardians').where({ id: g.id, student_id: studentId, school_id: schoolId }).update(values);
    else await trx('student_guardians').insert({ ...values, student_id: studentId, school_id: schoolId, created_by: userId });
  }
}

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
  res.json({ students: rows.map(out) });
});

// ---------- Excel: download a class list, the template, the sample ----------
const LIST_COLUMNS = [
  { header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'Admission No.', key: 'adm', width: 14 },
  { header: 'First name', key: 'first', width: 16 },
  { header: 'Middle name', key: 'middle', width: 16 }, { header: 'Last name', key: 'last', width: 16 },
  { header: 'Sex', key: 'sex', width: 6 }, { header: "Parent/guardian", key: 'parent', width: 28 }, { header: 'Parent phone', key: 'phone', width: 14 },
  { header: 'Guardian 1 Name', key: 'g1name', width: 28 }, { header: 'Guardian 1 Phone', key: 'g1phone', width: 14 }, { header: 'Guardian 1 Relationship', key: 'g1relationship', width: 16 },
  { header: 'Guardian 2 Name', key: 'g2name', width: 28 }, { header: 'Guardian 2 Phone', key: 'g2phone', width: 14 }, { header: 'Guardian 2 Relationship', key: 'g2relationship', width: 16 },
  { header: 'Guardian 3 Name', key: 'g3name', width: 28 }, { header: 'Guardian 3 Phone', key: 'g3phone', width: 14 }, { header: 'Guardian 3 Relationship', key: 'g3relationship', width: 16 },
];
const HOW = [
  'One file for ONE class. On the Students page choose the class, then upload the file.',
  'Your own class list works as it is: the system finds Admission No., First/Middle/Last name, Sex, and the legacy Parent/guardian + Parent phone or Contacts columns. Other columns (fees, PREM number ...) are ignored.',
  'Additional guardians: use repeatable columns Guardian 1 Name, Guardian 1 Phone, Guardian 1 Relationship; Guardian 2 ... and Guardian 3 ... are also accepted. A structured format uses "Guardians" or "Guardian 1" with values "Full Name, 07..., relationship" separated by semicolons.',
  'Guardian relationship values: mother, father, brother, sister, guardian, or other. Names may be written as "Guardian 1 Name"; phone aliases include Guardian 1 Phone, Contact, Mobile, or Tel.',
  'Admission No.: needed for every student. It is the student\'s number in the system.',
  'Sex: M or F.  Phone: 10 digits starting 06 or 07 (0754 123 456). A wrong phone is not saved, but the student is.',
  'A student already in the system (same Admission No.) is updated, or moved to this class. Empty cells never erase what is saved.',
  'After upload a review page opens. Mistakes are shown in red with the row number. Nothing is saved until you press Approve.',
];

router.get('/export.xlsx', requirePage('students'), async (req, res) => {
  const schoolId = await schoolOf(req);
  const query = base().where('s.school_id', schoolId);
  if (req.query.class) query.where('s.class_id', Number(req.query.class));
  if (req.query.status !== 'all') query.where('s.status', req.query.status === 'left' ? 'left' : 'active');
  const rows = (await query.orderBy('s.full_name').select(COLS))
    .sort((a, b) => byShort({ short_name: a.class_short, stream: a.class_stream }, { short_name: b.class_short, stream: b.class_stream }));
  const cls = req.query.class ? await db('classes').where({ id: Number(req.query.class) }).first() : null;
  const guardianRows = await db('student_guardians').whereIn('student_id', rows.map((s) => s.id)).orderBy('student_id').orderBy('id');
  const guardiansByStudent = new Map();
  for (const g of guardianRows) {
    if (!guardiansByStudent.has(g.student_id)) guardiansByStudent.set(g.student_id, []);
    guardiansByStudent.get(g.student_id).push(g);
  }
  await sendExcel(res, `musabe-students${cls ? `-${classLabel(cls).replace(/\W+/g, '-')}` : ''}`, [{
    name: 'Students', title: `Musabe Schools: ${cls ? classLabel(cls) : 'students'} (${rows[0]?.school_short || ''})`,
    columns: [...LIST_COLUMNS, { header: 'Class', key: 'cls', width: 16 }, { header: 'Status', key: 'status', width: 9 }],
    rows: rows.map((s, i) => {
      const gs = guardiansByStudent.get(s.id) || [];
      const g = (n) => gs[n - 1] || {};
      return { sn: i + 1, adm: s.admission_no, first: s.first_name, middle: s.middle_name, last: s.last_name,
        sex: s.sex, parent: s.parent_name, phone: s.parent_phone,
        g1name: g(1).full_name, g1phone: g(1).phone, g1relationship: g(1).relationship,
        g2name: g(2).full_name, g2phone: g(2).phone, g2relationship: g(2).relationship,
        g3name: g(3).full_name, g3phone: g(3).phone, g3relationship: g(3).relationship,
        cls: classLabel({ name: s.class_name, short_name: s.class_short, stream: s.class_stream }), status: s.status === 'left' ? 'Left' : 'Active' };
    }),
  }]);
});

router.get('/template.xlsx', requirePage('students', 'f'), async (req, res) => {
  await sendExcel(res, 'musabe-class-list-template', [{ name: 'Class list', title: 'Musabe Schools: class list. One file for one class.', columns: LIST_COLUMNS, rows: [], notes: HOW }]);
});

// ---------- Load a class list from Excel: upload -> review -> approve ----------
// Columns are found by their names, so the school's own files work (fee columns are ignored).
function columnOf(h) {
  const t = h.toLowerCase().replace(/[’'.]/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/admission|^adm\b|^reg/.test(t)) return 'admissionNo';
  if (/first/.test(t)) return 'firstName';
  if (/mid+le|^mid\b|second name/.test(t)) return 'middleName';
  if (/last|surname/.test(t)) return 'lastName';
  if (/^(sex|gender|jinsia)$/.test(t)) return 'sex';
  const repeat = t.match(/^(guardian|guardians?)\s*([123])?(?:\s*[-_/])?\s*(name|full name|phone|contact|mobile|tel|relationship|relation|relationship type)$/);
  if (repeat) {
    const n = repeat[2] || '1';
    const field = /name/.test(repeat[3]) ? 'Name' : /phone|contact|mobile|tel/.test(repeat[3]) ? 'Phone' : 'Relationship';
    return `guardian${n}${field}`;
  }
  if (/^guardian\s*([123])\s*(name|phone|relationship)$/i.test(t)) return null;
  if (/^guardians?( data| list| details?)?$/.test(t)) return 'guardiansStructured';
  if (/contact|phone|simu|mobile|tel/.test(t)) return 'parentPhone';
  if (/parent|guardian|mzazi/.test(t)) return 'parentName';
  if (/^(name|full name|names|pupils name|students name|student name|jina)$/.test(t)) return 'fullName';
  return null;
}

async function checkFile(buffer, schoolId, classId) {
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

  const cls = await db('classes').where({ id: classId, school_id: schoolId }).first();
  if (!cls) throw new HttpError(404, 'Class not found.');
  const existing = await db('students as s').leftJoin('classes as c', 'c.id', 's.class_id').where('s.school_id', schoolId)
    .select('s.*', 'c.name as class_name', 'c.short_name as class_short', 'c.stream as class_stream');
  const byAdm = new Map(existing.map((s) => [s.admission_no.toLowerCase(), s]));
  const byName = new Map(existing.map((s) => [s.full_name, s]));

  const lines = [], seen = new Map();
  let prevLast = null;
  for (const r of raw.filter((x) => x.row > head)) {
    const get = (k) => (cols[k] === undefined ? '' : r.cells[cols[k]] || '');
    const input = { admissionNo: get('admissionNo'), sex: get('sex'), parentName: get('parentName'), parentPhone: get('parentPhone') };
    if (cols.fullName !== undefined && cols.firstName === undefined) {
      const w = nameText(get('fullName')).split(' ').filter(Boolean);
      Object.assign(input, { firstName: w[0] || '', middleName: w.slice(1, -1).join(' '), lastName: w.length > 1 ? w[w.length - 1] : '' });
    } else Object.assign(input, { firstName: get('firstName'), middleName: get('middleName'), lastName: get('lastName') });

    const guardians = [];
    for (const n of [1, 2, 3]) {
      const fullName = get(`guardian${n}Name`);
      const phone = get(`guardian${n}Phone`);
      const relationship = get(`guardian${n}Relationship`);
      if (fullName || phone || relationship) guardians.push({ fullName, phone, relationship });
    }
    const structured = get('guardiansStructured');
    if (structured) {
      for (const piece of structured.split(/[;|]/).map((x) => x.trim()).filter(Boolean)) {
        const parts = piece.split(/[,/]/).map((x) => x.trim());
        if (parts.length >= 2) guardians.push({ fullName: parts[0], phone: parts[1], relationship: parts[2] || 'other' });
      }
    }
    // Empty rows and rows like "." at the end are skipped.
    if (!nameText(input.firstName) && !nameText(input.lastName) && !admOf(input.admissionNo)) continue;

    const { data, errors, warnings } = checkStudent(input);
    const cleanedGuardians = [];
    for (let i = 0; i < guardians.length; i++) {
      const g = guardians[i];
      const p = phoneOf(g.phone);
      const rel = String(g.relationship || '').trim().toLowerCase();
      if (!nameText(g.fullName)) { warnings.push(`Guardian ${i + 1}: full name is missing.`); continue; }
      if (!p.phone) { warnings.push(`Guardian ${i + 1} phone "${g.phone}" is not a correct 10-digit 06/07 number. Guardian not saved.`); continue; }
      cleanedGuardians.push({ fullName: nameText(g.fullName), phone: p.phone,
        relationship: GUARDIAN_RELATIONS.includes(rel) ? rel : 'other' });
    }
    const line = { row: r.row, admissionNo: data.admission_no, fullName: data.full_name, sex: data.sex, parentName: data.parent_name,
      parentPhone: data.parent_phone, guardians: cleanedGuardians, change: '', from: '', errors, warnings, data };
    if (data.admission_no) {
      const key = data.admission_no.toLowerCase();
      if (seen.has(key)) errors.push(`Admission No. ${data.admission_no} is also on row ${seen.get(key)}.`);
      else seen.set(key, r.row);
    }
    // Rows shifted by one: the parent's name belongs to the student on the row above.
    const own = [data.last_name, data.middle_name, data.first_name].filter(Boolean);
    const pw = (data.parent_name || '').split(' ');
    line.shifted = !!(prevLast && data.parent_name && pw.includes(prevLast) && !own.some((n) => pw.includes(n)));
    prevLast = data.last_name || null;

    const old = data.admission_no && byAdm.get(data.admission_no.toLowerCase());
    if (!errors.length) {
      if (!old) {
        line.change = 'New';
        const twin = byName.get(data.full_name);
        if (twin) warnings.push(`${data.full_name} is already in the system with Admission No. ${twin.admission_no}. Is this the same student?`);
      } else {
        // Empty cells never erase what is saved.
        const diff = ['first_name', 'middle_name', 'last_name', 'sex', 'parent_name', 'parent_phone']
          .filter((k) => data[k] && String(data[k]) !== String(old[k] ?? ''));
        line.diff = diff.map((k) => FIELD_LABEL[k]);
        line.id = old.id;
        line.set = { class_id: cls.id, status: 'active' };
        for (const k of diff) line.set[k] = data[k];
        const nm = { first: data.first_name || old.first_name, middle: data.middle_name || old.middle_name, last: data.last_name || old.last_name };
        line.set.full_name = [nm.first, nm.middle, nm.last].filter(Boolean).join(' ');
        if (old.status === 'left') line.change = 'Back at school';
        else if (old.class_id !== cls.id) { line.change = 'Move'; line.from = classLabel({ name: old.class_name, short_name: old.class_short, stream: old.class_stream }) || 'no class'; }
        else line.change = diff.length ? 'Update' : 'No change';
        if (old.full_name !== data.full_name) warnings.push(`Saved name is ${old.full_name}.`);
      }
    }
    lines.push(line);
  }
  if (!lines.length) throw new HttpError(400, 'The file has no students under the header row.');
  if (lines.length > 1500) throw new HttpError(400, 'Too many rows for one class (more than 1500).');
  const shifted = lines.filter((l) => l.shifted);
  if (shifted.length >= 3) for (const l of shifted) l.warnings.push("Parent's name looks like it belongs to the student on the row above. Check Sex and Parent columns: they may have moved one row down.");
  const count = (c) => lines.filter((l) => !l.errors.length && l.change === c).length;
  const summary = {
    rows: lines.length, errors: lines.filter((l) => l.errors.length).length, warnings: lines.filter((l) => l.warnings.length).length,
    new: count('New'), update: count('Update'), move: count('Move'), back: count('Back at school'), same: count('No change'),
    boys: lines.filter((l) => l.sex === 'M').length, girls: lines.filter((l) => l.sex === 'F').length,
    shifted: shifted.length >= 3 ? shifted.length : 0, className: classLabel(cls), sheet, otherSheets: sheets.filter((n) => n !== sheet),
  };
  summary.changes = summary.new + summary.update + summary.move + summary.back;
  return { lines, summary, cls };
}

const IMPORT_COLS = ['m.id', 'm.school_id', 'm.class_id', 'm.file_name', 'm.status', 'm.summary', 'm.created_at', 'm.decided_at', 'm.uploaded_by',
  'u.full_name as uploaded_by_name', 'd.full_name as decided_by_name', 'c.name as class_name', 'c.short_name as class_short', 'c.stream as class_stream'];
const importQuery = () => db('student_imports as m').join('users as u', 'u.id', 'm.uploaded_by').leftJoin('users as d', 'd.id', 'm.decided_by')
  .join('classes as c', 'c.id', 'm.class_id');
const importOut = (m, user) => ({ id: m.id, schoolId: m.school_id, classId: m.class_id, className: classLabel({ name: m.class_name, short_name: m.class_short, stream: m.class_stream }),
  fileName: m.file_name, status: m.status, summary: m.summary, createdAt: m.created_at, decidedAt: m.decided_at,
  uploadedBy: m.uploaded_by_name, decidedBy: m.decided_by_name, mine: m.uploaded_by === user.id });
async function getImport(req) {
  const m = await importQuery().where('m.id', Number(req.params.id)).first(IMPORT_COLS);
  if (!m || (!allSchools(req.user) && m.school_id !== req.user.school_id)) throw new HttpError(404, 'This upload was not found.');
  return m;
}

router.post('/imports', requirePage('students', 'f'), uploadLimit, express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
  const schoolId = await schoolOf(req);
  const cls = await checkClass(req.query.class, schoolId);
  if (!cls) throw new HttpError(400, 'Choose the class first.');
  const { summary } = await checkFile(req.body, schoolId, cls.id);
  let rawName = req.get('X-File-Name') || 'class-list.xlsx';
  try { rawName = decodeURIComponent(rawName); } catch { /* keep as sent */ }
  const fileName = String(rawName).replace(/[^\w .()-]/g, '_').slice(0, 200);
  const [{ id }] = await db('student_imports').insert({ school_id: schoolId, class_id: cls.id, file_name: fileName, file: req.body, uploaded_by: req.user.id, summary: JSON.stringify(summary) }).returning('id');
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
  const file = (await db('student_imports').where({ id: m.id }).first('file')).file;
  const { lines, summary } = await checkFile(file, m.school_id, m.class_id); // checked again: shows what would change today
  res.json({ upload: importOut(m, req.user), lines: lines.map(({ data, set, ...l }) => l), summary }); // eslint-disable-line no-unused-vars
});

router.post('/imports/:id/approve', requirePage('students', 'f'), async (req, res) => {
  const m = await getImport(req);
  if (m.status !== 'pending') throw new HttpError(409, `This upload was already ${m.status}.`);
  const file = (await db('student_imports').where({ id: m.id }).first('file')).file;
  const { lines, summary, cls } = await checkFile(file, m.school_id, m.class_id);
  if (summary.errors) throw new HttpError(400, `The file has ${plural(summary.errors, 'mistake')}. Fix them in Excel and upload it again.`);
  if (!summary.changes) throw new HttpError(400, 'Nothing to change: every student in this file is already saved like this.');
  if (summary.shifted && !req.body?.checkedShifted)
    throw new HttpError(400, `${summary.shifted} rows look moved one row down (Sex and Parent columns). Check the file, or tick that you checked it.`);
  await db.transaction(async (trx) => {
    const n = await trx('student_imports').where({ id: m.id, status: 'pending' })
      .update({ status: 'approved', decided_at: trx.fn.now(), decided_by: req.user.id, summary: JSON.stringify(summary) });
    if (!n) throw new HttpError(409, 'This upload was already approved or discarded.');
    for (const l of lines) {
      if (l.change === 'No change') continue;
      const d = l.data;
      if (l.change === 'New') {
        const [student] = await trx('students').insert({ ...d, school_id: m.school_id, class_id: cls.id, import_id: m.id, created_by: req.user.id, updated_by: req.user.id }).returning('id');
        for (const g of l.guardians || []) await trx('student_guardians').insert({ student_id: student.id, school_id: m.school_id,
          full_name: g.fullName, phone: g.phone, relationship: g.relationship, created_by: req.user.id, updated_by: req.user.id });
      } else {
        await trx('students').where({ id: l.id, school_id: m.school_id }).update({ ...l.set, updated_by: req.user.id, updated_at: trx.fn.now() });
        if (l.guardians && l.guardians.length) {
          await trx('student_guardians').where({ student_id: l.id, school_id: m.school_id }).del();
          for (const g of l.guardians) await trx('student_guardians').insert({ student_id: l.id, school_id: m.school_id,
            full_name: g.fullName, phone: g.phone, relationship: g.relationship, created_by: req.user.id, updated_by: req.user.id });
        }
      }
    }
    const parts = [summary.new && `${summary.new} new`, summary.update && `${summary.update} updated`, summary.move && `${summary.move} moved here`, summary.back && `${summary.back} back at school`].filter(Boolean);
    await audit(req, 'student.import', `Loaded ${summary.className} from ${m.file_name}: ${parts.join(', ')}`, { schoolId: m.school_id, detail: { importId: m.id, classId: cls.id } }, trx);
    publish({ topics: ['studentimport'], schoolId: m.school_id }, trx);
  });
  res.json({ ok: true, summary });
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
  if (ids.length > 2000) throw new HttpError(400, 'Too many students at once.');
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
  const [by, receipts, history, imp, mates, guardians] = await Promise.all([
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
    db('student_guardians').leftJoin('users as v', 'v.id', 'student_guardians.verified_by')
      .where('student_guardians.student_id', s.id).orderBy('student_guardians.id')
      .select('student_guardians.*', 'v.full_name as verified_by_name'),
  ]);
  const iv = s.interview_id ? await db('admission_interviews').where({ id: s.interview_id }).first() : null;
  const name = (id) => by.find((u) => u.id === id)?.full_name || null;
  const at = mates.findIndex((m) => m.id === s.id);
  res.json({
    student: { ...out(s), createdBy: name(s.created_by), updatedBy: name(s.updated_by),
      addedFrom: imp ? { fileName: imp.file_name, at: imp.decided_at, by: imp.by } : null,
      guardians: guardians.map((g) => guardianOut(g)),
      interview: iv ? require('./interviews').ivOut(iv) : null },
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
  if (b.parentPhone && !data.parent_phone) throw new HttpError(400, 'Phone must be 10 digits starting with 06 or 07, e.g. 0754 123 456.');
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
  const cleanedGuardians = cleanGuardians(b.guardians, schoolId, 0);
  const row = await db.transaction(async (trx) => {
    const [r] = await trx('students').insert({ ...data, school_id: schoolId, class_id: cls.id, interview_id: iv?.id || null, created_by: req.user.id, updated_by: req.user.id }).returning('id');
    if (iv) await trx('admission_interviews').where({ id: iv.id }).update({ student_id: r.id, updated_at: db.fn.now() });
    if (cleanedGuardians) await replaceGuardians(trx, r.id, schoolId, req.user.id, cleanedGuardians.map((g) => ({ ...g, student_id: r.id })));
    return r;
  });
  await audit(req, 'student.create', `Added student ${data.full_name} (${data.admission_no}) to ${classLabel(cls)}${iv ? ' from the admission interview' : ''}`, { schoolId, detail: { studentId: row.id, interviewId: iv?.id } });
  res.status(201).json({ student: out(await base().where('s.id', row.id).first(COLS)) });
});

const FIELD_LABEL = { admission_no: 'admission no.', first_name: 'first name', middle_name: 'middle name', last_name: 'last name',
  sex: 'sex', parent_name: 'parent', parent_phone: 'phone', note: 'note', class_id: 'class', status: 'status' };

router.patch('/:id/guardians/:guardianId/verify', async (req, res) => {
  if (!['sadmin', 'head', 'acad', 'teacher', 'super'].includes(req.user.role)) throw new HttpError(403, 'Only school staff can verify guardians.');
  const s = await getStudent(req);
  const g = await db('student_guardians').where({ id: Number(req.params.guardianId), student_id: s.id, school_id: s.school_id }).first();
  if (!g) throw new HttpError(404, 'Guardian not found.');
  const method = String(req.body?.verificationMethod || '').trim().slice(0, 120);
  const note = String(req.body?.verificationNote || '').trim().slice(0, 300);
  if (!method) throw new HttpError(400, 'Record the verification method, for example phone call by school staff.');
  await db('student_guardians').where({ id: g.id }).update({ verified: true, verification_method: method,
    verification_note: note || null, verified_by: req.user.id, verified_at: db.fn.now(), updated_by: req.user.id, updated_at: db.fn.now() });
  await audit(req, 'student.guardian.verify', `Verified guardian ${g.full_name} for ${s.full_name} (${method})`,
    { schoolId: s.school_id, detail: { studentId: s.id, guardianId: g.id } });
  const row = await db('student_guardians as g').leftJoin('users as v', 'v.id', 'g.verified_by')
    .where('g.id', g.id).first('g.*', 'v.full_name as verified_by_name');
  res.json({ guardian: guardianOut(row) });
});

router.patch('/:id', requirePage('students', 'f'), async (req, res) => {
  const s = await getStudent(req);
  const b = req.body || {};
  const merged = {
    admissionNo: b.admissionNo ?? s.admission_no,
    firstName: b.firstName ?? s.first_name, middleName: b.middleName !== undefined ? b.middleName : s.middle_name, lastName: b.lastName ?? s.last_name,
    sex: b.sex ?? s.sex, parentName: b.parentName !== undefined ? b.parentName : s.parent_name,
    parentPhone: b.parentPhone !== undefined ? b.parentPhone : s.parent_phone, note: b.note !== undefined ? b.note : s.note,
  };
  const { data, errors } = checkStudent(merged);
  if (errors.length) throw new HttpError(400, errors[0]);
  if (merged.parentPhone && !data.parent_phone) throw new HttpError(400, 'Phone must be 10 digits starting with 06 or 07, e.g. 0754 123 456.');
  if (b.classId !== undefined) data.class_id = (await checkClass(b.classId, s.school_id))?.id ?? null;
  if (b.status !== undefined) data.status = b.status === 'left' ? 'left' : 'active';
  if (data.status === 'active' && !(data.class_id ?? s.class_id)) throw new HttpError(400, 'Choose the class.');
  const taken = await admTaken(s.school_id, data.admission_no, s.id);
  if (taken) throw new HttpError(409, `Admission No. ${data.admission_no} is already used by ${taken.full_name}.`);
  const changed = Object.keys(data).filter((k) => FIELD_LABEL[k] && String(data[k] ?? '') !== String(s[k] ?? ''));
  if (changed.length) {
    await db('students').where({ id: s.id }).update({ ...data, updated_by: req.user.id, updated_at: db.fn.now() });
    const action = changed.includes('status') ? (data.status === 'left' ? 'student.left' : 'student.back') : changed.includes('class_id') ? 'student.move' : 'student.update';
    await audit(req, action, `Changed ${changed.map((k) => FIELD_LABEL[k]).join(', ')} for ${data.full_name} (${data.admission_no})`, { schoolId: s.school_id, detail: { studentId: s.id } });
  }
  if (b.guardians !== undefined) {
    const cleaned = cleanGuardians(b.guardians, s.school_id, s.id);
    await db.transaction(async (trx) => { await replaceGuardians(trx, s.id, s.school_id, req.user.id, cleaned); });
  }
  res.json({ student: out(await base().where('s.id', s.id).first(COLS)) });
});

module.exports = router;
module.exports.classLabel = classLabel;
module.exports.clean = { nameText, sexOf, phoneOf, up };
