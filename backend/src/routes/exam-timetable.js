// Examination timetable (2026-11-25): for chosen classes or the whole school, as one table.
// Rows are the exam sessions (date + time), columns are the classes; each box holds the subject of that class.
// It is kept in academic_exam_timetable (one row for each class, subject and date), under an exam name such as "Mid Term Exam".
// Excel: download the table (drop-down of the class's subjects in each box), fill it, upload it, look, Save.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { publish } = require('../realtime');
const { checkXlsx } = require('../lib/excel');
const { uploadLimit } = require('../lib/guard');
const { rankOf, LEVEL_NAMES } = require('../lib/timetable-defaults');
const tt = require('./timetable');
const cls = require('./class-subjects');

const router = express.Router();
router.use(requireAuth);

const WRITERS = ['acad', 'head', 'super', 'director'];
const needWriter = (req) => { if (!WRITERS.includes(req.user.role)) throw new HttpError(403, 'The Academic Master / Mistress or the Head Master writes the exam timetable.'); };
const clean = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const int = (v, min, max, name) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} is not valid.`); return n; };
const label = (c) => [c.short_name || c.name, c.stream].filter(Boolean).join(' ');
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));
const mins = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const DAYNAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayOf = (d) => DAYNAME[new Date(`${d}T00:00:00Z`).getUTCDay()];

async function levelClasses(schoolId) {
  const rows = (await tt.classesOf(schoolId)).filter((c) => c.level);
  return rows.sort((a, b) => rankOf(a.level) - rankOf(b.level) || String(a.stream || '').localeCompare(String(b.stream || '')) || a.id - b.id);
}

// GET /api/exam-timetable/grid?school=&year=&term=&exam=
router.get('/grid', requirePage('year'), async (req, res) => {
  const schoolId = await tt.schoolOf(req);
  const year = int(req.query.year, 2000, 2100, 'Year'); const term = int(req.query.term, 1, 2, 'Term');
  const exams = (await db('academic_exam_timetable').where({ school_id: schoolId, year, term }).distinct('title').orderBy('title')).map((x) => x.title);
  const exam = clean(req.query.exam, 160) || exams[0] || '';
  const classes = [];
  for (const c of await levelClasses(schoolId)) classes.push({ id: c.id, label: label(c), level: c.level, levelName: LEVEL_NAMES[c.level] || c.level, subjects: (await tt.subjectsOf(c)).map((s) => ({ id: s.id, short: s.short, name: s.name })) });
  const rows = exam ? await db('academic_exam_timetable').where({ school_id: schoolId, year, term, title: exam })
    .select('class_id', 'subject_id', 'invigilator_ids', db.raw("to_char(exam_date,'YYYY-MM-DD') as date"), db.raw("to_char(starts_at,'HH24:MI') as starts"), db.raw("to_char(ends_at,'HH24:MI') as ends")) : [];
  const teachers = (await cls.teachersOf(schoolId)).map((t) => ({ id: t.id, name: t.fullName }));
  res.json({ canWrite: WRITERS.includes(req.user.role), exams, exam, classes, teachers,
    cells: rows.map((r) => ({ classId: r.class_id, subjectId: r.subject_id, date: r.date, starts: r.starts, ends: r.ends, invigilatorId: Number(String(r.invigilator_ids || '').split(',')[0]) || null })) });
});

// Check the boxes sent; returns clean cells.
async function checkCells(schoolId, classIds, rawCells) {
  const all = await levelClasses(schoolId); const byId = new Map(all.map((c) => [c.id, c]));
  const ids = [...new Set((Array.isArray(classIds) ? classIds : []).map(Number))].filter((i) => byId.has(i));
  if (!ids.length) throw new HttpError(400, 'Choose the classes.');
  const subs = new Map(); for (const id of ids) subs.set(id, new Set((await tt.subjectsOf(byId.get(id))).map((s) => s.id)));
  const teachers = new Set((await cls.teachersOf(schoolId)).map((t) => t.id));
  const out = []; const slot = new Set(); const day = new Set();
  for (const c of Array.isArray(rawCells) ? rawCells : []) {
    const classId = Number(c.classId); const subjectId = Number(c.subjectId);
    if (!ids.includes(classId) || !subjectId) continue;
    if (!isDate(c.date)) throw new HttpError(400, `${label(byId.get(classId))}: a date is not valid.`);
    if (!isTime(c.starts) || !isTime(c.ends) || mins(c.ends) <= mins(c.starts)) throw new HttpError(400, `${label(byId.get(classId))}, ${c.date}: write the time, and the end after the start.`);
    if (!subs.get(classId).has(subjectId)) throw new HttpError(400, `${label(byId.get(classId))}: a subject does not belong to this class.`);
    const k1 = `${classId}|${c.date}|${c.starts}`; const k2 = `${classId}|${subjectId}|${c.date}`;
    if (slot.has(k1)) throw new HttpError(400, `${label(byId.get(classId))} has two papers at the same time on ${c.date}.`);
    if (day.has(k2)) throw new HttpError(400, `${label(byId.get(classId))} has the same subject twice on ${c.date}.`);
    const inv = Number(c.invigilatorId) || null;
    if (inv && !teachers.has(inv)) throw new HttpError(400, `${label(byId.get(classId))}, ${c.date}: the invigilator is not a teacher of this school.`);
    slot.add(k1); day.add(k2);
    out.push({ classId, subjectId, date: c.date, starts: c.starts, ends: c.ends, invigilatorId: inv });
  }
  return { ids, cells: out, byId };
}

// PUT /api/exam-timetable/grid { schoolId, year, term, exam, classIds, cells: [{ classId, subjectId, date, starts, ends }] }
// Replaces the boxes of these classes for this exam; other classes are not touched.
router.put('/grid', requirePage('year', 'f'), async (req, res) => {
  needWriter(req);
  const schoolId = await tt.schoolOf(req); const b = req.body || {};
  const year = int(b.year, 2000, 2100, 'Year'); const term = int(b.term, 1, 2, 'Term');
  const exam = clean(b.exam, 160); if (!exam) throw new HttpError(400, 'Write the name of the exam, for example Mid Term Exam.');
  const { ids, cells } = await checkCells(schoolId, b.classIds, b.cells);
  let added = 0; let removed = 0;
  try {
    await db.transaction(async (trx) => {
      const old = await trx('academic_exam_timetable').where({ school_id: schoolId, year, term, title: exam }).whereIn('class_id', ids)
        .select('id', 'class_id', 'subject_id', db.raw("to_char(exam_date,'YYYY-MM-DD') as date"));
      const want = new Map(cells.map((c) => [`${c.classId}|${c.subjectId}|${c.date}`, c]));
      const have = new Map(old.map((o) => [`${o.class_id}|${o.subject_id}|${o.date}`, o]));
      for (const [k, o] of have) if (!want.has(k)) { await trx('academic_exam_timetable').where({ id: o.id }).del(); removed++; }
      for (const [k, c] of want) {
        const o = have.get(k);
        if (o) await trx('academic_exam_timetable').where({ id: o.id }).update({ starts_at: c.starts, ends_at: c.ends, invigilator_ids: c.invigilatorId ? String(c.invigilatorId) : null, updated_at: trx.fn.now() });
        else { await trx('academic_exam_timetable').insert({ school_id: schoolId, class_id: c.classId, subject_id: c.subjectId, year, term, title: exam, exam_date: c.date, starts_at: c.starts, ends_at: c.ends, invigilator_ids: c.invigilatorId ? String(c.invigilatorId) : null, created_by: req.user.id }); added++; }
      }
      await audit(req, 'academic.exam.timetable', `Exam timetable "${exam}", Term ${term} ${year}: ${ids.length} classes, ${cells.length} papers`, { schoolId, detail: { exam, classIds: ids, added, removed } }, trx);
    });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'A class already has this subject on that date in another exam. Change the date or remove it there first.');
    throw e;
  }
  publish({ topics: ['academic'], schoolId });
  res.json({ saved: cells.length, classes: ids.length, added, removed });
});

// ---------- Excel ----------
const ExcelJS = () => require('exceljs');
const GREEN = 'FF16794A';
const colL = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const FILL = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

// GET /api/exam-timetable/template.xlsx?school=&year=&term=&exam=&classes=1,2,3 (empty = the whole school)
router.get('/template.xlsx', requirePage('year'), async (req, res) => {
  const schoolId = await tt.schoolOf(req);
  const year = int(req.query.year, 2000, 2100, 'Year'); const term = int(req.query.term, 1, 2, 'Term');
  const exam = clean(req.query.exam, 160);
  const want = String(req.query.classes || '').split(',').map(Number).filter(Boolean);
  const classes = (await levelClasses(schoolId)).filter((c) => !want.length || want.includes(c.id));
  if (!classes.length) throw new HttpError(400, 'Choose the classes.');
  const school = await db('schools').where({ id: schoolId }).first('name');
  const rows = exam ? await db('academic_exam_timetable').where({ school_id: schoolId, year, term, title: exam }).whereIn('class_id', classes.map((c) => c.id))
    .select('class_id', 'subject_id', 'invigilator_ids', db.raw("to_char(exam_date,'YYYY-MM-DD') as date"), db.raw("to_char(starts_at,'HH24:MI') as starts"), db.raw("to_char(ends_at,'HH24:MI') as ends")) : [];
  const sessions = [...new Map(rows.map((r) => [`${r.date}|${r.starts}|${r.ends}`, r])).values()].sort((a, b) => `${a.date}${a.starts}`.localeCompare(`${b.date}${b.starts}`));
  const wb = new (ExcelJS().Workbook)(); wb.creator = 'Musabe Schools System';
  const help = wb.addWorksheet('Read me');
  help.addRows([[`${school.name} — examination timetable${exam ? ` — ${exam}` : ''}, Term ${term} ${year}`], [''],
    ['One row for each exam session. Write the DATE (for example 2027-03-15) and the TIME (for example 08:00-09:30).'],
    ['In each class column choose the subject from the drop-down list of that class. Leave a box empty when the class has no paper then.'],
    ['Next to each class there is a column INVIGILATOR: choose the teacher who watches that paper (usually not the subject teacher).'],
    ['Do not rename the sheet, and do not move the row with DATE / DAY / TIME. Upload the file in the system: Academics → Exam timetable → Import Excel.']]);
  help.getColumn(1).width = 120; help.getRow(1).font = { bold: true, size: 13 };
  const lists = wb.addWorksheet('Lists'); const refs = new Map(); const subsBy = new Map();
  for (let i = 0; i < classes.length; i++) {
    const c = classes[i]; const subs = await tt.subjectsOf(c); subsBy.set(c.id, subs);
    lists.getCell(1, i + 1).value = label(c); lists.getCell(1, i + 1).font = { bold: true };
    subs.forEach((s, k) => { lists.getCell(k + 2, i + 1).value = s.short; });
    if (subs.length) refs.set(c.id, `Lists!$${colL(i + 1)}$2:$${colL(i + 1)}$${subs.length + 1}`);
    lists.getColumn(i + 1).width = 18;
  }
  const teachers = await cls.teachersOf(schoolId);
  const tc = classes.length + 1;
  lists.getCell(1, tc).value = 'TEACHERS'; lists.getCell(1, tc).font = { bold: true }; lists.getColumn(tc).width = 30;
  teachers.forEach((t, k) => { lists.getCell(k + 2, tc).value = t.fullName; });
  const tref = teachers.length ? `Lists!$${colL(tc)}$2:$${colL(tc)}$${teachers.length + 1}` : null;
  const ws = wb.addWorksheet('Exam timetable', { views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }] });
  const lastCol = 3 + classes.length * 2;
  ws.getCell(1, 1).value = String(school.name).toUpperCase(); ws.getCell(2, 1).value = `EXAMINATION TIMETABLE${exam ? ` — ${exam.toUpperCase()}` : ''}`; ws.getCell(3, 1).value = `${year} — TERM ${term}`;
  for (let r = 1; r <= 3; r++) { ws.mergeCells(r, 1, r, Math.max(lastCol, 4)); ws.getCell(r, 1).font = { bold: true, size: r === 1 ? 14 : 12 }; ws.getCell(r, 1).alignment = { horizontal: 'center' }; }
  ['DATE', 'DAY', 'TIME', ...classes.flatMap((c) => [label(c), `${label(c)} INVIGILATOR`])].forEach((h, i) => { const c = ws.getCell(4, i + 1); c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = FILL(GREEN); c.alignment = { horizontal: 'center', wrapText: true }; });
  const total = sessions.length ? sessions.length + 4 : 12;
  for (let i = 0; i < total; i++) {
    const r = 5 + i; const s = sessions[i];
    const dc = ws.getCell(r, 1); if (s) dc.value = new Date(`${s.date}T00:00:00Z`); dc.numFmt = 'yyyy-mm-dd'; dc.alignment = { horizontal: 'center' };
    ws.getCell(r, 2).value = { formula: `IF(A${r}="","",TEXT(A${r},"dddd"))` }; ws.getCell(r, 2).alignment = { horizontal: 'center' };
    ws.getCell(r, 3).value = s ? `${s.starts}-${s.ends}` : null; ws.getCell(r, 3).alignment = { horizontal: 'center' };
    classes.forEach((c, k) => {
      const cell = ws.getCell(r, 4 + k * 2); cell.alignment = { horizontal: 'center' };
      const ic = ws.getCell(r, 5 + k * 2); ic.alignment = { horizontal: 'center', wrapText: true };
      if (s) {
        const e = rows.find((x) => x.class_id === c.id && x.date === s.date && x.starts === s.starts && x.ends === s.ends);
        if (e) { cell.value = subsBy.get(c.id).find((x) => x.id === e.subject_id)?.short || null; const iv = teachers.find((t) => t.id === Number(String(e.invigilator_ids || '').split(',')[0])); if (iv) ic.value = iv.fullName; }
      }
      if (refs.has(c.id)) cell.dataValidation = { type: 'list', allowBlank: true, formulae: [refs.get(c.id)], showErrorMessage: false };
      if (tref) ic.dataValidation = { type: 'list', allowBlank: true, formulae: [tref], showErrorMessage: false };
    });
    for (let c = 1; c <= lastCol; c++) ws.getCell(r, c).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  }
  ws.getColumn(1).width = 14; ws.getColumn(2).width = 12; ws.getColumn(3).width = 14; for (let i = 0; i < classes.length; i++) { ws.getColumn(4 + i * 2).width = 14; ws.getColumn(5 + i * 2).width = 22; }
  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="exam-timetable-${year}-term-${term}.xlsx"`);
  res.send(Buffer.from(buf));
});

