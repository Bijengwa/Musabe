// Streams inside a class (2026-11-25).
// A class level (for example P 2) first has one class with all its students. The Academic Master opens the class and
// presses "Create streams": two or more names. The students are then split between the streams:
//   - by the system, in a random shuffle (not by name, not by marks), the same number in each stream; or
//   - by Excel: the class sheet has a Stream column; she writes the stream of each student, and uploads it.
// For one stream she can also upload only its students; the rest go to the other stream when there is only one other.
// "Remove streams" puts all the students back in the class and deletes the streams (kept switched off if they have records).
const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES } = require('../auth/roles');
const { publish } = require('../realtime');
const { readExcel } = require('../lib/excel');
const { uploadLimit } = require('../lib/guard');
const { levelOf } = require('../lib/levels');

const router = express.Router();
router.use(requireAuth);

const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const label = (c) => [c.short_name || c.name, c.stream].filter(Boolean).join(' ');
const up = (v) => String(v ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase();
const keep = (v) => up(v).replace(/[^A-Z0-9' .()/-]/g, '').replace(/\s+/g, ' ').trim();
const adm = (v) => String(v ?? '').trim().replace(/\.0+$/, '').replace(/\s+/g, '').toUpperCase();
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const SEX = { M: 'M', F: 'F' };

async function classOf(req, id) {
  const c = await db('classes').where({ id: Number(id) || 0 }).first();
  if (!c || (!allSchools(req.user) && c.school_id !== req.user.school_id)) throw new HttpError(404, 'Class not found.');
  if (!c.level) throw new HttpError(400, 'This class is not one of the fixed classes. Match it to a fixed class first.');
  return c;
}
const levelClasses = (c) => db('classes').where({ school_id: c.school_id, level: c.level }).orderBy('stream');
function streamNames(v, min = 2) {
  const list = (Array.isArray(v) ? v : String(v || '').split(/[,;]+/)).map(keep).filter(Boolean);
  const names = [...new Set(list)];
  if (names.length !== list.length) throw new HttpError(400, 'Two streams have the same name.');
  if (names.length < min) throw new HttpError(400, `Write at least ${min} stream names, for example YELLOW and BLUE.`);
  if (names.length > 12) throw new HttpError(400, 'At most 12 streams.');
  if (names.some((x) => x.length > 30)) throw new HttpError(400, 'A stream name is too long.');
  return names;
}
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// The base class (no stream) of the level, which must have no streams yet.
async function needFresh(req, id) {
  const c = await classOf(req, id);
  if (c.stream) throw new HttpError(400, 'Open the whole class (the one without a stream) to create streams.');
  const have = (await levelClasses(c)).filter((x) => x.stream && x.active);
  if (have.length) throw new HttpError(409, `${label(c)} already has streams (${have.map((x) => x.stream).join(', ')}). Remove them first.`);
  return c;
}
// Make the stream classes; the subject teachers of the class are copied to each stream.
async function makeStreams(trx, req, base, names) {
  const made = [];
  for (const stream of names) {
    const twin = await trx('classes').where({ school_id: base.school_id, level: base.level }).whereRaw('lower(coalesce(stream,\'\')) = lower(?)', [stream]).first();
    let row = twin;
    if (twin && twin.active) throw new HttpError(409, `${label(twin)} already exists.`);
    if (twin) [row] = await trx('classes').where({ id: twin.id }).update({ active: true, updated_at: trx.fn.now() }).returning('*');
    else [row] = await trx('classes').insert({ school_id: base.school_id, level: base.level, name: base.name, short_name: base.short_name, stream, curriculum: base.curriculum, created_by: req.user.id }).returning('*');
    const subj = await trx('class_subjects').where({ class_id: base.id, active: true }).select('subject_id', 'teacher_id');
    for (const s of subj) {
      const have = await trx('class_subjects').where({ class_id: row.id, subject_id: s.subject_id }).first('id');
      if (!have) await trx('class_subjects').insert({ class_id: row.id, subject_id: s.subject_id, teacher_id: s.teacher_id, active: true, created_by: req.user.id });
    }
    made.push(row);
  }
  return made;
}
async function moveStudents(trx, req, map) { // Map(classId -> [studentId])
  for (const [classId, ids] of map) if (ids.length) await trx('students').whereIn('id', ids).update({ class_id: classId, updated_by: req.user.id, updated_at: trx.fn.now() });
}
const finishBase = (trx, baseId) => trx('classes').where({ id: baseId }).update({ active: false, updated_at: trx.fn.now() });

// POST /api/class-streams/:id/streams { names: ['YELLOW','BLUE'], mode: 'auto' } — create the streams and shuffle the students.
router.post('/:id/streams', requirePage('classlist', 'f'), async (req, res) => {
  const base = await needFresh(req, req.params.id);
  const names = streamNames(req.body?.names);
  const result = await db.transaction(async (trx) => {
    const made = await makeStreams(trx, req, base, names);
    const students = await trx('students').where({ class_id: base.id, status: 'active' }).select('id');
    const mixed = shuffle(students.map((s) => s.id));
    const map = new Map(made.map((m) => [m.id, []]));
    mixed.forEach((id, i) => map.get(made[i % made.length].id).push(id));
    await moveStudents(trx, req, map);
    await finishBase(trx, base.id);
    await audit(req, 'class.streams', `${label(base)}: created streams ${names.join(', ')}; ${plural(students.length, 'student')} shared by the system (shuffled)`,
      { schoolId: base.school_id, detail: { classId: base.id, streams: made.map((m) => m.id) } }, trx);
    return made.map((m) => ({ id: m.id, label: label(m), students: map.get(m.id).length }));
  });
  publish({ topics: ['class', 'student'], schoolId: base.school_id });
  res.status(201).json({ streams: result });
});

// Read the sheet: { admission -> stream | null }, and what is wrong.
async function readSheet(buffer) {
  const rows = await readExcel(buffer, 'admission no.');
  const map = new Map(); const problems = []; let hasStream = false;
  for (const r of rows) {
    const a = adm(r['admission no.']); if (!a) continue;
    const s = keep(r.stream); if (s) hasStream = true;
    if (map.has(a)) problems.push(`Row ${r._row}: admission number ${a} is written twice.`);
    map.set(a, { stream: s || null, row: r._row });
  }
  if (!map.size) throw new HttpError(400, 'No admission numbers were found in the file.');
  return { map, hasStream, problems };
}

// POST /api/class-streams/:id/streams/excel?names=YELLOW,BLUE&dry=1 (raw .xlsx) — create the streams from the Stream column.
// A student with an empty Stream goes to the one stream that nobody was written in, if there is exactly one.
router.post('/:id/streams/excel', requirePage('classlist', 'f'), uploadLimit, express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
  const base = await needFresh(req, req.params.id);
  const names = streamNames(req.query.names);
  const dry = req.query.dry === '1';
  const sheet = await readSheet(req.body);
  const students = await db('students').where({ class_id: base.id, status: 'active' }).select('id', 'admission_no', 'full_name');
  const byAdm = new Map(students.map((s) => [adm(s.admission_no), s]));
  const problems = [...sheet.problems]; const warnings = [];
  const to = new Map(names.map((n) => [n, []])); const blank = [];
  for (const [a, v] of sheet.map) {
    const s = byAdm.get(a);
    if (!s) { warnings.push(`Row ${v.row}: ${a} is not a student of ${label(base)}. Skipped.`); continue; }
    if (v.stream && !to.has(v.stream)) { problems.push(`Row ${v.row}: stream "${v.stream}" is not one of ${names.join(', ')}.`); continue; }
    if (v.stream) to.get(v.stream).push(s.id);
  }
  const listed = new Set([...to.values()].flat());
  for (const s of students) if (!listed.has(s.id)) blank.push(s.id);
  if (blank.length) {
    const empty = names.filter((n) => !to.get(n).length);
    if (empty.length === 1) to.get(empty[0]).push(...blank);
    else problems.push(`${plural(blank.length, 'student')} have no stream in the file. Write a stream for every student, or leave one stream empty so the rest go there.`);
  }
  const counts = Object.fromEntries(names.map((n) => [n, to.get(n).length]));
  if (problems.length || dry) {
    if (!dry) throw new HttpError(400, problems.slice(0, 5).join(' '));
    return res.json({ ok: !problems.length, counts, problems: problems.slice(0, 40), warnings: warnings.slice(0, 40), students: students.length });
  }
  await db.transaction(async (trx) => {
    const made = await makeStreams(trx, req, base, names);
    await moveStudents(trx, req, new Map(made.map((m) => [m.id, to.get(m.stream)])));
    await finishBase(trx, base.id);
    await audit(req, 'class.streams', `${label(base)}: created streams ${names.join(', ')} from Excel (${names.map((n) => `${n} ${counts[n]}`).join(', ')})`,
      { schoolId: base.school_id, detail: { classId: base.id, counts } }, trx);
  });
  publish({ topics: ['class', 'student'], schoolId: base.school_id });
  res.status(201).json({ ok: true, counts });
});

// POST /api/class-streams/:id/members/excel?dry=1 (raw .xlsx) — the file lists the students of THIS stream. If the level has
// exactly one other stream, all the other students of the level go there. (A Stream column, if filled, picks the rows of this stream.)
router.post('/:id/members/excel', requirePage('classlist', 'f'), uploadLimit, express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
  const c = await classOf(req, req.params.id);
  if (!c.stream) throw new HttpError(400, 'Open one stream (for example P 2 YELLOW) to upload its students.');
  const dry = req.query.dry === '1';
  const sheet = await readSheet(req.body);
  const siblings = (await levelClasses(c)).filter((x) => x.stream && x.active);
  const others = siblings.filter((x) => x.id !== c.id);
  const all = await db('students').whereIn('class_id', siblings.map((x) => x.id)).where({ status: 'active' }).select('id', 'admission_no', 'class_id');
  const byAdm = new Map(all.map((s) => [adm(s.admission_no), s]));
  const problems = [...sheet.problems]; const warnings = [];
  const mine = new Set();
  for (const [a, v] of sheet.map) {
    if (sheet.hasStream && v.stream !== c.stream) continue;
    const s = byAdm.get(a);
    if (!s) { warnings.push(`Row ${v.row}: ${a} is not a student of ${label(c)} or its streams. Skipped.`); continue; }
    mine.add(s.id);
  }
  if (!mine.size) problems.push(`No student of ${label(c)} was found in the file.`);
  const toThis = all.filter((s) => mine.has(s.id) && s.class_id !== c.id).map((s) => s.id);
  const rest = all.filter((s) => !mine.has(s.id));
  const toOther = others.length === 1 ? rest.filter((s) => s.class_id !== others[0].id).map((s) => s.id) : [];
  const counts = { [c.stream]: mine.size, ...(others.length === 1 ? { [others[0].stream]: rest.length } : {}) };
  if (others.length > 1) warnings.push('This class has more than 2 streams: the students not in the file stay where they are.');
  if (dry) return res.json({ ok: !problems.length, counts, problems: problems.slice(0, 40), warnings: warnings.slice(0, 40), moving: toThis.length + toOther.length });
  if (problems.length) throw new HttpError(400, problems.slice(0, 5).join(' '));
  await db.transaction(async (trx) => {
    const map = new Map([[c.id, toThis]]); if (others.length === 1) map.set(others[0].id, toOther);
    await moveStudents(trx, req, map);
    await audit(req, 'class.streams', `${label(c)}: students set from Excel (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})`,
      { schoolId: c.school_id, detail: { classId: c.id, counts } }, trx);
  });
  publish({ topics: ['class', 'student'], schoolId: c.school_id });
  res.json({ ok: true, counts });
});

// POST /api/class-streams/remove { classId } | { all: true, schoolId } — students back to the class, streams deleted.
router.post('/remove', requirePage('classlist', 'f'), async (req, res) => {
  const b = req.body || {};
  let levels; let schoolId;
  if (b.all) {
    schoolId = allSchools(req.user) ? Number(b.schoolId) : req.user.school_id;
    if (!schoolId) throw new HttpError(400, 'Choose a school first.');
    levels = [...new Set((await db('classes').where({ school_id: schoolId }).whereNotNull('stream').whereNotNull('level').select('level')).map((x) => x.level))];
  } else {
    const c = await classOf(req, b.classId); schoolId = c.school_id; levels = [c.level];
  }
  const report = [];
  await db.transaction(async (trx) => {
    for (const level of levels) {
      const rows = await trx('classes').where({ school_id: schoolId, level }).orderBy('id');
      const streams = rows.filter((x) => x.stream);
      if (!streams.length) continue;
      let base = rows.find((x) => !x.stream);
      if (!base) {
        const s = streams[0];
        [base] = await trx('classes').insert({ school_id: schoolId, level, name: s.name, short_name: s.short_name, stream: null, curriculum: s.curriculum, created_by: req.user.id }).returning('*');
      }
      await trx('classes').where({ id: base.id }).update({ active: true, updated_at: trx.fn.now() });
      for (const s of streams) {
        const moved = await trx('students').where({ class_id: s.id }).update({ class_id: base.id, updated_by: req.user.id, updated_at: trx.fn.now() });
        let deleted = true;
        try {
          await trx.transaction(async (t) => {
            const teachers = await t('class_subjects').where({ class_id: s.id }).select('subject_id', 'teacher_id');
            for (const x of teachers) {
              const have = await t('class_subjects').where({ class_id: base.id, subject_id: x.subject_id }).first('id', 'teacher_id');
              if (!have) await t('class_subjects').insert({ class_id: base.id, subject_id: x.subject_id, teacher_id: x.teacher_id, active: true, created_by: req.user.id });
              else if (!have.teacher_id && x.teacher_id) await t('class_subjects').where({ id: have.id }).update({ teacher_id: x.teacher_id });
            }
            await t('class_subjects').where({ class_id: s.id }).del();
            await t('classes').where({ id: s.id }).del();
          });
        } catch (e) {
          deleted = false;
          await trx('classes').where({ id: s.id }).update({ active: false, updated_at: trx.fn.now() });
        }
        report.push({ label: label(s), students: moved, deleted });
      }
    }
    if (report.length) await audit(req, 'class.streams', `Streams removed: ${report.map((r) => `${r.label}${r.deleted ? '' : ' (kept switched off: it has records)'}`).join(', ')}`, { schoolId, detail: { levels } }, trx);
  });
  publish({ topics: ['class', 'student', 'academic'], schoolId });
  res.json({ removed: report.filter((r) => r.deleted).length, kept: report.filter((r) => !r.deleted).length, report });
});

// GET /api/class-streams/:id/class.xlsx?names=YELLOW,BLUE — the class on Excel: students (with a Stream column) and subjects with teachers.
router.get('/:id/class.xlsx', requirePage('students'), async (req, res) => {
  const c = await classOf(req, req.params.id);
  const ExcelJS = require('exceljs');
  const classes = (await levelClasses(c)).filter((x) => x.active);
  const streams = classes.filter((x) => x.stream);
  const names = streams.length ? streams.map((x) => x.stream) : (req.query.names ? streamNames(req.query.names, 1) : []);
  const students = await db('students as s').leftJoin('classes as k', 'k.id', 's.class_id').whereIn('s.class_id', classes.map((x) => x.id)).where('s.status', 'active')
    .orderBy('s.full_name').select('s.admission_no', 's.full_name', 's.sex', 'k.short_name', 'k.name', 'k.stream');
  const school = await db('schools').where({ id: c.school_id }).first('name');
  const wb = new ExcelJS.Workbook(); wb.creator = 'Musabe Schools System';
  const GREEN = 'FF16794A';
  const head = (row) => row.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }; });
  const ws = wb.addWorksheet('Students', { views: [{ state: 'frozen', ySplit: 1 }] });
  head(ws.addRow(['S/N', 'Admission No.', 'Full name', 'Sex', 'Class', 'Stream']));
  students.forEach((s, i) => { const r = ws.addRow([i + 1, s.admission_no, s.full_name, SEX[s.sex] || '', [s.short_name || s.name, s.stream].filter(Boolean).join(' '), s.stream || '']); if (names.length) r.getCell(6).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${names.join(',')}"`] }; });
  [6, 16, 34, 6, 14, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 6 } };
  // subjects with the teacher of each stream
  const lv = levelOf(c.level); const curriculum = c.curriculum || lv?.curriculum || null;
  const subjects = await db('academic_subjects').where({ school_id: c.school_id, level: c.level, curriculum, active: true }).orderBy('sn').orderBy('id');
  const cs = await db('class_subjects as x').join('users as u', 'u.id', 'x.teacher_id').whereIn('x.class_id', classes.map((k) => k.id)).where('x.active', true).select('x.class_id', 'x.subject_id', 'u.full_name');
  const sb = wb.addWorksheet('Subjects', { views: [{ state: 'frozen', ySplit: 1 }] });
  const cols = streams.length ? streams : classes;
  head(sb.addRow(['No.', 'Subject', 'Short', ...cols.map((k) => `Teacher${k.stream ? ` ${k.stream}` : ''}`)]));
  subjects.forEach((s, i) => sb.addRow([i + 1, s.name, s.short_name || s.code, ...cols.map((k) => cs.find((x) => x.class_id === k.id && x.subject_id === s.id)?.full_name || '')]));
  [5, 34, 12].forEach((w, i) => { sb.getColumn(i + 1).width = w; }); cols.forEach((_, i) => { sb.getColumn(4 + i).width = 28; });
  const help = wb.addWorksheet('How to fill'); help.getColumn(1).width = 110;
  help.addRow([`${school.name}: ${label({ ...c, stream: null })}`]).font = { bold: true, size: 13 };
  for (const t of ['Students: one row for each student of the class. Do not change the Admission No.',
    names.length ? `Stream: choose ${names.join(' or ')} in the Stream column for each student.` : 'Stream: this class has no streams yet. Open the class in the system and press Create streams, then use this file.',
    'Upload the file in the system: open the class (or one stream), then Upload Excel.',
    'If you upload the students of ONE stream only, the students left out go to the other stream (when there are only two).',
    'Subjects: the subjects of the class and the teacher of each stream (changed in the system, not here).']) help.addRow([t]);
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="class-${label({ ...c, stream: null }).replace(/\W+/g, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx"` });
  await wb.xlsx.write(res); res.end();
});

module.exports = router;
