// Admission interviews (2026-11-20).
// After the admission interview, the child's details are kept for follow-up in school: exam centre, names,
// previous school, marks, result, parent contacts and the date. Marks are prepared by the teacher who marked
// (on paper or Excel) and entered by the Academic Secretary (Assistant Director's office).
// - Secretary and Assistant Director: add, edit, upload from Excel (page "interviews", full).
// - Leaders, School Admin, Head Master, Academic Master: look (school staff: own school only).
// - The School Admin registers a child who passed as a student (Students → Add student, filled in from here);
//   the interview stays linked to the student (students.interview_id) and shows on the student's page.
// Interviews are never deleted.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES } = require('../auth/roles');
const { sendExcel, readRows } = require('../lib/excel');
const { uploadLimit } = require('../lib/guard');
const { levelsFor, levelOf } = require('../lib/levels');
const { clean } = require('./students');

const router = express.Router();
router.use(requireAuth);

const { nameText, sexOf, phoneOf, up } = clean;
const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const RESULTS = { passed: 'Passed', failed: 'Failed', reserve: 'Reserve list', absent: 'Absent', waiting: 'Waiting' };
const SEX = { M: 'Boy', F: 'Girl' };
const thisYear = () => Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' }).slice(0, 4));
const num = (v) => (v === null || v === undefined ? null : Number(v));

const ivOut = (r) => ({
  id: r.id, schoolId: r.school_id, school: r.school_short || null, year: r.year, level: r.level, levelName: levelOf(r.level)?.short || null,
  levelFull: levelOf(r.level)?.name || null,
  firstName: r.first_name, middleName: r.middle_name, lastName: r.last_name, fullName: r.full_name, sex: r.sex, sexLabel: SEX[r.sex],
  examCentre: r.exam_centre, previousSchool: r.previous_school,
  interviewDate: r.interview_date ? (r.interview_date instanceof Date ? r.interview_date.toLocaleDateString('en-CA') : String(r.interview_date).slice(0, 10)) : null,
  marks: r.marks || [], total: num(r.total), outOf: num(r.out_of),
  percent: r.total != null && Number(r.out_of) > 0 ? Math.round((Number(r.total) / Number(r.out_of)) * 1000) / 10 : null,
  result: r.result, resultLabel: RESULTS[r.result], parentName: r.parent_name, parentPhone: r.parent_phone, parentPhone2: r.parent_phone2,
  note: r.note, studentId: r.student_id, studentAdm: r.student_adm || null, createdBy: r.created_by_name || null, updatedAt: r.updated_at,
});

// Which school: own school for school staff; ?school= (or empty = all) for administration.
async function scopeSchool(req, given, { need = false } = {}) {
  if (!allSchools(req.user)) return req.user.school_id;
  const id = Number(given ?? req.query.school);
  if (!id) { if (need) throw new HttpError(400, 'Choose a school first (top of the page).'); return null; }
  if (!(await db('schools').where({ id }).first('id'))) throw new HttpError(404, 'School not found.');
  return id;
}
const schoolCode = async (id) => (await db('schools').where({ id }).first('code'))?.code;

