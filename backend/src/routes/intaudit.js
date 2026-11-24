// Accountant office: internal audit (2026-11-24).
// The system runs checks on its own records and lists what looks wrong or late: money not checked, shortages, fee payments not
// confirmed, receipts not given, gaps in receipt numbers, GRNs and Issue Notes left open, damaged goods waiting, goods bought
// without a receipt, supplier debts, and one person doing both sides of a control. The Accountant opens a finding for anything
// that needs follow-up, adds notes, and closes it with a written reason. Notes are never changed or deleted.
// Nothing here changes any money or stock record: it only reads them.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES } = require('../auth/roles');
const { publish } = require('../realtime');
const { sendExcel } = require('../lib/excel');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const LIMIT = 50;
const tsh = (n) => `TSh ${Number(n).toLocaleString('en-GB')}`;
const where = (q, col, school) => (school ? q.where(col, school) : q);

// Each check: key, title, why it matters, severity, and a function that returns up to LIMIT items:
// { ref, schoolId, school, title, detail, amount, when }
const CHECKS = [
  { key: 'money_unchecked', title: 'Bursar money not checked', severity: 'high', why: 'A bursar took money on a day, but the Accountant has not checked it. The older it is, the harder it is to find a mistake.',
    run: async (s) => {
      const rows = await db.raw(`SELECT x.sold_by, u.full_name AS bursar, x.school_id, sc.short_name AS school, x.day::text AS day, count(*)::int AS n, sum(x.total)::bigint AS total
        FROM (SELECT r.sold_by, r.school_id, r.total, (r.sold_at AT TIME ZONE '${TZ}')::date AS day FROM receipts r ${s ? 'WHERE r.school_id = ?' : ''}) x
        JOIN users u ON u.id = x.sold_by JOIN schools sc ON sc.id = x.school_id
        WHERE x.day < (now() AT TIME ZONE '${TZ}')::date
          AND NOT EXISTS (SELECT 1 FROM money_checks m WHERE m.bursar_id = x.sold_by AND m.day = x.day)
        GROUP BY x.sold_by, u.full_name, x.school_id, sc.short_name, x.day ORDER BY 5 LIMIT ${LIMIT}`, s ? [s] : []);
      return rows.rows.map((r) => ({ ref: `money:${r.sold_by}:${r.day}`, schoolId: r.school_id, school: r.school, title: `${r.bursar}: ${r.day}`, detail: `${r.n} receipts, not checked by the Accountant`, amount: Number(r.total), when: r.day }));
    } },
  { key: 'money_problem', title: 'Money checked but short or over', severity: 'high', why: 'The cash the Accountant counted was not what the receipts said.',
    run: async (s) => (await where(db('money_checks as m').join('users as u', 'u.id', 'm.bursar_id').join('schools as sc', 'sc.id', 'm.school_id').whereIn('m.result', ['short', 'over'])
      .whereRaw(`m.day >= (now() AT TIME ZONE '${TZ}')::date - 60`), 'm.school_id', s).orderBy('m.day', 'desc').limit(LIMIT)
      .select('m.id', 'm.school_id', 'sc.short_name as school', 'u.full_name as bursar', db.raw('m.day::text as day'), 'm.result', 'm.cash', 'm.cash_counted', 'm.note'))
      .map((r) => ({ ref: `moneycheck:${r.id}`, schoolId: r.school_id, school: r.school, title: `${r.bursar}: ${r.day} ${r.result}`, detail: `Receipts say cash ${tsh(r.cash)}, counted ${tsh(r.cash_counted)}${r.note ? `. ${r.note}` : ''}`,
        amount: Math.abs(Number(r.cash_counted) - Number(r.cash)), when: r.day })) },
  { key: 'fee_unconfirmed', title: 'Fee payments not confirmed', severity: 'high', why: 'The Bursar recorded a fee payment but nobody in the accountant office has confirmed it against the bank or mobile money.',
    run: async (s) => (await where(db('fee_payments as p').join('schools as sc', 'sc.id', 'p.school_id').join('users as u', 'u.id', 'p.received_by').where('p.status', 'recorded')
      .whereRaw(`p.received_at < now() - interval '2 days'`), 'p.school_id', s).orderBy('p.received_at').limit(LIMIT).select('p.id', 'p.school_id', 'sc.short_name as school', 'p.number', 'p.student_name', 'p.amount', 'u.full_name as by', db.raw(`(p.received_at AT TIME ZONE '${TZ}')::date::text as day`)))
      .map((r) => ({ ref: `fee:${r.id}`, schoolId: r.school_id, school: r.school, title: `${r.number} ${r.student_name}`, detail: `Recorded by ${r.by}, waiting since ${r.day}`, amount: r.amount, when: r.day })) },
  { key: 'receipts_late', title: 'Paid but not given', severity: 'medium', why: 'A parent paid, but the things were not given for more than 2 days.',
    run: async (s) => (await where(db('receipts as r').join('schools as sc', 'sc.id', 'r.school_id').whereIn('r.status', ['waiting', 'part']).whereRaw(`r.sold_at < now() - interval '2 days'`), 'r.school_id', s)
      .orderBy('r.sold_at').limit(LIMIT).select('r.id', 'r.school_id', 'sc.short_name as school', 'r.number', 'r.student_name', 'r.total', db.raw(`(r.sold_at AT TIME ZONE '${TZ}')::date::text as day`)))
      .map((r) => ({ ref: `receipt:${r.id}`, schoolId: r.school_id, school: r.school, title: `${r.number} ${r.student_name}`, detail: `Paid on ${r.day}, not fully given`, amount: Number(r.total), when: r.day })) },
  { key: 'receipt_gaps', title: 'Gaps in receipt numbers', severity: 'high', why: 'Receipt numbers must follow each other. A missing number means a receipt was lost, hidden or never saved.',
    run: async (s) => {
      const rows = await db.raw(`SELECT r.school_id, sc.short_name AS school, g AS missing FROM (SELECT school_id, min(no) AS lo, max(no) AS hi FROM receipts GROUP BY school_id) r
        JOIN schools sc ON sc.id = r.school_id, generate_series(r.lo, r.hi) g
        WHERE ${s ? 'r.school_id = ? AND' : ''} NOT EXISTS (SELECT 1 FROM receipts x WHERE x.school_id = r.school_id AND x.no = g) ORDER BY 1, 3 LIMIT ${LIMIT}`, s ? [s] : []);
      return rows.rows.map((r) => ({ ref: `gap:${r.school_id}:${r.missing}`, schoolId: r.school_id, school: r.school, title: `Receipt number ${r.missing} is missing`, detail: 'There is no receipt with this number, but later numbers exist', amount: null, when: null }));
    } },
  { key: 'grn_open', title: 'GRNs not approved', severity: 'medium', why: 'Goods were received at the school, but the Bursar or the Head Master has not finished the GRN.',
    run: async (s) => (await where(db('grns as g').join('schools as sc', 'sc.id', 'g.school_id').whereIn('g.status', ['waiting', 'checked', 'sent_back']).whereRaw(`g.prepared_at < now() - interval '3 days'`), 'g.school_id', s)
      .orderBy('g.prepared_at').limit(LIMIT).select('g.id', 'g.school_id', 'sc.short_name as school', 'g.number', 'g.status', db.raw(`(g.prepared_at AT TIME ZONE '${TZ}')::date::text as day`)))
      .map((r) => ({ ref: `grn:${r.id}`, schoolId: r.school_id, school: r.school, title: r.number, detail: `${r.status === 'waiting' ? 'Waiting for the Bursar' : r.status === 'checked' ? 'Waiting for the Head Master' : 'Sent back'} since ${r.day}`, amount: null, when: r.day })) },
  { key: 'notes_open', title: 'Issue Notes not given', severity: 'low', why: 'An Issue Note was written but the things were not given for more than 3 days.',
    run: async (s) => (await where(db('issue_notes as n').join('schools as sc', 'sc.id', 'n.school_id').whereIn('n.status', ['open', 'part']).whereRaw(`n.written_at < now() - interval '3 days'`), 'n.school_id', s)
      .orderBy('n.written_at').limit(LIMIT).select('n.id', 'n.school_id', 'sc.short_name as school', 'n.number', 'n.recipient', db.raw(`(n.written_at AT TIME ZONE '${TZ}')::date::text as day`)))
      .map((r) => ({ ref: `note:${r.id}`, schoolId: r.school_id, school: r.school, title: r.number, detail: `Written on ${r.day}${r.recipient ? ` for ${r.recipient}` : ''}`, amount: null, when: r.day })) },
  { key: 'damage_pending', title: 'Damaged or lost goods waiting', severity: 'medium', why: 'Stock was reported damaged or lost and nobody has decided yet.',
    run: async (s) => (await where(db('damages as d').join('schools as sc', 'sc.id', 'd.school_id').where('d.status', 'pending').whereRaw(`d.reported_at < now() - interval '3 days'`), 'd.school_id', s)
      .orderBy('d.reported_at').limit(LIMIT).select('d.id', 'd.school_id', 'sc.short_name as school', 'd.number', 'd.item_name', 'd.qty', 'd.kind', db.raw(`(d.reported_at AT TIME ZONE '${TZ}')::date::text as day`)))
      .map((r) => ({ ref: `damage:${r.id}`, schoolId: r.school_id, school: r.school, title: `${r.number} ${r.qty} × ${r.item_name}`, detail: `${r.kind} since ${r.day}`, amount: null, when: r.day })) },
  { key: 'counts_pending', title: 'Weekly stock checks not decided', severity: 'medium', why: 'A keeper counted the stock but the accountant office has not decided on the differences.',
    run: async (s) => (await where(db('stock_counts as c').leftJoin('schools as sc', 'sc.id', 'c.school_id').where('c.status', 'pending').whereRaw(`c.counted_at < now() - interval '7 days'`), 'c.school_id', s)
      .orderBy('c.counted_at').limit(LIMIT).select('c.id', 'c.school_id', 'sc.short_name as school', 'c.number', db.raw(`(c.counted_at AT TIME ZONE '${TZ}')::date::text as day`)))
      .map((r) => ({ ref: `count:${r.id}`, schoolId: r.school_id, school: r.school || 'Office', title: r.number, detail: `Counted on ${r.day}, not decided`, amount: null, when: r.day })) },
  { key: 'no_receipt', title: 'Goods bought without a receipt', severity: 'high', why: 'Money was spent but the shop gave no receipt. The reason must be good and the goods must really exist.',
    run: async () => (await db('purchases as p').join('users as u', 'u.id', 'p.created_by').where('p.no_receipt', true).whereRaw(`p.bought_on >= (now() AT TIME ZONE '${TZ}')::date - 60`)
      .orderBy('p.bought_on', 'desc').limit(LIMIT).select('p.id', 'p.number', 'p.supplier', 'p.total', 'p.no_receipt_reason', 'u.full_name as by', db.raw('p.bought_on::text as day')))
      .map((r) => ({ ref: `purchase:${r.id}`, schoolId: null, school: 'Office', title: `${r.number} ${r.supplier}`, detail: `Bought by ${r.by} on ${r.day}. Reason: ${r.no_receipt_reason || 'none written'}`, amount: Number(r.total), when: r.day })) },
  { key: 'supplier_debt', title: 'Supplier debts', severity: 'low', why: 'What the school owes shops and suppliers for goods taken on credit.',
    run: async () => (await db.raw(`SELECT s.id, s.name, s.terms,
        coalesce((SELECT sum(coalesce(l.confirmed_qty, l.qty) * l.unit_cost) FROM purchases p JOIN purchase_lines l ON l.purchase_id = p.id WHERE p.supplier_id = s.id AND p.on_credit AND p.status IN ('checked','confirmed')), 0)::bigint AS credit,
        coalesce((SELECT sum(amount) FROM supplier_payments sp WHERE sp.supplier_id = s.id), 0)::bigint AS paid,
        (SELECT min(p.bought_on)::text FROM purchases p WHERE p.supplier_id = s.id AND p.on_credit AND p.status IN ('checked','confirmed')) AS since
        FROM suppliers s WHERE s.active ORDER BY s.name`)).rows.filter((r) => Number(r.credit) - Number(r.paid) > 0)
      .map((r) => ({ ref: `supplier:${r.id}`, schoolId: null, school: 'Office', title: r.name, detail: `Terms: ${r.terms}. Credit since ${r.since || '?'}`, amount: Number(r.credit) - Number(r.paid), when: r.since })).slice(0, LIMIT) },
  { key: 'same_person', title: 'One person on both sides of a control', severity: 'high', why: 'The person who wrote a record also approved or confirmed it. The system should refuse this; if it appears, someone changed the rules or the data.',
    run: async () => {
      const a = await db('fee_payments').whereRaw('confirmed_by = received_by').limit(LIMIT).select('id', 'school_id', 'number', 'amount');
      const b = await db('fee_lines').whereRaw('approved_by = created_by').limit(LIMIT).select('id', 'school_id', 'name', 'amount');
      const c = await db('purchases').whereRaw('decided_by = created_by').whereIn('status', ['confirmed']).limit(LIMIT).select('id', 'number', 'total');
      return [...a.map((r) => ({ ref: `feepay:${r.id}`, schoolId: r.school_id, school: '', title: `${r.number}: received and confirmed by the same person`, detail: 'Fee payment', amount: r.amount, when: null })),
        ...b.map((r) => ({ ref: `feeline:${r.id}`, schoolId: r.school_id, school: '', title: `Fee ${r.name}: written and approved by the same person`, detail: 'Fee structure', amount: r.amount, when: null })),
        ...c.map((r) => ({ ref: `purchase-same:${r.id}`, schoolId: null, school: 'Office', title: `${r.number}: bought and confirmed by the same person`, detail: 'Purchase', amount: Number(r.total), when: null }))];
    } },
];

