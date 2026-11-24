// School fees (2026-11-24), the Finance Office.
// - Fee structure: the Finance Manager writes fee lines (year, term, class level, day/boarding, name, amount). They are drafts.
//   The Manager or the Director approves a school's drafts for a year. The Finance Manager cannot approve his own lines.
//   An approved line is never changed: a new amount is a new line that takes over when approved (the old one is closed).
// - Payments: the Bursar records what a parent pays for a child (cash, bank slip, mobile money). One slip number is used once.
//   The Accountant or Assistant Accountant confirms each payment (never the Bursar).
// - Balances: what is due for each child (from the approved lines for his class level and day/boarding) less what was paid.
// Item prices (what the bursar sells) stay on the Items & prices page, also the Finance Manager's.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES } = require('../auth/roles');
const { publish } = require('../realtime');
const { sendExcel } = require('../lib/excel');
const { levelsFor, levelOf } = require('../lib/levels');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const thisYear = () => Number(today().slice(0, 4));
const schoolOf = (u, wanted) => (allSchools(u) ? (Number(wanted) || null) : u.school_id);
const METHODS = { cash: 'Cash', bank: 'Bank', mobile: 'Mobile money' };
const TERM = (t) => (t === 0 ? 'Whole year' : `Term ${t}`);
const yearOf = (v) => { const y = Number(v) || thisYear(); if (y < 2020 || y > 2100) throw new HttpError(400, 'Write a year like 2027.'); return y; };

const lineOut = (l) => ({ id: l.id, schoolId: l.school_id, school: l.school, year: l.year, term: l.term, termLabel: TERM(l.term), level: l.level, levelName: l.level ? levelOf(l.level)?.name || l.level : 'All classes',
  residence: l.residence, name: l.name, amount: l.amount, status: l.status, by: l.by, approvedBy: l.approved_by_name, closedAt: l.closed_at });

// ---------- Fee structure ----------
router.get('/structure', requirePage('fees'), async (req, res) => {
  const schoolId = schoolOf(req.user, req.query.school);
  const year = yearOf(req.query.year);
  const q = db('fee_lines as l').join('schools as s', 's.id', 'l.school_id').join('users as u', 'u.id', 'l.created_by').leftJoin('users as a', 'a.id', 'l.approved_by')
    .where('l.year', year).whereIn('l.status', req.query.history ? ['draft', 'approved', 'closed', 'withdrawn'] : ['draft', 'approved'])
    .select('l.*', 's.short_name as school', 'u.full_name as by', 'a.full_name as approved_by_name').orderBy('l.school_id').orderBy('l.term').orderBy('l.level').orderBy('l.name').orderBy('l.id');
  if (schoolId) q.where('l.school_id', schoolId);
  const rows = (await q).map(lineOut);
  const school = schoolId ? await db('schools').where({ id: schoolId }).first('code') : null;
  res.json({ year, lines: rows, drafts: rows.filter((r) => r.status === 'draft').length, levels: school ? levelsFor(school.code).map((l) => ({ key: l.key, name: l.name })) : [],
    canWrite: req.user.role === 'fm', canApprove: ['manager', 'director'].includes(req.user.role) });
});

router.post('/structure', requirePage('fees', 'f'), async (req, res) => {
  if (req.user.role !== 'fm') throw new HttpError(403, 'The Finance Manager writes the fee structure.');
  const b = req.body || {};
  const school = await db('schools').where({ id: Number(b.schoolId) || 0, active: true }).first();
  if (!school) throw new HttpError(400, 'Choose a school.');
  const year = yearOf(b.year);
  const term = Number.isInteger(Number(b.term)) ? Number(b.term) : 0;
  if (term < 0 || term > 2) throw new HttpError(400, 'Term is 0 (whole year), 1 or 2.');
  const level = b.level ? String(b.level) : null;
  if (level && !levelsFor(school.code).some((l) => l.key === level)) throw new HttpError(400, 'This class level is not in this school.');
  const residence = ['all', 'day', 'boarding'].includes(b.residence) ? b.residence : 'all';
  const name = clean(b.name, 60).toUpperCase();
  if (name.length < 3) throw new HttpError(400, 'Write the name of the fee, e.g. TUITION.');
  const amount = Number(b.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > 100000000) throw new HttpError(400, 'Write the amount in whole shillings.');
  const same = db('fee_lines').where({ school_id: school.id, year, term, residence, name }).where((w) => (level ? w.where({ level }) : w.whereNull('level')));
  if (await same.clone().where({ status: 'draft' }).first()) throw new HttpError(409, `${name} already has a draft for this class and term. Withdraw it first.`);
  const prev = await same.clone().where({ status: 'approved' }).first();
  if (prev && prev.amount === amount) throw new HttpError(409, `${name} is already approved at TSh ${amount.toLocaleString('en-GB')}.`);
  const [{ id }] = await db('fee_lines').insert({ school_id: school.id, year, term, level, residence, name, amount, created_by: req.user.id }).returning('id');
  await audit(req, 'fee.line', `Fee ${name} ${TERM(term).toLowerCase()} ${level ? levelOf(level)?.name : 'all classes'} ${residence === 'all' ? '' : residence} ${year}: TSh ${amount.toLocaleString('en-GB')}${prev ? ` (was ${prev.amount.toLocaleString('en-GB')})` : ''} waits for approval`,
    { schoolId: school.id, detail: { feeLineId: id } });
  publish({ topics: ['fees'], schoolId: school.id }, db);
  res.status(201).json({ id });
});

