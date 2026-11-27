// B-SMART Academia (CRDB) fee tracking (2026-11-26).
// The control number of each student is made inside B-SMART. Here the Finance Office uploads the two B-SMART reports:
//   Fee details (who has which control number and amount) and Payments (what was paid on each number).
// An upload waits (pending) until a SECOND person approves it. Payments are only added, never changed.
// Tracking is by STUDENT, not by control number (a child can have an old and a new number).
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES } = require('../auth/roles');
const { publish } = require('../realtime');
const { sendExcel, readRows } = require('../lib/excel');
const { uploadLimit } = require('../lib/guard');
const { levelsFor } = require('../lib/levels');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const thisYear = () => Number(new Date().toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 4));
const schoolOf = (u, wanted) => {
  const id = allSchools(u) ? Number(wanted) || null : u.school_id;
  if (!id) throw new HttpError(400, 'Choose a school.');
  return id;
};
const yearOf = (v) => { const y = Number(v) || thisYear(); if (y < 2020 || y > 2100) throw new HttpError(400, 'Write a year like 2027.'); return y; };
// All data feeding is done at the school, by its Bursar (the school's accountant). The head office (Accountant, Assistant Accountant,
// Manager, Director) approves what the Bursar uploads, downloads the reports of every school, and uploads the bank statement.
const UPLOADERS = ['bursar'];
const APPROVERS = ['acc', 'aacc', 'manager', 'director'];

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const money = (v) => { const n = Number(String(v ?? '').replace(/[,\s]/g, '')); return Number.isFinite(n) ? Math.round(n) : NaN; };
// B-SMART writes dates as D/M/Y (also with time). Returns YYYY-MM-DD or null.
function dateOf(v) {
  const m = String(v ?? '').trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) {
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const iso = String(v ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

// Read a B-SMART report. Finds the header row itself and knows which report it is.
async function parseReport(buffer) {
  const { rows } = await readRows(buffer);
  const head = rows.find((r) => { const n = r.cells.map(norm); return n.includes('referenceno') || (n.includes('admissionno') && n.includes('studentname')); });
  if (!head) throw new HttpError(400, 'This is not a B-SMART report. It needs a "Reference No." or "Admission No." column.');
  const cols = {};
  head.cells.forEach((c, i) => { if (c && cols[norm(c)] === undefined) cols[norm(c)] = i; });
  const kind = cols.paidamount !== undefined ? 'payments' : cols.feeamount !== undefined ? 'fees' : (cols.parentmobile !== undefined && cols.gender !== undefined ? 'students' : null);
  if (!kind) throw new HttpError(400, 'Cannot tell which report this is. Use "Student details", "Fee details" (Fee Amount) or "Payment" (Paid Amount).');
  const get = (r, k) => (cols[k] === undefined ? '' : String(r.cells[cols[k]] ?? '').trim());
  const out = [], errors = [];
  for (const r of rows.filter((x) => x.row > head.row)) {
    if (kind === 'students') {
      const adm = get(r, 'admissionno');
      const name = get(r, 'studentname');
      if (!adm && !name) continue;
      if (!adm || !name) { errors.push({ row: r.row, error: 'Admission No. or Student Name is empty.' }); continue; }
      out.push({ row: r.row, adm, name, cls: get(r, 'class'), stream: get(r, 'streamcombination'), year: get(r, 'academicyear'), parent: get(r, 'parent'), phone: get(r, 'parentmobile'), sex: get(r, 'gender'),
        admitted: dateOf(get(r, 'admissiondate')), prem: get(r, 'premno').slice(0, 30) });
      continue;
    }
    const control = get(r, 'referenceno').replace(/\s/g, '');
    if (!control) continue; // totals or empty lines
    if (!/^[A-Za-z0-9]{6,30}$/.test(control)) { errors.push({ row: r.row, error: `Reference No. "${control}" looks wrong.` }); continue; }
    const adm = get(r, 'admissionno');
    if (kind === 'fees') {
      const amount = money(get(r, 'feeamount'));
      const name = get(r, 'studentname');
      if (!adm || !name) { errors.push({ row: r.row, error: 'Admission No. or Student Name is empty.' }); continue; }
      if (!Number.isInteger(amount) || amount < 0) { errors.push({ row: r.row, error: `Fee Amount "${get(r, 'feeamount')}" is not a number.` }); continue; }
      out.push({ row: r.row, control, adm, name, cls: [get(r, 'class'), get(r, 'stream')].filter(Boolean).join(' '), amount, on: dateOf(get(r, 'uploaddate')) });
    } else {
      const amount = money(get(r, 'paidamount'));
      const receipt = get(r, 'receiptno');
      if (!receipt) { errors.push({ row: r.row, error: 'Receipt No is empty.' }); continue; }
      if (!Number.isInteger(amount) || amount < 1) { errors.push({ row: r.row, error: `Paid Amount "${get(r, 'paidamount')}" is not a number.` }); continue; }
      out.push({ row: r.row, control, adm, receipt, amount, on: dateOf(get(r, 'date')), channel: get(r, 'transactionchannel').slice(0, 20), payer: get(r, 'payername').slice(0, 120), term: get(r, 'term').slice(0, 20) });
    }
  }
  if (!out.length) throw new HttpError(400, errors.length ? `No good rows. First problem: row ${errors[0].row}: ${errors[0].error}` : 'No rows found in this file.');
  return { kind, rows: out, errors };
}

// Which of our students is this B-SMART admission number? B-SMART number first, then our own admission number.
async function studentMap(schoolId) {
  const list = await db('students').where({ school_id: schoolId }).select('id', 'admission_no', 'bsmart_adm');
  const m = new Map();
  for (const s of list) m.set(String(s.admission_no).toLowerCase(), s.id);
  for (const s of list) if (s.bsmart_adm) m.set(String(s.bsmart_adm).toLowerCase(), s.id);
  return m;
}

// ---------- Upload -> look -> approve ----------
router.post('/files', requirePage('fees', 'f'), uploadLimit, express.raw({ type: () => true, limit: '8mb' }), async (req, res) => {
  if (!UPLOADERS.includes(req.user.role)) throw new HttpError(403, 'The school Bursar uploads the B-SMART reports. The head office approves them.');
  const schoolId = schoolOf(req.user, req.query.school);
  const year = yearOf(req.query.year);
  const { kind, rows, errors } = await parseReport(req.body);
  // The Fee details and Payment reports do not say the academic year, so the Bursar chooses it. The Student details report says it in each row.
  const academic = kind === 'students' ? String(rows[0].year || '').slice(0, 12) : String(req.query.academic || '').trim().slice(0, 12);
  if (!academic) throw new HttpError(400, 'Choose the academic year of this B-SMART report (for example 2027 or 2026-2027).');
  const map = await studentMap(schoolId);
  const unmatched = [...new Set(rows.filter((r) => !map.has(r.adm.toLowerCase())).map((r) => r.adm))];
  let rawName = req.get('X-File-Name') || 'bsmart.xlsx';
  try { rawName = decodeURIComponent(rawName); } catch { /* keep */ }
  const summary = { rows: rows.length, mistakes: errors.length, errors: errors.slice(0, 50), unmatched: unmatched.length, unmatchedList: unmatched.slice(0, 100),
    total: kind === 'students' ? null : rows.reduce((a, r) => a + r.amount, 0) };
  const [{ id }] = await db('bsmart_files').insert({ school_id: schoolId, year, kind, file_name: String(rawName).replace(/[^\w .()-]/g, '_').slice(0, 200),
    rows: JSON.stringify(rows), summary: JSON.stringify(summary), uploaded_by: req.user.id, academic_year: academic }).returning('id');
  await audit(req, 'bsmart.upload', `B-SMART ${{ fees: 'fee details', payments: 'payments', students: 'student details' }[kind]} uploaded: ${rows.length} rows`, { schoolId, detail: { fileId: id } });
  res.status(201).json({ id, kind, summary, academic });
});

const fileOut = (f, user) => ({ id: f.id, year: f.year, academic: f.academic_year, kind: f.kind, fileName: f.file_name, status: f.status, summary: f.summary, createdAt: f.created_at, decidedAt: f.decided_at,
  by: f.by, decidedBy: f.decided_by_name, mine: f.uploaded_by === user.id });

router.get('/files', requirePage('fees'), async (req, res) => {
  const schoolId = schoolOf(req.user, req.query.school);
  const list = await db('bsmart_files as f').join('users as u', 'u.id', 'f.uploaded_by').leftJoin('users as d', 'd.id', 'f.decided_by')
    .where('f.school_id', schoolId).orderBy('f.id', 'desc').limit(30).select('f.id', 'f.year', 'f.academic_year', 'f.kind', 'f.file_name', 'f.status', 'f.summary', 'f.created_at', 'f.decided_at', 'f.uploaded_by', 'u.full_name as by', 'd.full_name as decided_by_name');
  res.json({ files: list.map((f) => fileOut(f, req.user)), canUpload: UPLOADERS.includes(req.user.role), canApprove: APPROVERS.includes(req.user.role) });
});

router.post('/files/:id/approve', requirePage('fees', 'f'), async (req, res) => {
  if (!APPROVERS.includes(req.user.role)) throw new HttpError(403, 'Your account cannot approve a B-SMART upload.');
  const f = await db('bsmart_files').where({ id: Number(req.params.id) || 0 }).first();
  if (!f || (!allSchools(req.user) && f.school_id !== req.user.school_id)) throw new HttpError(404, 'This upload was not found.');
  if (f.status !== 'pending') throw new HttpError(409, `This upload was already ${f.status}.`);
  if (f.uploaded_by === req.user.id) throw new HttpError(403, 'Another person must approve your upload.');
  const rows = f.rows;
  if (f.kind === 'students') {
    const out = await registerStudents(f, req.user);
    await audit(req, 'bsmart.approve', `B-SMART student details approved: ${out.added} students registered, ${out.same} already here, ${out.left.length} left out`, { schoolId: f.school_id, detail: { fileId: f.id, ...out, left: out.left.slice(0, 50) } });
    publish({ topics: ['fees', 'bsmart', 'students'], schoolId: f.school_id }, db);
    return res.json({ added: out.added, same: out.same, changed: 0, left: out.left.length });
  }
  const result = await db.transaction(async (trx) => {
    const claimed = await trx('bsmart_files').where({ id: f.id, status: 'pending' }).update({ status: 'approved', decided_by: req.user.id, decided_at: trx.fn.now() });
    if (!claimed) throw new HttpError(409, 'This upload was already approved or discarded.');
    const smap = new Map();
    (await trx('students').where({ school_id: f.school_id }).select('id', 'admission_no', 'bsmart_adm')).forEach((s) => smap.set(String(s.admission_no).toLowerCase(), s.id));
    (await trx('students').where({ school_id: f.school_id }).whereNotNull('bsmart_adm').select('id', 'bsmart_adm')).forEach((s) => smap.set(String(s.bsmart_adm).toLowerCase(), s.id));
    let added = 0, same = 0, changed = 0;
    for (const r of rows) {
      const studentId = smap.get(r.adm.toLowerCase()) || null;
      if (f.kind === 'fees') {
        const old = await trx('bsmart_bills').where({ school_id: f.school_id, control_no: r.control }).first();
        if (!old) { await trx('bsmart_bills').insert({ school_id: f.school_id, year: f.year, control_no: r.control, bsmart_adm: r.adm, student_name: r.name.slice(0, 150),
          class_text: r.cls.slice(0, 60) || null, amount: r.amount, made_on: r.on, student_id: studentId, file_id: f.id, academic_year: f.academic_year }); added++; }
        else if (old.amount !== r.amount) { await trx('bsmart_bills').where({ id: old.id }).update({ amount: r.amount, student_id: studentId || old.student_id, file_id: f.id }); changed++; }
        else same++;
      } else {
        const n = await trx('bsmart_payments').insert({ school_id: f.school_id, year: f.year, control_no: r.control, bsmart_adm: r.adm || null, receipt_no: r.receipt, amount: r.amount,
          paid_on: r.on, channel: r.channel || null, payer: r.payer || null, term: r.term || null, student_id: studentId, file_id: f.id }).onConflict(['school_id', 'receipt_no']).ignore().returning('id');
        if (n.length) added++; else same++;
      }
    }
    return { added, same, changed };
  });
  await audit(req, 'bsmart.approve', `B-SMART ${f.kind} upload approved: ${result.added} new, ${result.same} already there, ${result.changed} amount changed`, { schoolId: f.school_id, detail: { fileId: f.id, ...result } });
  publish({ topics: ['fees', 'bsmart'], schoolId: f.school_id }, db);
  res.json(result);
});

router.post('/files/:id/discard', requirePage('fees', 'f'), async (req, res) => {
  const f = await db('bsmart_files').where({ id: Number(req.params.id) || 0 }).first();
  if (!f || (!allSchools(req.user) && f.school_id !== req.user.school_id)) throw new HttpError(404, 'This upload was not found.');
  if (f.uploaded_by !== req.user.id && !APPROVERS.includes(req.user.role)) throw new HttpError(403, 'Your account cannot discard this upload.');
  const n = await db('bsmart_files').where({ id: f.id, status: 'pending' }).update({ status: 'discarded', decided_by: req.user.id, decided_at: db.fn.now() });
  if (!n) throw new HttpError(409, 'This upload is no longer waiting.');
  await audit(req, 'bsmart.discard', `B-SMART upload discarded: ${f.file_name}`, { schoolId: f.school_id, detail: { fileId: f.id } });
  res.json({ ok: true });
});

// Link a B-SMART admission number to one of our students (when the numbers differ). Old rows are linked too.
router.post('/link', requirePage('fees', 'f'), async (req, res) => {
  if (!UPLOADERS.includes(req.user.role)) throw new HttpError(403, 'The school Bursar links B-SMART admission numbers.');
  const schoolId = schoolOf(req.user, req.body?.school);
  const adm = String(req.body?.bsmartAdm || '').trim().slice(0, 30);
  const student = await db('students').where({ id: Number(req.body?.studentId) || 0, school_id: schoolId }).first('id', 'full_name');
  if (!adm || !student) throw new HttpError(400, 'Write the B-SMART admission number and choose the student.');
  const used = await db('students').where({ school_id: schoolId }).whereRaw('lower(bsmart_adm) = ?', [adm.toLowerCase()]).whereNot({ id: student.id }).first('full_name');
  if (used) throw new HttpError(409, `This B-SMART number already belongs to ${used.full_name}.`);
  await db.transaction(async (trx) => {
    await trx('students').where({ id: student.id }).update({ bsmart_adm: adm });
    await trx('bsmart_bills').where({ school_id: schoolId }).whereRaw('lower(bsmart_adm) = ?', [adm.toLowerCase()]).update({ student_id: student.id });
    await trx('bsmart_payments').where({ school_id: schoolId }).whereRaw('lower(bsmart_adm) = ?', [adm.toLowerCase()]).update({ student_id: student.id });
  });
  await audit(req, 'bsmart.link', `B-SMART number ${adm} linked to ${student.full_name}`, { schoolId, detail: { studentId: student.id } });
  publish({ topics: ['fees', 'bsmart'], schoolId }, db);
  res.json({ ok: true });
});

// ---------- Who paid, who did not ----------
// billed = the amount on the student's B-SMART number (the newest number if there are two), paid = all B-SMART payments of the student.
async function statusRows(schoolId, year) {
  const bills = await db('bsmart_bills').where({ school_id: schoolId, year }).orderBy('id').select('student_id', 'control_no', 'bsmart_adm', 'student_name', 'class_text', 'amount');
  const pays = await db('bsmart_payments').where({ school_id: schoolId, year }).select('student_id', 'control_no', 'bsmart_adm', 'amount', 'paid_on');
  const byKey = new Map();
  const keyOf = (r) => (r.student_id ? `s${r.student_id}` : `a${String(r.bsmart_adm || r.control_no).toLowerCase()}`);
  for (const b of bills) {
    const k = keyOf(b);
    const e = byKey.get(k) || { studentId: b.student_id, adm: b.bsmart_adm, name: b.student_name, cls: b.class_text, numbers: [], billed: 0, paid: 0, last: null };
    e.numbers.push(b.control_no); e.billed = b.amount; e.name = b.student_name; e.cls = b.class_text; // newest number wins
    byKey.set(k, e);
  }
  const noBill = [];
  for (const p of pays) {
    const k = keyOf(p);
    const e = byKey.get(k);
    if (!e) { noBill.push(p); continue; }
    e.paid += p.amount;
    if (p.paid_on && (!e.last || String(p.paid_on) > e.last)) e.last = String(p.paid_on).slice(0, 10);
  }
  const students = [...byKey.values()].map((e) => ({ ...e, balance: e.billed - e.paid,
    state: e.paid <= 0 ? 'unpaid' : e.paid >= e.billed ? 'paid' : 'part', twoNumbers: e.numbers.length > 1 }));
  return { students, noBill };
}

router.get('/status', requirePage('fees'), async (req, res) => {
  const schoolId = schoolOf(req.user, req.query.school);
  const year = yearOf(req.query.year);
  const { students, noBill } = await statusRows(schoolId, year);
  const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
  const unlinked = students.filter((s) => !s.studentId).length;
  res.json({ year, students, totals: { students: students.length, paid: students.filter((s) => s.state === 'paid').length, part: students.filter((s) => s.state === 'part').length,
    unpaid: students.filter((s) => s.state === 'unpaid').length, billed: sum(students, (s) => s.billed), received: sum(students, (s) => s.paid), balance: sum(students, (s) => Math.max(0, s.balance)),
    twoNumbers: students.filter((s) => s.twoNumbers).length, unlinked, paymentsWithoutBill: noBill.length, overpaid: students.filter((s) => s.balance < 0).length } });
});

router.get('/status/export.xlsx', requirePage('fees'), async (req, res) => {
  const schoolId = schoolOf(req.user, req.query.school);
  const year = yearOf(req.query.year);
  const { students } = await statusRows(schoolId, year);
  const LABEL = { paid: 'Paid', part: 'Part paid', unpaid: 'Not paid' };
  await sendExcel(res, `bsmart-fees-${year}`, [{ name: 'Fees', columns: [
    { header: 'Admission No.', key: 'adm', width: 14 }, { header: 'Student', key: 'name', width: 34 }, { header: 'Class', key: 'cls', width: 14 },
    { header: 'Control number', key: 'control', width: 20 }, { header: 'Billed', key: 'billed', width: 14, type: 'money' }, { header: 'Paid', key: 'paid', width: 14 },
    { header: 'Balance', key: 'balance', width: 14 }, { header: 'State', key: 'state', width: 12 }, { header: 'Last payment', key: 'last', width: 14 } ],
  rows: students.map((s) => ({ adm: s.adm, name: s.name, cls: s.cls, control: s.numbers[s.numbers.length - 1], billed: s.billed, paid: s.paid, balance: s.balance, state: LABEL[s.state], last: s.last || '' })) }]);
});

// ---------- Student details: compare B-SMART with our students ----------
const nameKey = (v) => String(v || '').toUpperCase().replace(/[^A-Z' ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
const phoneKey = (v) => { let d = String(v ?? '').replace(/\D/g, ''); if (d.startsWith('255') && d.length === 12) d = d.slice(3); if (d.length === 10 && d[0] === '0') d = d.slice(1); return d.length === 9 ? d : ''; };
const SEX = { male: 'M', female: 'F', m: 'M', f: 'F' };
// B-SMART class name -> our level key. "PRE PRIMARY ONE" is "PREP ONE" here.
function levelKeyOf(schoolCode, text) {
  const t = String(text || '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^PRE PRIMARY/, 'PREP');
  return levelsFor(schoolCode).find((l) => l.name === t)?.key || null;
}

async function compareStudents(file) {
  const school = await db('schools').where({ id: file.school_id }).first('code');
  const levels = levelsFor(school.code).map((l) => l.key);
  const ours = await db('students as s').leftJoin('classes as c', 'c.id', 's.class_id').where('s.school_id', file.school_id).where('s.status', 'active')
    .select('s.id', 's.admission_no', 's.bsmart_adm', 's.full_name', 's.sex', 's.parent_phone', 'c.level', 'c.short_name');
  const gs = await db('student_guardians').where({ school_id: file.school_id }).select('student_id', 'phone');
  const phonesOf = new Map();
  for (const g of gs) { const a = phonesOf.get(g.student_id) || new Set(); a.add(phoneKey(g.phone)); phonesOf.set(g.student_id, a); }
  const byAdm = new Map();
  for (const s of ours) byAdm.set(String(s.admission_no).toLowerCase(), s);
  for (const s of ours) if (s.bsmart_adm) byAdm.set(String(s.bsmart_adm).toLowerCase(), s);
  const seen = new Set(), same = [], differ = [], missing = [];
  for (const b of file.rows) {
    const o = byAdm.get(String(b.adm).toLowerCase());
    if (!o) { missing.push({ adm: b.adm, name: b.name, cls: b.cls, parent: b.parent, phone: b.phone }); continue; }
    seen.add(o.id);
    const why = [];
    if (nameKey(b.name) !== nameKey(o.full_name)) why.push(`Name: B-SMART "${b.name}", here "${o.full_name}"`);
    const bs = SEX[String(b.sex).toLowerCase()];
    if (bs && bs !== o.sex) why.push(`Sex: B-SMART ${b.sex}, here ${o.sex === 'M' ? 'Male' : 'Female'}`);
    // B-SMART holds the class of the NEW year, so the same level or the next level here is correct.
    const bl = levelKeyOf(school.code, b.cls);
    if (!bl) why.push(`Class "${b.cls}" is not a class of this school`);
    else if (!o.level) why.push('Student has no class here');
    else if (bl !== o.level && levels.indexOf(bl) !== levels.indexOf(o.level) + 1) why.push(`Class: B-SMART ${b.cls}, here ${o.short_name}`);
    const bp = phoneKey(b.phone);
    if (bp && ![phoneKey(o.parent_phone), ...(phonesOf.get(o.id) || [])].includes(bp)) why.push(`Parent phone ${b.phone} is not one of the phones here`);
    (why.length ? differ : same).push({ adm: b.adm, name: b.name, cls: b.cls, why });
  }
  const notInBsmart = ours.filter((s) => !seen.has(s.id)).map((s) => ({ adm: s.admission_no, name: s.full_name, cls: s.short_name || '' }));
  const dup = file.rows.length - new Set(file.rows.map((r) => String(r.adm).toLowerCase())).size;
  return { total: file.rows.length, same: same.length, differ, missing, notInBsmart, duplicateAdm: dup };
}

router.get('/files/:id/compare', requirePage('fees'), async (req, res) => {
  const f = await db('bsmart_files').where({ id: Number(req.params.id) || 0, kind: 'students' }).first();
  if (!f || (!allSchools(req.user) && f.school_id !== req.user.school_id)) throw new HttpError(404, 'This upload was not found.');
  const c = await compareStudents(f);
  res.json({ ...c, differ: c.differ.slice(0, 300), differCount: c.differ.length, missing: c.missing.slice(0, 300), missingCount: c.missing.length,
    notInBsmart: c.notInBsmart.slice(0, 300), notInBsmartCount: c.notInBsmart.length });
});

router.get('/files/:id/compare.xlsx', requirePage('fees'), async (req, res) => {
  const f = await db('bsmart_files').where({ id: Number(req.params.id) || 0, kind: 'students' }).first();
  if (!f || (!allSchools(req.user) && f.school_id !== req.user.school_id)) throw new HttpError(404, 'This upload was not found.');
  const c = await compareStudents(f);
  await sendExcel(res, 'bsmart-students-compare', [
    { name: 'Different', columns: [{ header: 'Admission No.', key: 'adm', width: 14 }, { header: 'Student (B-SMART)', key: 'name', width: 34 }, { header: 'Class (B-SMART)', key: 'cls', width: 18 }, { header: 'What is different', key: 'why', width: 90 }],
      rows: c.differ.map((d) => ({ ...d, why: d.why.join(' | ') })) },
    { name: 'In B-SMART only', columns: [{ header: 'Admission No.', key: 'adm', width: 14 }, { header: 'Student', key: 'name', width: 34 }, { header: 'Class', key: 'cls', width: 18 }, { header: 'Parent', key: 'parent', width: 30 }, { header: 'Parent phone', key: 'phone', width: 16 }], rows: c.missing },
    { name: 'Here only', columns: [{ header: 'Admission No.', key: 'adm', width: 14 }, { header: 'Student', key: 'name', width: 34 }, { header: 'Class', key: 'cls', width: 14 }], rows: c.notInBsmart },
  ]);
});


// ---------- Register the students from the B-SMART Student details report ----------
// Every student of the report who is not here yet is registered (class = the class B-SMART shows, at the level of this school).
// A student who is already here (same admission number) is NOT changed: only linked. Rows that cannot be registered are listed.
const G = require('../lib/guardians');
const upper = (v) => String(v ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase();
function splitName(full) {
  const w = upper(full).replace(/[^A-Z' -]/g, '').split(' ').filter(Boolean);
  if (w.length < 2) return null;
  return { first: w[0], last: w[w.length - 1], middle: w.slice(1, -1).join(' ') || null, full: w.join(' ') };
}
async function registerStudents(f, user) {
  const school = await db('schools').where({ id: f.school_id }).first('code');
  const classes = await db('classes').where({ school_id: f.school_id }).whereNull('stream').select('id', 'level');
  const classOf = new Map(classes.map((c) => [c.level, c.id]));
  const left = [];
  let added = 0, same = 0;
  await db.transaction(async (trx) => {
    const claimed = await trx('bsmart_files').where({ id: f.id, status: 'pending' }).update({ status: 'approved', decided_by: user.id, decided_at: trx.fn.now() });
    if (!claimed) throw new HttpError(409, 'This upload was already approved or discarded.');
    const have = new Map();
    (await trx('students').where({ school_id: f.school_id }).select('id', 'admission_no', 'bsmart_adm')).forEach((s) => { have.set(String(s.admission_no).toLowerCase(), s.id); if (s.bsmart_adm) have.set(String(s.bsmart_adm).toLowerCase(), s.id); });
    for (const r of f.rows) {
      let id = have.get(String(r.adm).toLowerCase()) || null;
      if (id) same++;
      else {
        const nm = splitName(r.name);
        const level = levelKeyOf(school.code, r.cls);
        const sex = SEX[String(r.sex).toLowerCase()];
        const why = !nm ? 'Name needs at least two names' : !level ? `Class "${r.cls}" is not a class of this school` : !classOf.get(level) ? `This school has no class for ${r.cls}` : !sex ? 'Sex is not Male or Female' : String(r.adm).length > 20 ? 'Admission number is too long' : null;
        if (why) { left.push({ adm: r.adm, name: r.name, why }); }
        else {
          const ph = G.phoneOf(r.phone).phone;
          [{ id }] = await trx('students').insert({ school_id: f.school_id, admission_no: String(r.adm).slice(0, 20), prem_no: r.prem && /^\d+$/.test(r.prem) ? r.prem.slice(0, 20) : null,
            first_name: nm.first.slice(0, 40), middle_name: nm.middle ? nm.middle.slice(0, 40) : null, last_name: nm.last.slice(0, 40), full_name: nm.full.slice(0, 130), sex,
            class_id: classOf.get(level), parent_name: upper(r.parent).slice(0, 120) || null, parent_phone: ph, status: 'active', created_by: user.id }).returning('id');
          const gn = G.nameOf(r.parent);
          if (ph && !gn.problem) await trx('student_guardians').insert({ student_id: id, school_id: f.school_id, full_name: gn.name.slice(0, 120), phone: ph, relationship: 'guardian', created_by: user.id });
          added++;
        }
      }
      const rec = { school_id: f.school_id, adm: String(r.adm).slice(0, 30), student_name: upper(r.name).slice(0, 150), class_text: r.cls.slice(0, 60) || null, stream: (r.stream || '').slice(0, 30) || null,
        academic_year: String(r.year || f.academic_year || '').slice(0, 12) || null, admitted_on: r.admitted, parent: upper(r.parent).slice(0, 150) || null, phone: String(r.phone || '').slice(0, 20) || null,
        sex: String(r.sex || '').slice(0, 10) || null, prem_no: r.prem || null, student_id: id, file_id: f.id, updated_at: trx.fn.now() };
      const old = await trx('bsmart_students').where({ school_id: f.school_id }).whereRaw('lower(adm) = ?', [rec.adm.toLowerCase()]).first('id');
      if (old) await trx('bsmart_students').where({ id: old.id }).update(rec); else await trx('bsmart_students').insert(rec);
      if (id) {
        await trx('bsmart_bills').where({ school_id: f.school_id }).whereRaw('lower(bsmart_adm) = ?', [rec.adm.toLowerCase()]).whereNull('student_id').update({ student_id: id });
        await trx('bsmart_payments').where({ school_id: f.school_id }).whereRaw('lower(bsmart_adm) = ?', [rec.adm.toLowerCase()]).whereNull('student_id').update({ student_id: id });
      }
    }
  });
  return { added, same, left };
}

// ---------- Every student as B-SMART has him: how he was registered, his control numbers, what he paid ----------
async function overview(schoolId) {
  const studs = await db('bsmart_students').where({ school_id: schoolId }).orderBy('student_name').select('*');
  const bills = await db('bsmart_bills').where({ school_id: schoolId }).orderBy('id').select('control_no', 'bsmart_adm', 'amount', 'made_on', 'academic_year', 'class_text');
  const pays = await db('bsmart_payments').where({ school_id: schoolId }).select('control_no', 'amount', 'paid_on', 'receipt_no', 'channel');
  const paidOn = new Map();
  for (const p of pays) { const a = paidOn.get(p.control_no) || { sum: 0, n: 0, last: null }; a.sum += p.amount; a.n++; if (p.paid_on && (!a.last || String(p.paid_on) > a.last)) a.last = String(p.paid_on).slice(0, 10); paidOn.set(p.control_no, a); }
  const billsOf = new Map();
  for (const b of bills) { const k = String(b.bsmart_adm).toLowerCase(); (billsOf.get(k) || billsOf.set(k, []).get(k)).push(b); }
  const known = new Set(studs.map((s) => String(s.adm).toLowerCase()));
  const rows = studs.map((s) => {
    const list = billsOf.get(String(s.adm).toLowerCase()) || [];
    const numbers = list.map((b) => ({ control: b.control_no, academic: b.academic_year, amount: b.amount, madeOn: b.made_on ? String(b.made_on).slice(0, 10) : null, cls: b.class_text, paid: paidOn.get(b.control_no)?.sum || 0 }));
    const latest = numbers[numbers.length - 1];
    const paid = numbers.reduce((t, n) => t + n.paid, 0);
    const state = !latest ? 'none' : paid <= 0 ? 'unpaid' : paid >= latest.amount ? 'paid' : 'part';
    return { adm: s.adm, name: s.student_name, cls: s.class_text, registered: s.academic_year, admitted: s.admitted_on ? String(s.admitted_on).slice(0, 10) : null, parent: s.parent, phone: s.phone, sex: s.sex,
      inSystem: !!s.student_id, numbers, billed: latest?.amount || 0, paid, balance: latest ? latest.amount - paid : 0, state,
      problems: [!s.student_id && 'Not in our system', !latest && 'No control number', numbers.length > 1 && 'More than one control number', latest && s.academic_year && numbers.some((n) => n.academic && n.academic !== s.academic_year) && 'Control number is in a different academic year than the registration'].filter(Boolean) };
  });
  const noStudent = bills.filter((b) => !known.has(String(b.bsmart_adm).toLowerCase())).map((b) => ({ control: b.control_no, adm: b.bsmart_adm, amount: b.amount }));
  return { rows, noStudent };
}

router.get('/students', requirePage('fees'), async (req, res) => {
  const schoolId = schoolOf(req.user, req.query.school);
  const { rows, noStudent } = await overview(schoolId);
  const years = [...new Set(rows.map((r) => r.registered).filter(Boolean))];
  const t = (f) => rows.filter(f).length;
  res.json({ years, classes: [...new Set(rows.map((r) => r.cls).filter(Boolean))].sort(), rows, noStudentBills: noStudent.length,
    totals: { students: rows.length, none: t((r) => r.state === 'none'), two: t((r) => r.numbers.length > 1), paid: t((r) => r.state === 'paid'), part: t((r) => r.state === 'part'), unpaid: t((r) => r.state === 'unpaid'),
      notHere: t((r) => !r.inSystem), billed: rows.reduce((a, r) => a + r.billed, 0), received: rows.reduce((a, r) => a + r.paid, 0) } });
});

router.get('/students/export.xlsx', requirePage('fees'), async (req, res) => {
  const schoolId = schoolOf(req.user, req.query.school);
  const { rows } = await overview(schoolId);
  const ST = { none: 'No control number', unpaid: 'Not paid', part: 'Part paid', paid: 'Paid' };
  await sendExcel(res, 'bsmart-students', [
    { name: 'Students', columns: [{ header: 'Admission No.', key: 'adm', width: 14 }, { header: 'Student', key: 'name', width: 34 }, { header: 'Class (B-SMART)', key: 'cls', width: 18 }, { header: 'Registered in academic year', key: 'registered', width: 14 },
      { header: 'Admission date', key: 'admitted', width: 14 }, { header: 'Parent', key: 'parent', width: 28 }, { header: 'Parent phone', key: 'phone', width: 14 }, { header: 'In our system', key: 'here', width: 12 },
      { header: 'Control numbers', key: 'count', width: 10 }, { header: 'Latest control number', key: 'control', width: 20 }, { header: 'Academic year of number', key: 'nyear', width: 14 },
      { header: 'Billed', key: 'billed', width: 14, type: 'money' }, { header: 'Paid', key: 'paid', width: 14, type: 'money' }, { header: 'Balance', key: 'balance', width: 14, type: 'money' }, { header: 'State', key: 'state', width: 16 }, { header: 'Problems', key: 'problems', width: 60 }],
    rows: rows.map((r) => { const l = r.numbers[r.numbers.length - 1]; return { ...r, here: r.inSystem ? 'Yes' : 'No', count: r.numbers.length, control: l?.control || '', nyear: l?.academic || '', state: ST[r.state], problems: r.problems.join(' | ') }; }) },
    { name: 'Control numbers', columns: [{ header: 'Admission No.', key: 'adm', width: 14 }, { header: 'Student', key: 'name', width: 34 }, { header: 'Control number', key: 'control', width: 20 }, { header: 'Academic year', key: 'academic', width: 14 },
      { header: 'Made on', key: 'madeOn', width: 14 }, { header: 'Class on number', key: 'cls', width: 18 }, { header: 'Amount', key: 'amount', width: 14, type: 'money' }, { header: 'Paid on this number', key: 'paid', width: 14, type: 'money' }],
    rows: rows.flatMap((r) => r.numbers.map((n) => ({ ...n, adm: r.adm, name: r.name }))) },
  ]);
});

module.exports = router;
module.exports.parseReport = parseReport; // for tests