const schoolOf = (u, wanted) => (allSchools(u) ? (Number(wanted) || null) : u.school_id);

router.get('/checks', requirePage('intaudit'), async (req, res) => {
  const school = schoolOf(req.user, req.query.school);
  const open = await db('audit_findings').where({ status: 'open' }).select('id', 'check_key', 'ref');
  const O = Object.fromEntries(open.map((f) => [`${f.check_key}|${f.ref}`, f.id]));
  const out = [];
  for (const c of CHECKS) {
    const items = (await c.run(school)).map((i) => ({ ...i, findingId: O[`${c.key}|${i.ref}`] || null }));
    out.push({ key: c.key, title: c.title, why: c.why, severity: c.severity, count: items.length, amount: items.reduce((s, i) => s + (i.amount || 0), 0), items });
  }
  res.json({ checks: out, ranAt: new Date().toISOString(), canWrite: req.user.role === 'acc', openFindings: open.length });
});

router.get('/checks/export.xlsx', requirePage('intaudit'), async (req, res) => {
  const school = schoolOf(req.user, req.query.school);
  const rows = [];
  for (const c of CHECKS) for (const i of await c.run(school)) rows.push({ check: c.title, severity: c.severity, school: i.school, title: i.title, detail: i.detail, amount: i.amount, when: i.when });
  await sendExcel(res, 'musabe-internal-audit', [{ name: 'Audit checks', title: 'Musabe Schools: internal audit checks', columns: [
    { header: 'Check', key: 'check', width: 34 }, { header: 'Severity', key: 'severity', width: 9 }, { header: 'School', key: 'school', width: 16 }, { header: 'What', key: 'title', width: 40 },
    { header: 'Detail', key: 'detail', width: 60 }, { header: 'Amount (TSh)', key: 'amount', type: 'money', width: 14 }, { header: 'Date', key: 'when', width: 12 }], rows }]);
});