router.post('/structure/:id/withdraw', requirePage('fees', 'f'), async (req, res) => {
  if (req.user.role !== 'fm') throw new HttpError(403, 'The Finance Manager withdraws his own drafts.');
  const n = await db('fee_lines').where({ id: Number(req.params.id) || 0, status: 'draft' }).update({ status: 'withdrawn', closed_at: db.fn.now() });
  if (!n) throw new HttpError(404, 'Draft not found.');
  res.json({ ok: true });
});

// The Manager or the Director approves all drafts of one school and year. A new amount closes the one it replaces.
router.post('/structure/approve', requirePage('fees', 'f'), async (req, res) => {
  if (!['manager', 'director'].includes(req.user.role)) throw new HttpError(403, 'The Manager or the Director approves the fees.');
  const school = await db('schools').where({ id: Number(req.body?.schoolId) || 0 }).first();
  if (!school) throw new HttpError(400, 'Choose a school.');
  const year = yearOf(req.body?.year);
  const n = await db.transaction(async (trx) => {
    const drafts = await trx('fee_lines').where({ school_id: school.id, year, status: 'draft' }).forUpdate().orderBy('id');
    for (const d of drafts) {
      const old = trx('fee_lines').where({ school_id: d.school_id, year: d.year, term: d.term, residence: d.residence, name: d.name, status: 'approved' }).where((w) => (d.level ? w.where({ level: d.level }) : w.whereNull('level')));
      await old.update({ status: 'closed', closed_by_line: d.id, closed_at: trx.fn.now() });
      await trx('fee_lines').where({ id: d.id }).update({ status: 'approved', approved_by: req.user.id, approved_at: trx.fn.now() });
    }
    if (drafts.length) await audit(req, 'fee.approve', `${drafts.length} fee line${drafts.length > 1 ? 's' : ''} approved for ${school.short_name} ${year}, total of lines TSh ${drafts.reduce((s, d) => s + d.amount, 0).toLocaleString('en-GB')}`, { schoolId: school.id }, trx);
    return drafts.length;
  });
  if (!n) throw new HttpError(409, 'There is nothing waiting for approval for this school and year.');
  publish({ topics: ['fees'], schoolId: school.id }, db);
  res.json({ approved: n });
});

// ---------- What is due ----------
async function dueFor(trx, schoolId, year) {
  return trx('fee_lines').where({ school_id: schoolId, year, status: 'approved' });
}
const applies = (line, st) => (!line.level || line.level === st.level) && (line.residence === 'all' || line.residence === st.residence);
const dueOf = (lines, st) => lines.filter((l) => applies(l, st)).reduce((s, l) => s + l.amount, 0);

async function studentsOf(user, schoolId, f = {}) {
  const q = db('students as s').leftJoin('classes as c', 'c.id', 's.class_id').where('s.school_id', schoolId).where('s.status', 'active')
    .select('s.id', 's.admission_no', 's.full_name', 's.residence', 'c.level', 'c.name as class_name', 'c.stream').orderBy('c.name').orderBy('c.stream').orderBy('s.full_name');
  if (f.class) q.where('s.class_id', Number(f.class));
  if (f.q) q.whereILike('s.full_name', `%${clean(f.q, 60)}%`);
  return q;
}

