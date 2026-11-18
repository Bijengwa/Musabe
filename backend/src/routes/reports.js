// Reports page: each role sees only the reports it may download (REPORTS in auth/roles.js).
// GET /api/reports                     -> the list for this person
// GET /api/reports/:key.xlsx?from&to&school -> the Excel file
// School roles always get their own school only. Administration can pick a school or take all.
const express = require('express');
const ExcelJS = () => require('exceljs'); // loaded at first use: it takes about 2 seconds, too long for every start
const db = require('../db');
const { HttpError } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES, REPORTS, canReport } = require('../auth/roles');
const { sendExcel, safeText } = require('../lib/excel');
const { METHODS } = require('./receipts');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const d = (v) => v && new Date(v);

// What each report is, in plain words. `dates: false` = a picture of today (no date range).
const INFO = {
  'sales-book': { group: 'Sales', title: 'Sales book (like the uniform sales Excel book)',
    about: 'Every receipt with its items, one sheet per month: date, receipt no., student, class, item, number, amount, grand total.' },
  'items-sold': { group: 'Sales', title: 'Items sold', about: 'How many of each item were sold and for how much, per school.' },
  'daily-money': { group: 'Money', title: 'Daily money by bursar', about: 'Cash, bank, mobile money and control numbers per bursar per day, with the accountant\'s check.' },
  'control-numbers': { group: 'Money', title: 'Control numbers', about: 'Every control number made: waiting, paid (with the bank reference and receipt), expired or cancelled.' },
  'library-waiting': { group: 'Library', title: 'Paid but not yet given', about: 'Receipts still waiting at the library, oldest first, with the items left to give.', dates: false },
  'stock-levels': { group: 'Stock', title: 'Stock levels', about: 'What each library holds now, what is owed to parents, on the way, low and out of stock.', dates: false },
  'stock-card': { group: 'Stock', title: 'Stock card (all movements)', about: 'Every stock movement: received, given to parents, damaged / lost, with the balance after each.' },
  'deliveries': { group: 'Stock', title: 'Stock sent and received', about: 'Each delivery line: sent, received, short, who confirmed.' },
  'requests': { group: 'Stock', title: 'Stock requests', about: 'What the libraries asked for and how it was answered.' },
  'damage': { group: 'Stock', title: 'Damaged / lost', about: 'Every damaged or lost report and the decision.' },
  'student-uploads': { group: 'Students', title: 'Class lists uploaded', about: 'Every Excel class list the School Admins uploaded: school, class, file, who, when, and how many students were added, changed or moved.' },
  'students-list': { group: 'Students', title: 'Students in the system', about: 'Every student now in the system, by school and class, with the ID card state.', dates: false },
};

router.get('/', requirePage('reports'), (req, res) => {
  const list = Object.keys(REPORTS).filter((k) => canReport(req.user.role, k)).map((k) => ({ key: k, dates: INFO[k].dates !== false, ...INFO[k] }));
  res.json({ reports: list, allSchools: allSchools(req.user), today: today(),
    note: list.length ? null : 'Academic reports come with Step 3 (Academic Progress). Student lists can be downloaded on the Students page.' });
});

function params(req) {
  const t = today();
  const from = isDate(req.query.from) ? req.query.from : `${t.slice(0, 8)}01`;
  const to = isDate(req.query.to) ? req.query.to : t;
  if (from > to) throw new HttpError(400, '"From" must be before "To".');
  return { from, to, school: allSchools(req.user) ? Number(req.query.school) || null : req.user.school_id };
}
const soldIn = (q, p, col = 'r') => {
  if (p.school) q.where(`${col}.school_id`, p.school);
  return q.whereRaw(`(${col}.sold_at AT TIME ZONE '${TZ}')::date between ? and ?`, [p.from, p.to]);
};
const range = (p) => `${new Date(p.from).toLocaleDateString('en-GB')} to ${new Date(p.to).toLocaleDateString('en-GB')}`;

router.get('/:file', requirePage('reports'), async (req, res) => {
  const key = String(req.params.file).replace(/\.xlsx$/, '');
  if (!INFO[key]) throw new HttpError(404, 'Report not found.');
  if (!canReport(req.user.role, key)) throw new HttpError(403, 'Your account cannot download this report.');
  const p = params(req);
  const schoolName = p.school ? (await db('schools').where({ id: p.school }).first())?.short_name : 'All schools';
  await BUILD[key](req, res, p, schoolName);
});