// ---------- Findings ----------
router.get('/findings', requirePage('intaudit'), async (req, res) => {
  const q = db('audit_findings as f').leftJoin('schools as s', 's.id', 'f.school_id').join('users as u', 'u.id', 'f.opened_by').leftJoin('users as c', 'c.id', 'f.closed_by')
    .orderBy('f.status', 'desc').orderBy('f.opened_at', 'desc').limit(300)
    .select('f.*', 's.short_name as school', 'u.full_name as by', 'c.full_name as closed_name');
  if (req.query.status === 'open' || req.query.status === 'closed') q.where('f.status', req.query.status);
  const rows = await q;
  const notes = await db('audit_finding_notes as n').join('users as u', 'u.id', 'n.by').whereIn('n.finding_id', rows.map((r) => r.id)).orderBy('n.at').select('n.finding_id', 'n.note', 'n.at', 'u.full_name as by');
  const N = {};
  for (const n of notes) (N[n.finding_id] ||= []).push({ note: n.note, at: n.at, by: n.by });
  res.json({ findings: rows.map((f) => ({ id: f.id, check: f.check_key, ref: f.ref, school: f.school, title: f.title, severity: f.severity, status: f.status, by: f.by, openedAt: f.opened_at,
    closedBy: f.closed_name, closedAt: f.closed_at, closeNote: f.close_note, notes: N[f.id] || [] })), canWrite: req.user.role === 'acc' });
});