router.get('/balances', requirePage('fees'), async (req, res) => {
  const schoolId = schoolOf(req.user, req.query.school);
  if (!schoolId) throw new HttpError(400, 'Choose a school.');
  const year = yearOf(req.query.year);
  const [lines, sts, paid] = await Promise.all([dueFor(db, schoolId, year), studentsOf(req.user, schoolId, req.query),
    db('fee_payments').where({ school_id: schoolId, year }).groupBy('student_id').select('student_id', db.raw('sum(amount)::int as paid'))]);
  const P = Object.fromEntries(paid.map((p) => [p.student_id, p.paid]));
  let rows = sts.map((s) => { const due = dueOf(lines, s); const p = P[s.id] || 0; return { id: s.id, admissionNo: s.admission_no, name: s.full_name, class: s.class_name ? `${s.class_name}${s.stream ? ` ${s.stream}` : ''}` : '', residence: s.residence, due, paid: p, balance: due - p }; });
  if (req.query.owing) rows = rows.filter((r) => r.balance > 0);
  res.json({ year, rows: rows.slice(0, 2000), totals: { due: rows.reduce((s, r) => s + r.due, 0), paid: rows.reduce((s, r) => s + r.paid, 0), balance: rows.reduce((s, r) => s + r.balance, 0), owing: rows.filter((r) => r.balance > 0).length },
    approved: lines.length });
});

router.get('/balances/export.xlsx', requirePage('fees'), async (req, res) => {
  const schoolId = schoolOf(req.user, req.query.school);
  if (!schoolId) throw new HttpError(400, 'Choose a school.');
  const year = yearOf(req.query.year);
  const [lines, sts, paid] = await Promise.all([dueFor(db, schoolId, year), studentsOf(req.user, schoolId, req.query),
    db('fee_payments').where({ school_id: schoolId, year }).groupBy('student_id').select('student_id', db.raw('sum(amount)::int as paid'))]);
  const P = Object.fromEntries(paid.map((p) => [p.student_id, p.paid]));
  await sendExcel(res, `musabe-fee-balances-${year}`, [{ name: 'Balances', title: `Musabe Schools: fee balances ${year} (TSh)`, columns: [
    { header: 'Adm. no', key: 'adm', width: 12 }, { header: 'Student', key: 'name', width: 30 }, { header: 'Class', key: 'cls', width: 18 }, { header: 'Day / boarding', key: 'res', width: 12 },
    { header: 'Due', key: 'due', type: 'money', width: 14 }, { header: 'Paid', key: 'paid', type: 'money', width: 14 }, { header: 'Balance', key: 'bal', type: 'money', width: 14 }],
  rows: sts.map((s) => { const due = dueOf(lines, s), p = P[s.id] || 0; return { adm: s.admission_no, name: s.full_name, cls: s.class_name ? `${s.class_name} ${s.stream || ''}`.trim() : '', res: s.residence || '', due, paid: p, bal: due - p }; }) }]);
});

// One child: what is due by fee line, what was paid, the balance.
router.get('/student/:id', requirePage('fees'), async (req, res) => {
  const st = await db('students as s').leftJoin('classes as c', 'c.id', 's.class_id').where('s.id', Number(req.params.id) || 0)
    .select('s.id', 's.school_id', 's.admission_no', 's.full_name', 's.residence', 'c.level', 'c.name as class_name', 'c.stream').first();
  if (!st || (!allSchools(req.user) && st.school_id !== req.user.school_id)) throw new HttpError(404, 'Student not found.');
  const year = yearOf(req.query.year);
  const lines = (await dueFor(db, st.school_id, year)).filter((l) => applies(l, st));
  const pays = await db('fee_payments as p').join('users as u', 'u.id', 'p.received_by').where({ 'p.student_id': st.id, 'p.year': year }).orderBy('p.paid_on').orderBy('p.id')
    .select('p.*', 'u.full_name as by', db.raw('p.paid_on::text as paid_on_t'));
  const due = lines.reduce((s, l) => s + l.amount, 0), paid = pays.reduce((s, p) => s + p.amount, 0);
  res.json({ student: { id: st.id, name: st.full_name, admissionNo: st.admission_no, class: st.class_name ? `${st.class_name} ${st.stream || ''}`.trim() : '', residence: st.residence },
    year, lines: lines.map((l) => ({ id: l.id, name: l.name, termLabel: TERM(l.term), amount: l.amount })), due, paid, balance: due - paid,
    payments: pays.map((p) => ({ id: p.id, number: p.number, amount: p.amount, method: METHODS[p.method], reference: p.reference, paidOn: p.paid_on_t, term: TERM(p.term), status: p.status, by: p.by, payer: p.payer })),
    warning: st.residence ? null : 'Day or boarding is not set for this child: only the fees for everyone are counted.' });
});