const cellText = (v) => { if (v == null) return ''; if (v instanceof Date) return v.toISOString().slice(0, 10); if (typeof v === 'object') return clean(v.richText ? v.richText.map((r) => r.text).join('') : v.result ?? v.text ?? '', 80); return clean(v, 80); };
function dateFrom(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v && v.result instanceof Date) return v.result.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const t = cellText(v);
  let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}
function timeFrom(t) {
  const m = String(t).match(/(\d{1,2})[:.](\d{2})\s*(?:am|pm)?\s*[-–—to]+\s*(\d{1,2})[:.](\d{2})/i);
  if (!m) return null;
  const p = (x) => String(x).padStart(2, '0');
  return { starts: `${p(m[1])}:${m[2]}`, ends: `${p(m[3])}:${m[4]}` };
}

// POST /api/exam-timetable/excel?school= (raw .xlsx) — reads the file; writes nothing. The screen shows it, then Save.
router.post('/excel', requirePage('year', 'f'), uploadLimit, express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
  needWriter(req);
  const schoolId = await tt.schoolOf(req);
  checkXlsx(req.body);
  const wb = new (ExcelJS().Workbook)();
  try { await wb.xlsx.load(req.body); } catch { throw new HttpError(400, 'This Excel file could not be opened. Save it again as .xlsx.'); }
  const ws = wb.getWorksheet('Exam timetable') || wb.worksheets.find((w) => !['READ ME', 'LISTS'].includes(w.name.toUpperCase()));
  if (!ws) throw new HttpError(400, 'The sheet "Exam timetable" was not found. Download the file from this page and fill it.');
  let hdr = 0; for (let r = 1; r <= 10; r++) if (/^DATE$/i.test(cellText(ws.getRow(r).getCell(1).value))) { hdr = r; break; }
  if (!hdr) throw new HttpError(400, 'The row with DATE / DAY / TIME was not found.');
  const all = await levelClasses(schoolId); const warnings = []; const cols = [];
  for (let c = 4; c <= ws.columnCount; c++) {
    const h = cellText(ws.getRow(hdr).getCell(c).value); if (!h) continue;
    if (/INVIGILATOR\s*$/i.test(h)) { const base = norm(h.replace(/INVIGILATOR\s*$/i, '')); const x = cols.find((y) => norm(label(y.cls)) === base); if (x) x.ic = c; else warnings.push(`Column "${h}" has no class column before it: skipped.`); continue; }
    const k = all.find((x) => norm(label(x)) === norm(h));
    if (!k) warnings.push(`Column "${h}" is not a class of this school: skipped.`); else cols.push({ c, cls: k, subs: null, ic: 0 });
  }
  if (!cols.length) throw new HttpError(400, 'No class column of this school was found in the header row.');
  for (const x of cols) { const subs = await tt.subjectsOf(x.cls); x.subs = new Map(); for (const s of subs) for (const k of [s.short, s.name]) x.subs.set(norm(k), s); }
  const tnames = new Map((await cls.teachersOf(schoolId)).map((t) => [norm(t.fullName), t.id]));
  const cells = []; const seen = new Set();
  for (let r = hdr + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const vals = cols.map((x) => ({ x, t: cellText(row.getCell(x.c).value) })).filter((v) => v.t);
    if (!vals.length) continue;
    const date = dateFrom(row.getCell(1).value); const tm = timeFrom(cellText(row.getCell(3).value));
    if (!date || !tm) { warnings.push(`Row ${r}: write a date (2027-03-15) and a time (08:00-09:30). Skipped.`); continue; }
    for (const { x, t } of vals) {
      const sub = x.subs.get(norm(t.replace(/\s*\(.*$/, '')));
      if (!sub) { warnings.push(`Row ${r}, ${label(x.cls)}: "${t}" is not a subject of this class. Skipped.`); continue; }
      const k = `${x.cls.id}|${date}|${tm.starts}`; if (seen.has(k)) { warnings.push(`Row ${r}, ${label(x.cls)}: two papers at the same time. Skipped.`); continue; }
      seen.add(k);
      let invigilatorId = null; const iv = x.ic ? cellText(row.getCell(x.ic).value) : '';
      if (iv) { invigilatorId = tnames.get(norm(iv)) || null; if (!invigilatorId) warnings.push(`Row ${r}, ${label(x.cls)}: invigilator "${iv}" is not a teacher of this school. Left empty.`); }
      cells.push({ classId: x.cls.id, subjectId: sub.id, date, starts: tm.starts, ends: tm.ends, invigilatorId });
    }
  }
  res.json({ classIds: cols.map((x) => x.cls.id), cells, warnings: warnings.slice(0, 60), moreWarnings: Math.max(0, warnings.length - 60) });
});