router.post('/findings', requirePage('intaudit', 'f'), async (req, res) => {
  if (req.user.role !== 'acc') throw new HttpError(403, 'The Accountant opens audit findings.');
  const b = req.body || {};
  const check = CHECKS.find((c) => c.key === b.check);
  const ref = clean(b.ref, 60), title = clean(b.title, 200), note = clean(b.note, 500);
  if (!check || !ref || title.length < 3) throw new HttpError(400, 'Choose an item from a check.');
  if (note.length < 3) throw new HttpError(400, 'Write what you will look into.');
  const id = await db.transaction(async (trx) => {
    let row;
    try {
      [row] = await trx('audit_findings').insert({ check_key: check.key, ref, school_id: Number(b.schoolId) || null, title, severity: check.severity, opened_by: req.user.id }).returning('id');
    } catch (e) { if (e.code === '23505') throw new HttpError(409, 'This is already an open finding.'); throw e; }
    await trx('audit_finding_notes').insert({ finding_id: row.id, note, by: req.user.id });
    await audit(req, 'finding.open', `Audit finding opened: ${title} (${check.title})`, { schoolId: Number(b.schoolId) || null, detail: { findingId: row.id } }, trx);
    return row.id;
  });
  publish({ topics: ['finding'] }, db);
  res.status(201).json({ id });
});