router.post('/student/:id/residence', requirePage('fees', 'f'), async (req, res) => {
  if (!['bursar', 'sadmin'].includes(req.user.role)) throw new HttpError(403, 'The Bursar or the School Admin sets day or boarding.');
  const residence = ['day', 'boarding'].includes(req.body?.residence) ? req.body.residence : null;
  if (!residence) throw new HttpError(400, 'Choose day or boarding.');
  const n = await db('students').where({ id: Number(req.params.id) || 0, school_id: req.user.school_id }).update({ residence });
  if (!n) throw new HttpError(404, 'Student not found in your school.');
  res.json({ residence });
});

// ---------- Payments ----------
const payQuery = (user, f = {}) => {
  const q = db('fee_payments as p').join('schools as s', 's.id', 'p.school_id').join('users as u', 'u.id', 'p.received_by').leftJoin('users as c', 'c.id', 'p.confirmed_by').leftJoin('students as st', 'st.id', 'p.student_id');
  const school = schoolOf(user, f.school);
  if (school) q.where('p.school_id', school);
  if (user.role === 'bursar' && f.mine) q.where('p.received_by', user.id);
  if (f.status === 'recorded' || f.status === 'confirmed') q.where('p.status', f.status);
  if (f.student) q.where('p.student_id', Number(f.student));
  if (isDate(f.from)) q.where('p.paid_on', '>=', f.from);
  if (isDate(f.to)) q.where('p.paid_on', '<=', f.to);
  if (f.q) { const t = `%${clean(f.q, 60)}%`; q.where((w) => w.whereILike('p.student_name', t).orWhereILike('p.number', t).orWhereILike('p.reference', t)); }
  return q;
};
const payCols = ['p.*', 's.short_name as school', 'u.full_name as by', 'c.full_name as confirmed_name', 'st.admission_no', db.raw('p.paid_on::text as paid_on_t')];
const payOut = (p) => ({ id: p.id, number: p.number, schoolId: p.school_id, school: p.school, studentId: p.student_id, student: p.student_name, admissionNo: p.admission_no, year: p.year, term: TERM(p.term),
  amount: p.amount, method: METHODS[p.method], reference: p.reference, paidOn: p.paid_on_t, payer: p.payer, note: p.note, status: p.status, by: p.by, confirmedBy: p.confirmed_name, receivedAt: p.received_at });

router.get('/payments', requirePage('fees'), async (req, res) => {
  const rows = await payQuery(req.user, req.query).orderBy('p.paid_on', 'desc').orderBy('p.id', 'desc').limit(300).select(payCols);
  const open = await payQuery(req.user, { ...req.query, status: 'recorded' }).count('* as n').sum('p.amount as sum').first();
  res.json({ payments: rows.map(payOut), waiting: Number(open.n), waitingSum: Number(open.sum) || 0, canRecord: req.user.role === 'bursar', canConfirm: ['acc', 'aacc'].includes(req.user.role) });
});
router.get('/payments/export.xlsx', requirePage('fees'), async (req, res) => {
  const rows = await payQuery(req.user, req.query).orderBy('p.paid_on').orderBy('p.id').select(payCols);
  await sendExcel(res, 'musabe-fee-payments', [{ name: 'Fee payments', title: 'Musabe Schools: fee payments (TSh)', columns: [
    { header: 'Number', key: 'number', width: 18 }, { header: 'Date', key: 'paidOn', width: 12 }, { header: 'School', key: 'school', width: 16 }, { header: 'Student', key: 'student', width: 30 }, { header: 'Year', key: 'year', width: 7 },
    { header: 'Term', key: 'term', width: 11 }, { header: 'Amount', key: 'amount', type: 'money', width: 14 }, { header: 'Method', key: 'method', width: 13 }, { header: 'Reference', key: 'reference', width: 20 },
    { header: 'Received by', key: 'by', width: 22 }, { header: 'Confirmed by', key: 'confirmedBy', width: 22 }], rows: rows.map(payOut) }]);
});