const BUILD = {
  'student-uploads': async (req, res, p, schoolName) => {
    const q = db('student_imports as m').join('schools as s', 's.id', 'm.school_id').join('classes as c', 'c.id', 'm.class_id').join('users as u', 'u.id', 'm.uploaded_by')
      .leftJoin('users as d', 'd.id', 'm.decided_by').whereRaw(`(m.created_at AT TIME ZONE '${TZ}')::date between ? and ?`, [p.from, p.to]);
    if (p.school) q.where('m.school_id', p.school);
    const rows = await q.orderBy('m.created_at').limit(20000).select('m.*', 's.short_name as school', 'c.name as cls', 'c.short_name as cls_short', 'c.stream',
      'u.full_name as by', 'd.full_name as decided_by_name');
    const STATUS = { pending: 'Waiting for approval', approved: 'Saved', discarded: 'Discarded' };
    await sendExcel(res, 'musabe-class-lists-uploaded', [{
      name: 'Class lists', title: `Class lists uploaded, ${schoolName}, ${range(p)}`,
      columns: [{ header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'Uploaded on', key: 'at', type: 'date', width: 18 }, { header: 'School', key: 'school', width: 16 },
        { header: 'Class', key: 'cls', width: 16 }, { header: 'File', key: 'file', width: 28 }, { header: 'Uploaded by', key: 'by', width: 22 }, { header: 'Status', key: 'status', width: 20 },
        { header: 'New', key: 'new', type: 'int', width: 7 }, { header: 'Changed', key: 'update', type: 'int', width: 9 }, { header: 'Moved', key: 'move', type: 'int', width: 8 },
        { header: 'Back at school', key: 'back', type: 'int', width: 12 }, { header: 'Rows', key: 'rows', type: 'int', width: 7 }, { header: 'Decided by', key: 'decided', width: 22 },
        { header: 'Decided on', key: 'decidedAt', type: 'date', width: 18 }],
      rows: rows.map((m, i) => {
        const s = (typeof m.summary === 'string' ? JSON.parse(m.summary) : m.summary) || {};
        return { sn: i + 1, at: d(m.created_at), school: m.school, cls: [m.cls_short || m.cls, m.stream].filter(Boolean).join(' '), file: m.file_name, by: m.by, status: STATUS[m.status] || m.status,
          new: s.new ?? null, update: s.update ?? null, move: s.move ?? null, back: s.back ?? null, rows: s.rows ?? s.total ?? null, decided: m.decided_by_name || '', decidedAt: d(m.decided_at) };
      }),
    }]);
  },
  'students-list': async (req, res, p, schoolName) => {
    const q = db('students as st').join('schools as s', 's.id', 'st.school_id').leftJoin('classes as c', 'c.id', 'st.class_id').where('st.status', 'active');
    if (p.school) q.where('st.school_id', p.school);
    const rows = await q.orderBy('s.short_name').orderBy('c.short_name').orderBy('st.full_name').limit(50000)
      .select('st.*', 's.short_name as school', 'c.short_name as cls', 'c.stream',
        db.raw('EXISTS (SELECT 1 FROM id_cards x WHERE x.student_id = st.id AND x.ended_at IS NULL) as card'));
    await sendExcel(res, 'musabe-students', [{
      name: 'Students', title: `Students in the system, ${schoolName}`,
      columns: [{ header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'School', key: 'school', width: 16 }, { header: 'Class', key: 'cls', width: 10 },
        { header: 'Admission No.', key: 'adm', width: 16 }, { header: 'Name', key: 'name', width: 30 }, { header: 'Sex', key: 'sex', width: 6 },
        { header: 'Parent', key: 'parent', width: 24 }, { header: 'Phone', key: 'phone', width: 13 }, { header: 'ID card', key: 'card', width: 11 }, { header: 'Added on', key: 'at', type: 'date', width: 18 }],
      rows: rows.map((r, i) => ({ sn: i + 1, school: r.school, cls: [r.cls, r.stream].filter(Boolean).join(' '), adm: r.admission_no, name: r.full_name, sex: r.sex,
        parent: r.parent_name || '', phone: r.parent_phone || '', card: r.card ? 'Issued' : 'Not issued', at: d(r.created_at) })),
    }]);
  },
  // ---------- The school's own sales book layout ----------
  'sales-book': async (req, res, p) => {
    const receipts = await soldIn(db('receipts as r').join('schools as s', 's.id', 'r.school_id'), p).orderBy('s.id').orderBy('r.no')
      .select('r.*', 's.receipt_title', 's.name as school_name', 's.short_name', 's.receipt_prefix', 's.levels');
    const lines = receipts.length ? await db('receipt_lines').whereIn('receipt_id', receipts.map((r) => r.id)).orderBy('id') : [];
    const wb = new (ExcelJS().Workbook)();
    wb.creator = 'Musabe Schools System';
    const month = (r) => new Date(r.sold_at).toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7);
    const groups = new Map();
    for (const r of receipts) {
      const k = `${r.school_id}|${month(r)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    const manySchools = new Set(receipts.map((r) => r.school_id)).size > 1;
    if (!groups.size) {
      const ws = wb.addWorksheet('No sales');
      ws.addRow([`No receipts from ${range(p)}.`]);
    }
    for (const [, list] of groups) {
      const first = list[0];
      const m = new Date(first.sold_at);
      const monthName = m.toLocaleDateString('en-GB', { month: 'long', timeZone: TZ }).toUpperCase();
      const year = m.toLocaleDateString('en-GB', { year: 'numeric', timeZone: TZ });
      const name = `${manySchools ? `${first.receipt_prefix || first.short_name.slice(0, 3)} ` : ''}${monthName},${year}`.slice(0, 31);
      bookSheet(wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 5 }], pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } }),
        list, lines, first);
    }
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="UNIFORM_SALES_${p.from}_to_${p.to}.xlsx"` });
    await wb.xlsx.write(res);
    res.end();
  },

  'items-sold': async (req, res, p, schoolName) => {
    const rows = await soldIn(db('receipt_lines as l').join('receipts as r', 'r.id', 'l.receipt_id').join('schools as s', 's.id', 'r.school_id'), p)
      .groupBy('s.id', 's.short_name', 'l.item_name').orderBy('s.id').orderByRaw('sum(l.amount) desc')
      .select('s.short_name as school', 'l.item_name as item', db.raw('sum(l.qty)::int as qty, sum(l.amount)::bigint as money, sum(l.given_qty)::int as given'));
    const all = await soldIn(db('receipt_lines as l').join('receipts as r', 'r.id', 'l.receipt_id'), p).groupBy('l.item_name').orderByRaw('sum(l.amount) desc')
      .select('l.item_name as item', db.raw('sum(l.qty)::int as qty, sum(l.amount)::bigint as money'));
    const cols = [{ header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'School', key: 'school', width: 16 }, { header: 'Item', key: 'item', width: 30 },
      { header: 'Qty sold', key: 'qty', type: 'int', width: 10 }, { header: 'Given', key: 'given', type: 'int', width: 8 },
      { header: 'Not yet given', key: 'left', type: 'int', width: 13 }, { header: 'Amount (TSh)', key: 'money', type: 'money', width: 14 }];
    await sendExcel(res, 'musabe-items-sold', [
      { name: 'By school', title: `Items sold, ${schoolName}, ${range(p)}`, columns: cols,
        rows: rows.map((r, i) => ({ sn: i + 1, ...r, money: Number(r.money), left: r.qty - r.given })) },
      { name: 'All together', title: `Items sold, ${schoolName}, ${range(p)}`,
        columns: [cols[0], cols[2], cols[3], cols[6]], rows: all.map((r, i) => ({ sn: i + 1, ...r, money: Number(r.money) })) },
    ]);
  },

  'daily-money': async (req, res, p, schoolName) => {
    const { days, moneySheet } = require('./money');
    const x = await days(req.user, { from: p.from, to: p.to, school: p.school });
    await sendExcel(res, 'musabe-daily-money', [moneySheet(x.rows, `Daily money by bursar, ${schoolName}, ${range(p)} (TSh)`)]);
  },

  'control-numbers': async (req, res, p) => {
    const { list, out, COLS, billsSheet } = require('./bills');
    const rows = await list(req.user, { from: p.from, to: p.to, school: p.school }).orderBy('b.id').limit(20000).select(COLS);
    await sendExcel(res, 'musabe-control-numbers', [billsSheet(rows.map((b) => out(b, req.user)))]);
  },

  'library-waiting': async (req, res, p, schoolName) => {
    const { LATE_HOURS } = require('./receipts');
    const q = db('receipt_lines as l').join('receipts as r', 'r.id', 'l.receipt_id').join('schools as s', 's.id', 'r.school_id')
      .whereIn('r.status', ['waiting', 'part']).whereRaw('l.qty > l.given_qty');
    if (p.school) q.where('r.school_id', p.school);
    const rows = await q.orderBy('r.sold_at').select('r.number', 'r.sold_at', 'r.student_name', 'r.student_class', 'r.payer_name', 'r.payer_phone',
      's.short_name as school', 'l.item_name', 'l.qty', 'l.given_qty');
    await sendExcel(res, 'musabe-not-given', [{
      name: 'Not yet given', title: `Paid but not yet given, ${schoolName}, on ${new Date().toLocaleDateString('en-GB', { timeZone: TZ })}`,
      columns: [{ header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'Receipt no.', key: 'number', width: 12 }, { header: 'Paid on', key: 'at', type: 'date', width: 18 },
        { header: 'Days waiting', key: 'days', type: 'int', width: 12 }, { header: 'School', key: 'school', width: 16 }, { header: 'Student', key: 'student_name', width: 26 },
        { header: 'Class', key: 'student_class', width: 10 }, { header: 'Parent', key: 'payer_name', width: 22 }, { header: 'Phone', key: 'payer_phone', width: 12 },
        { header: 'Item', key: 'item_name', width: 26 }, { header: 'Left to give', key: 'left', type: 'int', width: 12 }, { header: 'Late', key: 'late', width: 6 }],
      rows: rows.map((r, i) => {
        const h = (Date.now() - new Date(r.sold_at)) / 3600000;
        return { sn: i + 1, ...r, at: d(r.sold_at), days: Math.floor(h / 24), left: r.qty - r.given_qty, late: h >= LATE_HOURS ? 'Yes' : '' };
      }),
    }]);
  },

  'stock-levels': async (req, res, p) => {
    const { levels, stockSheet } = require('./stock');
    await sendExcel(res, 'musabe-stock-levels', [stockSheet(await levels(req.user, { school: p.school }))]);
  },

  'stock-card': async (req, res, p, schoolName) => {
    const { movesQuery, moveOut } = require('./stock');
    const rows = (await movesQuery(req.user, { school: p.school, from: p.from, to: p.to }).orderBy('s.id').orderBy('i.name').orderBy('m.id').limit(50000)).map(moveOut);
    await sendExcel(res, 'musabe-stock-card', [{
      name: 'Stock card', title: `Stock card, ${schoolName}, ${range(p)}`,
      columns: [{ header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'Date', key: 'at', type: 'date', width: 18 }, { header: 'School', key: 'school', width: 16 },
        { header: 'Item', key: 'item', width: 28 }, { header: 'Movement', key: 'kindLabel', width: 16 }, { header: 'In', key: 'in', type: 'int', width: 8 },
        { header: 'Out', key: 'out', type: 'int', width: 8 }, { header: 'Balance', key: 'balance', type: 'int', width: 9 }, { header: 'Paper', key: 'ref', width: 12 },
        { header: 'Note', key: 'note', width: 26 }, { header: 'By', key: 'by', width: 20 }],
      rows: rows.map((m, i) => ({ sn: i + 1, ...m, at: d(m.at), in: m.change > 0 ? m.change : null, out: m.change < 0 ? -m.change : null })),
    }]);
  },

  deliveries: async (req, res, p, schoolName) => {
    const { deliveries, withLines, DCOLS } = require('./stock');
    const list = await withLines(await deliveries(req.user, { school: p.school, from: p.from, to: p.to }).orderBy('d.id').limit(5000).select(DCOLS));
    const rows = list.flatMap((x) => x.lines.map((l) => ({ ...l, number: x.number, school: x.school, status: x.statusLabel, sentBy: x.sentBy, sentAt: d(x.sentAt),
      confirmedAt: d(l.confirmedAt), request: x.requestNumber })));
    await sendExcel(res, 'musabe-deliveries', [{
      name: 'Deliveries', title: `Stock sent and received, ${schoolName}, ${range(p)}`,
      columns: [{ header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'Delivery', key: 'number', width: 11 }, { header: 'Sent on', key: 'sentAt', type: 'date', width: 18 },
        { header: 'School', key: 'school', width: 16 }, { header: 'Item', key: 'name', width: 28 }, { header: 'Sent', key: 'qty', type: 'int', width: 7 },
        { header: 'Received', key: 'received', type: 'int', width: 10 }, { header: 'Short', key: 'short', type: 'int', width: 7 }, { header: 'Note', key: 'note', width: 22 },
        { header: 'Status', key: 'status', width: 12 }, { header: 'Sent by', key: 'sentBy', width: 20 }, { header: 'Confirmed by', key: 'confirmedBy', width: 20 },
        { header: 'Confirmed on', key: 'confirmedAt', type: 'date', width: 18 }, { header: 'For request', key: 'request', width: 11 }],
      rows: rows.map((r, i) => ({ sn: i + 1, ...r })),
    }]);
  },

  requests: async (req, res, p, schoolName) => {
    const { list, withLines, COLS } = require('./requests');
    const all = await withLines(await list(req.user, { school: p.school, from: p.from, to: p.to }).orderBy('q.id').limit(5000).select(COLS), req.user);
    const rows = all.flatMap((x) => x.lines.map((l) => ({ number: x.number, at: d(x.requestedAt), school: x.school, item: l.name, qty: l.qty, sent: l.sent,
      status: x.statusLabel, by: x.requestedBy, answeredBy: x.answeredBy, answer: x.answerNote, note: x.note })));
    await sendExcel(res, 'musabe-stock-requests', [{
      name: 'Requests', title: `Stock requests, ${schoolName}, ${range(p)}`,
      columns: [{ header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'Request', key: 'number', width: 11 }, { header: 'Asked on', key: 'at', type: 'date', width: 18 },
        { header: 'School', key: 'school', width: 16 }, { header: 'Item', key: 'item', width: 28 }, { header: 'Asked', key: 'qty', type: 'int', width: 8 },
        { header: 'Sent', key: 'sent', type: 'int', width: 7 }, { header: 'Status', key: 'status', width: 12 }, { header: 'Note', key: 'note', width: 22 },
        { header: 'Asked by', key: 'by', width: 20 }, { header: 'Answered by', key: 'answeredBy', width: 20 }, { header: 'Answer', key: 'answer', width: 26 }],
      rows: rows.map((r, i) => ({ sn: i + 1, ...r })),
    }]);
  },

  damage: async (req, res, p, schoolName) => {
    const { list, out, COLS } = require('./damage');
    const rows = (await list(req.user, { school: p.school, from: p.from, to: p.to }).orderBy('d.id').limit(10000).select(COLS)).map((x) => out(x, req.user));
    await sendExcel(res, 'musabe-damaged-lost', [{
      name: 'Damaged - lost', title: `Damaged / lost, ${schoolName}, ${range(p)}`,
      columns: [{ header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'Report', key: 'number', width: 11 }, { header: 'Reported on', key: 'reportedAt', type: 'date', width: 18 },
        { header: 'School', key: 'school', width: 16 }, { header: 'Item', key: 'item', width: 26 }, { header: 'Qty', key: 'qty', type: 'int', width: 6 },
        { header: 'Damaged / lost', key: 'kindLabel', width: 14 }, { header: 'What happened', key: 'reason', width: 30 }, { header: 'Status', key: 'statusLabel', width: 20 },
        { header: 'Reported by', key: 'reportedBy', width: 20 }, { header: 'Decided by', key: 'decidedBy', width: 20 }, { header: 'Decided on', key: 'decidedAt', type: 'date', width: 18 },
        { header: 'Decision note', key: 'decisionNote', width: 26 }],
      rows: rows.map((r, i) => ({ sn: i + 1, ...r, reportedAt: d(r.reportedAt), decidedAt: d(r.decidedAt) })),
    }]);
  },
};