router.post('/findings/:id/note', requirePage('intaudit', 'f'), async (req, res) => {
  if (req.user.role !== 'acc') throw new HttpError(403, 'The Accountant writes audit notes.');
  const note = clean(req.body?.note, 500);
  if (note.length < 3) throw new HttpError(400, 'Write the note.');
  const f = await db('audit_findings').where({ id: Number(req.params.id) || 0 }).first();
  if (!f) throw new HttpError(404, 'Finding not found.');
  if (f.status !== 'open') throw new HttpError(409, 'This finding is closed.');
  await db('audit_finding_notes').insert({ finding_id: f.id, note, by: req.user.id });
  res.json({ ok: true });
});

router.post('/findings/:id/close', requirePage('intaudit', 'f'), async (req, res) => {
  if (req.user.role !== 'acc') throw new HttpError(403, 'The Accountant closes audit findings.');
  const note = clean(req.body?.note, 500);
  if (note.length < 10) throw new HttpError(400, 'Write how it was settled (at least a short sentence).');
  await db.transaction(async (trx) => {
    const f = await trx('audit_findings').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!f) throw new HttpError(404, 'Finding not found.');
    if (f.status !== 'open') throw new HttpError(409, 'This finding is already closed.');
    await trx('audit_findings').where({ id: f.id }).update({ status: 'closed', closed_by: req.user.id, closed_at: trx.fn.now(), close_note: note });
    await audit(req, 'finding.close', `Audit finding closed: ${f.title}. ${note}`, { schoolId: f.school_id, detail: { findingId: f.id } }, trx);
  });
  publish({ topics: ['finding'] }, db);
  res.json({ ok: true });
});

module.exports = router;