router.post('/payments', requirePage('fees', 'f'), async (req, res) => {
  if (req.user.role !== 'bursar') throw new HttpError(403, 'The Bursar records fee payments.');
  const b = req.body || {};
  const year = yearOf(b.year);
  const term = Number.isInteger(Number(b.term)) ? Number(b.term) : 0;
  if (term < 0 || term > 2) throw new HttpError(400, 'Term is 0 (whole year), 1 or 2.');
  const amount = Number(b.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > 100000000) throw new HttpError(400, 'Write the amount in whole shillings.');
  const method = METHODS[b.method] ? b.method : null;
  if (!method) throw new HttpError(400, 'Choose cash, bank or mobile money.');
  const reference = clean(b.reference, 60).toUpperCase() || null;
  if (method !== 'cash' && (!reference || reference.length < 4)) throw new HttpError(400, 'Write the bank slip or mobile money transaction number.');
  const paidOn = isDate(b.paidOn) ? b.paidOn : today();
  if (paidOn > today()) throw new HttpError(400, 'The date cannot be in the future.');
  const id = await db.transaction(async (trx) => {
    const st = await trx('students as s').leftJoin('classes as c', 'c.id', 's.class_id').where({ 's.id': Number(b.studentId) || 0, 's.school_id': req.user.school_id })
      .select('s.id', 's.full_name', 's.residence', 'c.level').first();
    if (!st) throw new HttpError(404, 'Student not found in your school.');
    const lines = await dueFor(trx, req.user.school_id, year);
    const due = dueOf(lines, st);
    if (!due) throw new HttpError(409, `No approved fees for this child in ${year}. The Finance Manager writes them and the Manager approves them first${st.residence ? '' : ' (and day or boarding must be set)'}.`);
    const [{ paid }] = await trx('fee_payments').where({ student_id: st.id, year }).sum('amount as paid');
    if ((Number(paid) || 0) + amount > due) throw new HttpError(409, `This is more than the child owes for ${year}: due TSh ${due.toLocaleString('en-GB')}, paid TSh ${(Number(paid) || 0).toLocaleString('en-GB')}, balance TSh ${(due - (Number(paid) || 0)).toLocaleString('en-GB')}.`);
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`fee_payments:${req.user.school_id}`]);
    const [{ n }] = await trx('fee_payments').where({ school_id: req.user.school_id }).max('seq as n');
    const seq = (Number(n) || 0) + 1;
    const school = await trx('schools').where({ id: req.user.school_id }).first('receipt_prefix');
    const number = `${school.receipt_prefix}/FEE.${String(seq).padStart(4, '0')}`;
    let row;
    try {
      [row] = await trx('fee_payments').insert({ school_id: req.user.school_id, seq, number, student_id: st.id, student_name: st.full_name, year, term, amount, method, reference, paid_on: paidOn,
        payer: clean(b.payer, 120).toUpperCase() || null, note: clean(b.note, 200) || null, received_by: req.user.id }).returning('id');
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, `The number ${reference} was already used for a fee payment in this school.`);
      throw e;
    }
    await audit(req, 'fee.payment', `${number}: TSh ${amount.toLocaleString('en-GB')} (${METHODS[method]}${reference ? ` ${reference}` : ''}) for ${st.full_name}, ${TERM(term).toLowerCase()} ${year}`, { schoolId: req.user.school_id, detail: { feePaymentId: row.id } }, trx);
    return row.id;
  });
  publish({ topics: ['fees'], schoolId: req.user.school_id }, db);
  const p = await payQuery(req.user, {}).where('p.id', id).select(payCols).first();
  res.status(201).json({ payment: payOut(p) });
});

router.post('/payments/:id/confirm', requirePage('fees', 'f'), async (req, res) => {
  if (!['acc', 'aacc'].includes(req.user.role)) throw new HttpError(403, 'The Accountant or the Assistant Accountant confirms fee payments.');
  const ok = await db.transaction(async (trx) => {
    const p = await trx('fee_payments').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!p) throw new HttpError(404, 'Payment not found.');
    if (p.status !== 'recorded') throw new HttpError(409, `${p.number} is already confirmed.`);
    await trx('fee_payments').where({ id: p.id }).update({ status: 'confirmed', confirmed_by: req.user.id, confirmed_at: trx.fn.now() });
    await audit(req, 'fee.confirm', `${p.number} confirmed (TSh ${p.amount.toLocaleString('en-GB')}, ${p.student_name})`, { schoolId: p.school_id, detail: { feePaymentId: p.id } }, trx);
    return p;
  });
  publish({ topics: ['fees'], schoolId: ok.school_id }, db);
  res.json({ ok: true });
});

module.exports = router;