// ---------- Checking one applicant (form or Excel row). Never throws. ----------
function resultOf(v) {
  const t = String(v ?? '').trim().toLowerCase();
  if (!t) return 'waiting';
  if (/^(passed|pass|p|amefaulu|admitted|selected|yes)$/.test(t)) return 'passed';
  if (/^(failed|fail|f|ameshindwa|no)$/.test(t)) return 'failed';
  if (/^(reserve|reserved|waiting list|akiba)$/.test(t)) return 'reserve';
  if (/^(absent|abs|hakuja)$/.test(t)) return 'absent';
  if (/^(waiting|pending|-)$/.test(t)) return 'waiting';
  return null;
}
// A real calendar day (31/13/2026 or 30/02/2026 are refused).
const realDay = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso && iso >= '2000-01-01' && iso <= '2100-12-31' ? iso : undefined; };
function dateOf(v) {
  const r = dateText(v);
  return r ? realDay(r) : r;
}
function dateText(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);           // 12/11/2026 (day first, as in Tanzania)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{5}$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 864e5).toISOString().slice(0, 10); // Excel day number
  return undefined;
}
const words = (v, n) => up(v).replace(/[^A-Z0-9' .,()/&-]/g, '').trim().slice(0, n) || null;

function checkApplicant(b, levels) {
  const errors = [], warnings = [];
  let first = nameText(b.firstName), middle = nameText(b.middleName), last = nameText(b.lastName);
  if (!first && !last && b.fullName) {
    const w = nameText(b.fullName).split(' ').filter(Boolean);
    first = w[0] || ''; middle = w.slice(1, -1).join(' '); last = w.length > 1 ? w[w.length - 1] : '';
  }
  const d = { first_name: first, middle_name: middle || null, last_name: last, sex: sexOf(b.sex),
    exam_centre: words(b.examCentre, 80), previous_school: words(b.previousSchool, 120), parent_name: words(b.parentName, 120),
    note: String(b.note ?? '').trim().slice(0, 200) || null };
  if (!first) errors.push('First name is empty.');
  if (!last) errors.push('Last name is empty.');
  if (!d.sex) errors.push(String(b.sex ?? '').trim() ? `Sex "${b.sex}" is not known. Use M or F.` : 'Sex is empty (M or F).');
  d.full_name = [first, middle, last].filter(Boolean).join(' ');

  // Class applied for: the key (F1), short name (F 1) or full name (FORM ONE).
  const lv = String(b.level ?? '').trim();
  if (lv) {
    const n = (x) => String(x).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const l = levels.find((x) => n(x.key) === n(lv) || n(x.short) === n(lv) || n(x.name) === n(lv));
    if (l) d.level = l.key; else errors.push(`Class "${lv}" is not a class of this school.`);
  } else d.level = null;

  for (const [k, f] of [['parent_phone', b.parentPhone], ['parent_phone2', b.parentPhone2]]) {
    const p = phoneOf(f);
    d[k] = p.phone;
    if (p.bad) warnings.push(`Phone "${p.bad}" is not a correct mobile number (10 digits, 06/07). Saved without it.`);
  }
  const date = dateOf(b.interviewDate);
  if (date === undefined) errors.push(`Date "${b.interviewDate}" is not clear. Write it like 12/11/2026.`);
  else d.interview_date = date;

  // Marks per subject (optional). Total = their sum unless a total is given.
  const marks = [];
  for (const m of Array.isArray(b.marks) ? b.marks : []) {
    const subject = words(m.subject, 40);
    const raw = String(m.marks ?? '').trim();
    if (!subject && !raw) continue;
    if (!subject) { errors.push('A mark has no subject.'); continue; }
    if (raw === '') continue;
    const v = Number(raw), out = m.outOf === '' || m.outOf == null ? null : Number(m.outOf);
    if (!Number.isFinite(v) || v < 0 || v > 1000) { errors.push(`${subject}: mark "${raw}" is not a number.`); continue; }
    if (out != null && (!Number.isFinite(out) || out <= 0 || out > 1000)) { errors.push(`${subject}: "out of" is not a number.`); continue; }
    if (out != null && v > out) errors.push(`${subject}: ${v} is more than ${out}.`);
    marks.push({ subject, marks: v, ...(out != null ? { outOf: out } : {}) });
  }
  d.marks = JSON.stringify(marks);
  const given = String(b.total ?? '').trim();
  if (given) {
    const t = Number(given);
    if (!Number.isFinite(t) || t < 0 || t > 10000) errors.push(`Total "${given}" is not a number.`); else d.total = t;
  } else d.total = marks.length ? marks.reduce((s, m) => s + m.marks, 0) : null;
  const outGiven = String(b.outOf ?? '').trim();
  if (outGiven) {
    const o = Number(outGiven);
    if (!Number.isFinite(o) || o <= 0 || o > 10000) errors.push(`"Out of" "${outGiven}" is not a number.`); else d.out_of = o;
  } else d.out_of = marks.length && marks.every((m) => m.outOf) ? marks.reduce((s, m) => s + m.outOf, 0) : null;
  if (d.total != null && d.out_of != null && d.total > d.out_of) errors.push(`Total ${d.total} is more than ${d.out_of}.`);

  d.result = resultOf(b.result);
  if (!d.result) errors.push(`Result "${b.result}" is not known. Use Passed, Failed, Reserve, Absent or leave it empty.`);
  return { data: d, errors, warnings };
}

// ---------- List ----------
const base = () => db('admission_interviews as i').join('schools as sc', 'sc.id', 'i.school_id')
  .leftJoin('users as u', 'u.id', 'i.created_by').leftJoin('students as st', 'st.id', 'i.student_id')
  .select('i.*', 'sc.short_name as school_short', 'u.full_name as created_by_name', 'st.admission_no as student_adm');

async function query(req) {
  const schoolId = await scopeSchool(req);
  const q = base();
  if (schoolId) q.where('i.school_id', schoolId);
  const year = Number(req.query.year) || null;
  if (year) q.where('i.year', year);
  if (RESULTS[req.query.result]) q.where('i.result', req.query.result);
  if (req.query.level) q.where('i.level', String(req.query.level));
  if (req.query.registered === 'yes') q.whereNotNull('i.student_id');
  if (req.query.registered === 'no') q.whereNull('i.student_id');
  for (const w of up(req.query.q).split(' ').filter(Boolean).slice(0, 5)) {
    q.where((x) => x.whereRaw('lower(i.full_name) like ?', [`%${w.toLowerCase()}%`])
      .orWhereRaw('lower(coalesce(i.previous_school, \'\')) like ?', [`%${w.toLowerCase()}%`])
      .orWhereRaw('lower(coalesce(i.exam_centre, \'\')) like ?', [`%${w.toLowerCase()}%`]));
  }
  return { q: q.orderBy('i.total', 'desc', 'last').orderBy('i.full_name'), schoolId, year };
}

router.get('/', requirePage('interviews'), async (req, res) => {
  const { q, schoolId } = await query(req);
  const rows = (await q.limit(2000)).map(ivOut);
  const yq = db('admission_interviews').distinct('year').orderBy('year', 'desc');
  if (schoolId) yq.where('school_id', schoolId);
  // The numbers at the top count the whole school and year, not only the rows the filters show.
  const sq = db('admission_interviews');
  if (schoolId) sq.where('school_id', schoolId);
  if (Number(req.query.year)) sq.where('year', Number(req.query.year));
  const all = await sq.select('result', 'sex', 'student_id');
  const count = (k) => all.filter((r) => r.result === k).length;
  res.json({
    interviews: rows,
    years: (await yq).map((r) => r.year),
    summary: { all: all.length, boys: all.filter((r) => r.sex === 'M').length, girls: all.filter((r) => r.sex === 'F').length,
      passed: count('passed'), failed: count('failed'), reserve: count('reserve'), absent: count('absent'), waiting: count('waiting'),
      registered: all.filter((r) => r.student_id).length, toRegister: all.filter((r) => r.result === 'passed' && !r.student_id).length },
    levels: schoolId ? levelsFor(await schoolCode(schoolId)).map((l) => ({ key: l.key, shortName: l.short, name: l.name })) : [],
    results: RESULTS,
  });
});

router.get('/export.xlsx', requirePage('interviews'), async (req, res) => {
  const { q } = await query(req);
  const rows = (await q.limit(5000)).map(ivOut);
  const subjects = [...new Set(rows.flatMap((r) => r.marks.map((m) => m.subject)))];
  await sendExcel(res, 'musabe-admission-interviews', [{ name: 'Interviews', title: 'Musabe Schools: admission interviews', columns: [
    { header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'School', key: 'school', width: 16 }, { header: 'Year', key: 'year', type: 'int', width: 7 },
    { header: 'Class', key: 'levelName', width: 7 }, { header: 'Name', key: 'fullName', width: 30 }, { header: 'Sex', key: 'sex', width: 5 },
    { header: 'Exam centre', key: 'examCentre', width: 20 }, { header: 'Previous school', key: 'previousSchool', width: 24 },
    ...subjects.map((s) => ({ header: s, key: `m:${s}`, width: 10 })),
    { header: 'Total', key: 'total', width: 8 }, { header: 'Out of', key: 'outOf', width: 8 }, { header: '%', key: 'percent', width: 7 },
    { header: 'Result', key: 'resultLabel', width: 12 }, { header: 'Parent / guardian', key: 'parentName', width: 24 },
    { header: 'Phone', key: 'parentPhone', width: 13 }, { header: 'Second phone', key: 'parentPhone2', width: 13 },
    { header: 'Interview date', key: 'interviewDate', width: 13 }, { header: 'Registered (Adm. No.)', key: 'studentAdm', width: 14 }, { header: 'Note', key: 'note', width: 24 },
  ], rows: rows.map((r, i) => ({ ...r, sn: i + 1, ...Object.fromEntries(r.marks.map((m) => [`m:${m.subject}`, m.marks])) })) }]);
});

const TEMPLATE_COLUMNS = ['S/N', 'First name', 'Middle name', 'Last name', 'Sex', 'Class', 'Exam centre', 'Previous school',
  'Parent name', 'Parent phone', 'Second phone', 'Interview date', 'Mathematics', 'English', 'Kiswahili', 'Science', 'Total', 'Out of', 'Result', 'Note'];
router.get('/template.xlsx', requirePage('interviews', 'f'), async (req, res) => {
  await sendExcel(res, 'musabe-interviews-template', [{ name: 'Interviews', title: 'Musabe Schools: admission interview results. One school and one year per file.',
    columns: TEMPLATE_COLUMNS.map((h) => ({ header: h, key: h, width: Math.max(10, h.length + 3) })), rows: [], notes: [
      'One row for each child who did the interview. First name, Last name and Sex (M or F) are needed.',
      'Class: the class the child applies for, e.g. F 1, FORM ONE, P 1, PP 1.',
      'Subject columns: keep, rename or add the subjects of your interview (one column for each). Put the marks in them.',
      'Total: leave empty to add the subject marks. "Out of": the highest possible total, e.g. 400.',
      'Result: Passed, Failed, Reserve or Absent. Empty = Waiting.',
      'Interview date: e.g. 12/11/2026 (day / month / year).',
      'Phones: 10 digits starting 06 or 07, e.g. 0754123456.',
    ] }]);
});

router.get('/:id', requirePage('interviews'), async (req, res) => {
  res.json({ interview: ivOut(await getOne(req)) });
});
async function getOne(req) {
  const r = await base().where('i.id', Number(req.params.id)).first();
  if (!r || (!allSchools(req.user) && r.school_id !== req.user.school_id)) throw new HttpError(404, 'Interview not found.');
  return r;
}

// ---------- Add / edit (Secretary, Assistant Director) ----------
function yearOf(v) {
  const y = Number(v) || thisYear();
  if (y < 2000 || y > 2100) throw new HttpError(400, 'Year is not correct.');
  return y;
}

router.post('/', requirePage('interviews', 'f'), async (req, res) => {
  const b = req.body || {};
  const schoolId = await scopeSchool(req, b.schoolId, { need: true });
  const { data, errors } = checkApplicant(b, levelsFor(await schoolCode(schoolId)));
  if (errors.length) throw new HttpError(400, errors[0]);
  const [row] = await db('admission_interviews').insert({ ...data, school_id: schoolId, year: yearOf(b.year), created_by: req.user.id, updated_by: req.user.id }).returning('id');
  await audit(req, 'interview.create', `Admission interview: ${data.full_name}, ${RESULTS[data.result]}${data.total != null ? `, ${data.total}${data.out_of ? `/${data.out_of}` : ''} marks` : ''}`,
    { schoolId, detail: { interviewId: row.id } });
  res.status(201).json({ interview: ivOut(await base().where('i.id', row.id).first()) });
});

const LABEL = { first_name: 'first name', middle_name: 'middle name', last_name: 'last name', sex: 'sex', level: 'class', exam_centre: 'exam centre',
  previous_school: 'previous school', interview_date: 'date', marks: 'marks', total: 'total', out_of: 'out of', result: 'result',
  parent_name: 'parent', parent_phone: 'phone', parent_phone2: 'second phone', note: 'note', year: 'year' };
router.patch('/:id', requirePage('interviews', 'f'), async (req, res) => {
  const r = await getOne(req);
  const old = ivOut(r);
  const b = { ...old, ...(req.body || {}) };
  const { data, errors } = checkApplicant(b, levelsFor(await schoolCode(r.school_id)));
  if (errors.length) throw new HttpError(400, errors[0]);
  data.year = yearOf(b.year);
  const was = { ...r, marks: JSON.stringify(r.marks || []), interview_date: old.interviewDate };
  const same = (k) => String(data[k] ?? '') === String(was[k] ?? '') || (['total', 'out_of'].includes(k) && data[k] != null && was[k] != null && Number(data[k]) === Number(was[k]));
  const changed = Object.keys(LABEL).filter((k) => k in data && !same(k));
  if (changed.length) {
    await db('admission_interviews').where({ id: r.id }).update({ ...data, updated_by: req.user.id, updated_at: db.fn.now() });
    await audit(req, 'interview.update', `Admission interview ${data.full_name}: changed ${changed.map((k) => LABEL[k]).join(', ')}${changed.includes('result') ? ` (now ${RESULTS[data.result]})` : ''}`,
      { schoolId: r.school_id, detail: { interviewId: r.id, studentId: r.student_id || undefined } });
  }
  res.json({ interview: ivOut(await base().where('i.id', r.id).first()) });
});

// ---------- Excel: ?check=1 shows the rows with their mistakes; without it, saves (only if no mistakes) ----------
function columnOf(h) {
  const t = h.toLowerCase().replace(/[’'.]/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/^(s ?\/ ?n|sn|no|na)$/.test(t)) return 'sn';
  if (/first/.test(t)) return 'firstName';
  if (/mid+le|second name/.test(t)) return 'middleName';
  if (/last|surname/.test(t)) return 'lastName';
  if (/^(name|full name|names|jina|candidate|candidates name|pupils name|students name)$/.test(t)) return 'fullName';
  if (/^(sex|gender|jinsia)$/.test(t)) return 'sex';
  if (/^(class|level|darasa|form|class applied)/.test(t)) return 'level';
  if (/centre|center|kituo/.test(t)) return 'examCentre';
  if (/previous|school from|shule/.test(t)) return 'previousSchool';
  if (/second phone|phone 2|other phone|simu 2/.test(t)) return 'parentPhone2';
  if (/contact|phone|simu|mobile|tel/.test(t)) return 'parentPhone';
  if (/parent|guardian|mzazi/.test(t)) return 'parentName';
  if (/date|tarehe/.test(t)) return 'interviewDate';
  if (/^(total|jumla)/.test(t)) return 'total';
  if (/^(out of|max|full marks)/.test(t)) return 'outOf';
  if (/^(result|matokeo|status|remark)/.test(t)) return 'result';
  if (/^(note|maoni|comment)/.test(t)) return 'note';
  if (/^(%|percent|average|wastani|position|grade|nafasi)/.test(t)) return 'skip';
  return 'subject';
}

async function readFile(buffer, schoolId) {
  const { rows } = await readRows(buffer);
  let head = null, cols = [];
  for (const r of rows.slice(0, 15)) {
    const map = r.cells.map((c) => columnOf(c));
    if ((map.includes('firstName') && map.includes('lastName')) || map.includes('fullName')) { head = r; cols = map; break; }
  }
  if (!head) throw new HttpError(400, 'Could not find the name columns. The file needs "First name" and "Last name" (or one "Name" column) and "Sex". Download the template to see.');
  if (!cols.includes('sex')) throw new HttpError(400, 'The file has no "Sex" column (M or F).');
  const levels = levelsFor(await schoolCode(schoolId));
  const lines = [];
  for (const r of rows.filter((x) => x.row > head.row)) {
    const b = { marks: [] };
    cols.forEach((k, i) => {
      const v = r.cells[i] || '';
      if (!k || k === 'skip' || k === 'sn') return;
      if (k === 'subject') b.marks.push({ subject: head.cells[i], marks: v });
      else if (b[k] === undefined) b[k] = v;
    });
    if (!nameText(b.firstName) && !nameText(b.lastName) && !nameText(b.fullName)) continue;
    const { data, errors, warnings } = checkApplicant(b, levels);
    lines.push({ row: r.row, fullName: data.full_name, sex: data.sex, level: levelOf(data.level)?.short || null, examCentre: data.exam_centre,
      previousSchool: data.previous_school, total: data.total, outOf: data.out_of, result: data.result, parentPhone: data.parent_phone, errors, warnings, data });
  }
  if (!lines.length) throw new HttpError(400, 'The file has no children under the header row.');
  if (lines.length > 2000) throw new HttpError(400, 'Too many rows (more than 2000).');
  return lines;
}

router.post('/import', requirePage('interviews', 'f'), uploadLimit, express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
  const schoolId = await scopeSchool(req, undefined, { need: true });
  const year = yearOf(req.query.year);
  const lines = await readFile(req.body, schoolId);
  // Already saved for this school and year with the same name: shown as a warning (it may be a second child with that name).
  const saved = new Set((await db('admission_interviews').where({ school_id: schoolId, year }).select('full_name')).map((r) => r.full_name));
  for (const l of lines) if (saved.has(l.fullName)) l.warnings.push(`${l.fullName} is already saved for ${year}. Saving adds a second row.`);
  const summary = { rows: lines.length, errors: lines.filter((l) => l.errors.length).length, warnings: lines.filter((l) => l.warnings.length).length,
    passed: lines.filter((l) => l.result === 'passed').length, boys: lines.filter((l) => l.sex === 'M').length, girls: lines.filter((l) => l.sex === 'F').length,
    subjects: [...new Set(lines.flatMap((l) => JSON.parse(l.data.marks).map((m) => m.subject)))] };
  if (req.query.check === '1') return res.json({ lines: lines.map(({ data, ...l }) => l), summary, year });
  if (summary.errors) throw new HttpError(400, `${summary.errors} row(s) have mistakes. Fix them in Excel and upload again.`);
  const file = decodeURIComponent(String(req.get('X-File-Name') || 'file.xlsx')).slice(0, 120);
  await db.transaction(async (trx) => {
    for (const l of lines) await trx('admission_interviews').insert({ ...l.data, school_id: schoolId, year, created_by: req.user.id, updated_by: req.user.id });
  });
  await audit(req, 'interview.import', `Admission interviews ${year}: ${lines.length} children from ${file} (${summary.passed} passed)`, { schoolId, detail: { year } });
  res.status(201).json({ saved: lines.length, summary, year });
});

module.exports = router;
module.exports.ivOut = ivOut;