// GET /api/exam-timetable/mine?school=&year=&term=&exam=  (the teacher's own papers: where he teaches the subject, or is an invigilator)
router.get('/mine', requirePage('year'), async (req, res) => {
  const schoolId = await tt.schoolOf(req);
  const year = int(req.query.year, 2000, 2100, 'Year'); const term = int(req.query.term, 1, 2, 'Term');
  const exams = (await db('academic_exam_timetable').where({ school_id: schoolId, year, term }).distinct('title').orderBy('title')).map((x) => x.title);
  const exam = clean(req.query.exam, 160) || exams[0] || '';
  const rows = exam ? await db('academic_exam_timetable as e').join('classes as c', 'c.id', 'e.class_id').join('academic_subjects as s', 's.id', 'e.subject_id')
    .leftJoin('class_subjects as cs', function j() { this.on('cs.class_id', 'e.class_id').andOn('cs.subject_id', 'e.subject_id').andOn('cs.active', db.raw('true')); })
    .where({ 'e.school_id': schoolId, 'e.year': year, 'e.term': term, 'e.title': exam })
    .where(function w() { this.where('cs.teacher_id', req.user.id).orWhereRaw("(',' || coalesce(e.invigilator_ids,'') || ',') like ?", [`%,${req.user.id},%`]); })
    .select('e.id', 'e.venue', 'cs.teacher_id', 'c.short_name', 'c.name as cname', 'c.stream', 's.short_name as sshort', 's.name as sname',
      db.raw("to_char(e.exam_date,'YYYY-MM-DD') as date"), db.raw("to_char(e.starts_at,'HH24:MI') as starts"), db.raw("to_char(e.ends_at,'HH24:MI') as ends"))
    .orderBy('e.exam_date').orderBy('e.starts_at') : [];
  res.json({ year, term, exams, exam, papers: rows.map((r) => ({ id: r.id, date: r.date, day: dayOf(r.date), starts: r.starts, ends: r.ends,
    className: [r.short_name || r.cname, r.stream].filter(Boolean).join(' '), subject: r.sshort || r.sname, venue: r.venue || '',
    role: r.teacher_id === req.user.id ? 'Subject teacher' : 'Invigilator' })) });
});

module.exports = router;