// One month of one school, laid out like UNIFORM SALES-2026.xlsx.
function bookSheet(ws, receipts, allLines, school) {
  const secondary = /form/i.test(school.levels || '') || /SEC/i.test(school.receipt_title || '');
  const thin = { style: 'thin' };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const widths = [12.3, 12, 31, 11.6, 28, 11.7, 14.7, 19.1, 16];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.addRow([]);
  const t1 = ws.addRow([school.receipt_title || school.school_name.toUpperCase()]);
  ws.mergeCells(t1.number, 1, t1.number, 9);
  t1.getCell(1).font = { bold: true, size: 22 }; t1.getCell(1).alignment = { horizontal: 'center' };
  const t2 = ws.addRow(['SCHOOL UNIFORM RECEIPT & CONTRIBUTIONS PAYMENT ANALYSIS']);
  ws.mergeCells(t2.number, 1, t2.number, 9);
  t2.getCell(1).font = { bold: true, size: 14 }; t2.getCell(1).alignment = { horizontal: 'center' };
  ws.addRow([]);
  const head = ws.addRow(['DATE', 'REC.NO.', "STUDENT'S NAME", secondary ? 'FORM' : 'CLASS', 'ITEM DESCRIPTION', 'ITEM NO.', 'ITEM AMOUNT', 'GRAND TOTAL', 'PAID WITH']);
  head.eachCell((c) => { c.font = { bold: true }; c.border = border; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  const firstData = head.number + 1;
  const byReceipt = new Map();
  for (const l of allLines) { if (!byReceipt.has(l.receipt_id)) byReceipt.set(l.receipt_id, []); byReceipt.get(l.receipt_id).push(l); }
  const methods = { cash: 0, bank: 0, mobile: 0, control: 0 };
  for (const r of receipts) {
    const ls = byReceipt.get(r.id) || [];
    const day = new Date(new Date(r.sold_at).toLocaleDateString('en-CA', { timeZone: TZ }));
    const start = ws.rowCount + 1;
    ls.forEach((l, i) => {
      const last = i === ls.length - 1;
      const row = ws.addRow([day, r.number, safeText(r.student_name), safeText(r.student_class), safeText(l.item_name), l.qty, l.amount, null, last ? (METHODS[r.method] || r.method) : null]);
      if (last) row.getCell(8).value = ls.length > 1 ? { formula: `SUM(G${start}:G${row.number})`, result: r.total } : r.total;
      row.eachCell({ includeEmpty: true }, (c) => { c.border = border; });
      row.getCell(1).numFmt = 'dd/mm/yyyy';
      row.getCell(7).numFmt = '#,##0'; row.getCell(8).numFmt = '#,##0';
      if (last) row.getCell(8).font = { bold: true };
    });
    methods[r.method] = (methods[r.method] || 0) + r.total;
    if (ls.length > 1) ws.addRow([]);
  }
  const lastData = ws.rowCount;
  const sum = receipts.reduce((s, r) => s + r.total, 0);
  const tot = ws.addRow([null, null, 'TOTAL AMOUNT COLLECTED', null, null, null,
    { formula: `SUM(G${firstData}:G${lastData})`, result: sum }, { formula: `SUM(H${firstData}:H${lastData})`, result: sum }]);
  ws.mergeCells(tot.number, 3, tot.number, 5);
  tot.eachCell((c) => { c.font = { bold: true }; c.border = border; });
  tot.getCell(7).numFmt = '#,##0'; tot.getCell(8).numFmt = '#,##0';
  ws.addRow([]);
  const label = ws.addRow([null, null, 'BY PAYMENT']);
  label.getCell(3).font = { bold: true };
  for (const [k, v] of Object.entries(methods)) {
    if (!v) continue;
    const r = ws.addRow([null, null, METHODS[k], null, null, null, null, v]);
    r.getCell(8).numFmt = '#,##0';
  }
  const cnt = ws.addRow([null, null, 'NUMBER OF RECEIPTS', null, null, null, null, receipts.length]);
  cnt.getCell(3).font = { bold: true };
}

module.exports = router;
