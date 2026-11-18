// Selling and giving (Library step 2).
// - Bursar (own school): takes the full payment and writes a receipt.            POST /api/receipts
//   Numbers: REC.0001, REC.0002 ... in each school's own book, without gaps.
// - Librarian (own school): gives the items against the receipt, all or part.   POST /api/receipts/:id/give
// - Administration and Head Master: watch every receipt live, see what waits too long, download Excel.
// No role can cancel, delete or change a receipt (the database refuses it too, see migration 007).
const express = require('express');
const db = require('../db');
const { HttpError, audit, tzPhone } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES } = require('../auth/roles');
const { sendExcel } = require('../lib/excel');
const { publish } = require('../realtime');
const stock = require('../lib/stock');

const router = express.Router();
router.use(requireAuth);

// A receipt that is paid but not fully given after this many hours is "late": shown in red and an alert goes out.
const LATE_HOURS = Number(process.env.RECEIPT_LATE_HOURS) || 24;
const TZ = 'Africa/Dar_es_Salaam';
const METHODS = { cash: 'Cash', bank: 'Bank', mobile: 'Mobile money', control: 'Control number' };
const STATUS = { waiting: 'Waiting at library', part: 'Partly given', given: 'Given' };
const money = (n) => `TSh ${Number(n).toLocaleString('en-GB')}`;
const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// 462 -> REC.0462 (like the receipt book)
const receiptNumber = (n) => `REC.${String(n).padStart(4, '0')}`;

// ---------- Reading receipts ----------
function base(user, f = {}) {
  const q = db('receipts as r')
    .join('schools as s', 's.id', 'r.school_id')
    .join('users as u', 'u.id', 'r.sold_by');
  if (!allSchools(user)) q.where('r.school_id', user.school_id);
  else if (f.school) q.where('r.school_id', Number(f.school));
  if (f.status === 'open') q.whereIn('r.status', ['waiting', 'part']);
  else if (f.status === 'late') q.whereIn('r.status', ['waiting', 'part']).whereRaw(`r.sold_at < now() - make_interval(hours => ?)`, [LATE_HOURS]);
  else if (STATUS[f.status]) q.where('r.status', f.status);
  if (f.method && METHODS[f.method]) q.where('r.method', f.method);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.from || '')) q.whereRaw(`(r.sold_at AT TIME ZONE '${TZ}')::date >= ?`, [f.from]);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.to || '')) q.whereRaw(`(r.sold_at AT TIME ZONE '${TZ}')::date <= ?`, [f.to]);
  if (f.mine) q.where('r.sold_by', user.id);
  if (Number(f.student)) q.where('r.student_id', Number(f.student));
  const text = clean(f.q, 60);
  if (text) {
    const like = `%${text}%`;
    // "12" finds EM-000012; words find the student, payer or reference.
    q.where((w) => {
      w.whereILike('r.number', like).orWhereILike('r.student_name', like).orWhereILike('r.payer_name', like).orWhereILike('r.reference', like);
      const digits = text.replace(/^rec\.?\s*/i, '');
      if (/^\d{1,9}$/.test(digits)) w.orWhere('r.no', Number(digits));
    });
  }
  return q;
}

const COLS = ['r.*', 's.code as school_code', 's.short_name as school_short', 's.name as school_name', 's.receipt_title', 's.receipt_contact', 's.receipt_signer',
  'u.full_name as sold_by_name'];

function out(r) {
  const hours = (Date.now() - new Date(r.sold_at).getTime()) / 3600000;
  return {
    id: r.id, number: r.number, no: r.no,
    school: { id: r.school_id, code: r.school_code, shortName: r.school_short, name: r.school_name,
      receiptTitle: r.receipt_title || r.school_name.toUpperCase(), receiptContact: r.receipt_contact || '', receiptSigner: r.receipt_signer || '' },
    studentId: r.student_id, studentName: r.student_name, studentClass: r.student_class, gender: r.gender,
    payerName: r.payer_name, payerPhone: r.payer_phone, method: r.method, methodLabel: METHODS[r.method], reference: r.reference,
    total: r.total, note: r.note, status: r.status, statusLabel: STATUS[r.status],
    soldBy: r.sold_by_name, soldAt: r.sold_at, givenAt: r.given_at,
    waitingHours: r.status === 'given' ? null : Math.floor(hours),
    late: r.status !== 'given' && hours >= LATE_HOURS,
  };
}

async function one(user, id) {
  const r = await base(user).where('r.id', Number(id)).first(COLS);
  if (!r) throw new HttpError(404, 'Receipt not found.');
  const lines = await db('receipt_lines').where({ receipt_id: r.id }).orderBy('id');
  const gives = await db('gives as g').join('users as u', 'u.id', 'g.given_by').where('g.receipt_id', r.id).orderBy('g.at')
    .select('g.id', 'g.at', 'g.collected_by', 'g.note', 'u.full_name as given_by');
  const gl = await db('give_lines as l').join('receipt_lines as rl', 'rl.id', 'l.receipt_line_id')
    .whereIn('l.give_id', gives.map((g) => g.id)).select('l.give_id', 'l.qty', 'rl.item_name');
  return {
    ...out(r),
    lines: lines.map((l) => ({ id: l.id, itemId: l.item_id, name: l.item_name, category: l.category, unitPrice: l.unit_price,
      qty: l.qty, amount: l.amount, given: l.given_qty, left: l.qty - l.given_qty, outOfStock: l.out_of_stock })),
    gives: gives.map((g) => ({ id: g.id, at: g.at, givenBy: g.given_by, collectedBy: g.collected_by, note: g.note,
      lines: gl.filter((l) => l.give_id === g.id).map((l) => ({ name: l.item_name, qty: l.qty })) })),
  };
}

// The receipts page: list + figures for the same filters.
router.get('/', requirePage('receipts'), async (req, res) => {
  const f = req.query;
  const limit = Math.min(Number(f.limit) || 200, 500);
  const [rows, [sum], [today], [open]] = await Promise.all([
    base(req.user, f).orderBy('r.sold_at', 'desc').limit(limit).select(COLS),
    base(req.user, f).select(db.raw('count(*)::int as n, coalesce(sum(r.total),0)::bigint as money')),
    base(req.user, { school: f.school }).whereRaw(`(r.sold_at AT TIME ZONE '${TZ}')::date = (now() AT TIME ZONE '${TZ}')::date`)
      .select(db.raw(`count(*)::int as n, coalesce(sum(r.total),0)::bigint as money,
        coalesce(sum(r.total) filter (where r.method='cash'),0)::bigint as cash,
        coalesce(sum(r.total) filter (where r.method='bank'),0)::bigint as bank,
        coalesce(sum(r.total) filter (where r.method='mobile'),0)::bigint as mobile,
        coalesce(sum(r.total) filter (where r.method='control'),0)::bigint as control`)),
    base(req.user, { school: f.school }).whereIn('r.status', ['waiting', 'part'])
      .select(db.raw(`count(*)::int as n, (count(*) filter (where r.sold_at < now() - make_interval(hours => ?)))::int as late`, [LATE_HOURS])),
  ]);
  res.json({
    receipts: rows.map(out), more: Number(sum.n) > rows.length, lateHours: LATE_HOURS,
    totals: { count: Number(sum.n), money: Number(sum.money) },
    today: { count: today.n, money: Number(today.money), cash: Number(today.cash), bank: Number(today.bank), mobile: Number(today.mobile), control: Number(today.control) },
    open: { count: open.n, late: open.late },
  });
});

// ---------- Excel ----------
router.get('/export.xlsx', requirePage('receipts'), async (req, res) => {
  const rows = await base(req.user, req.query).orderBy('r.sold_at').limit(20000).select(COLS);
  const lines = rows.length ? await db('receipt_lines').whereIn('receipt_id', rows.map((r) => r.id)).orderBy('id') : [];
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const when = (d) => d && new Date(d);
  await sendExcel(res, 'musabe-receipts', [
    {
      name: 'Receipts', title: 'Musabe Schools: receipts (TSh)',
      columns: [
        { header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'Receipt no.', key: 'number', width: 13 },
        { header: 'Date', key: 'at', type: 'date', width: 18 }, { header: 'School', key: 'school', width: 16 },
        { header: 'Student', key: 'student', width: 26 }, { header: 'Class', key: 'cls', width: 10 }, { header: 'Gender', key: 'gender', width: 8 },
        { header: 'Paid by', key: 'payer', width: 22 }, { header: 'Phone', key: 'phone', width: 12 },
        { header: 'Method', key: 'method', width: 13 }, { header: 'Reference', key: 'ref', width: 16 },
        { header: 'Amount', key: 'total', type: 'money', width: 12 }, { header: 'Status', key: 'status', width: 18 },
        { header: 'Given on', key: 'given', type: 'date', width: 18 }, { header: 'Bursar', key: 'by', width: 22 },
      ],
      rows: rows.map((r, i) => ({ sn: i + 1, number: r.number, at: when(r.sold_at), school: r.school_short, student: r.student_name,
        cls: r.student_class, gender: r.gender === 'boy' ? 'Boy' : r.gender === 'girl' ? 'Girl' : '', payer: r.payer_name, phone: r.payer_phone,
        method: METHODS[r.method], ref: r.reference, total: r.total, status: STATUS[r.status], given: when(r.given_at), by: r.sold_by_name })),
    },
    {
      name: 'Items sold', title: 'Musabe Schools: items on each receipt (TSh)',
      columns: [
        { header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'Receipt no.', key: 'number', width: 13 },
        { header: 'Date', key: 'at', type: 'date', width: 18 }, { header: 'School', key: 'school', width: 16 },
        { header: 'Student', key: 'student', width: 26 }, { header: 'Item', key: 'item', width: 28 },
        { header: 'Qty', key: 'qty', type: 'int', width: 6 }, { header: 'Unit price', key: 'unit', type: 'money', width: 12 },
        { header: 'Amount', key: 'amount', type: 'money', width: 12 }, { header: 'Given', key: 'given', type: 'int', width: 7 },
        { header: 'Not yet given', key: 'left', type: 'int', width: 13 },
      ],
      rows: lines.map((l, i) => {
        const r = byId[l.receipt_id];
        return { sn: i + 1, number: r.number, at: when(r.sold_at), school: r.school_short, student: r.student_name, item: l.item_name,
          qty: l.qty, unit: l.unit_price, amount: l.amount, given: l.given_qty, left: l.qty - l.given_qty };
      }),
    },
  ]);
});

// For the Sell screen: how many of each item the library can still give (stock less what is paid and not collected).
router.get('/availability', requirePage('sell'), async (req, res) => {
  const ids = (await db('item_prices').where({ school_id: req.user.school_id }).pluck('item_id'));
  res.json({ free: await freeStock(db, req.user.school_id, ids) });
});

router.get('/:id', requirePage('receipts'), async (req, res) => {
  res.json({ receipt: await one(req.user, req.params.id) });
});

// ---------- Sell: write a receipt ----------
// Reads and checks what the bursar typed: the student, the payer and the items with today's prices.
// Used by Sell (receipt now) and by Control numbers (receipt later, when the bank payment is seen).
async function readSale(school, b) {
  // The student comes from the list (School Admin keeps it). Typing a name is only for students not yet in the list.
  let student = null;
  if (b.studentId != null && b.studentId !== '') {
    student = await db('students as s').leftJoin('classes as c', 'c.id', 's.class_id')
      .where({ 's.id': Number(b.studentId) || 0, 's.school_id': school.id }).first('s.*', 'c.short_name as class_short', 'c.stream as class_stream');
    if (!student) throw new HttpError(400, 'Student not found in your school. Search again.');
    if (student.status !== 'active') throw new HttpError(400, `${student.full_name} is marked as left school.`);
  }
  const studentName = student ? student.full_name : clean(b.studentName, 120).toUpperCase();
  const studentClass = student ? ([student.class_short, student.class_stream].filter(Boolean).join(' ') || '-') : clean(b.studentClass, 40).toUpperCase();
  if (student) b.gender = student.sex === 'M' ? 'boy' : 'girl';
  if (studentName.length < 3) throw new HttpError(400, "Type the student's full name.");
  if (!studentClass) throw new HttpError(400, "Type the student's class, e.g. STD 4 or FORM 1.");
  const payerName = clean(b.payerName, 120).toUpperCase() || null;
  const payerPhone = tzPhone(b.payerPhone);
  const note = clean(b.note, 200) || null;

  // Lines: the same item twice becomes one line.
  const want = new Map();
  for (const l of Array.isArray(b.lines) ? b.lines : []) {
    const id = Number(l?.itemId), qty = Number(l?.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 500) throw new HttpError(400, 'Each item needs a quantity from 1 to 500.');
    want.set(id, (want.get(id) || 0) + qty);
  }
  if (!want.size) throw new HttpError(400, 'Add at least one item.');
  if (want.size > 40) throw new HttpError(400, 'Too many different items on one receipt (more than 40).');

  const items = await db('items as i').join('item_prices as p', 'p.item_id', 'i.id')
    .whereIn('i.id', [...want.keys()]).andWhere('p.school_id', school.id).select('i.*', 'p.price', 'p.price_boys', 'p.price_girls');
  const found = Object.fromEntries(items.map((i) => [i.id, i]));
  let gender = null;
  if (items.some((i) => i.gender_priced)) {
    gender = school.students === 'boys' ? 'boy' : school.students === 'girls' ? 'girl' : ['boy', 'girl'].includes(b.gender) ? b.gender : null;
    if (!gender) throw new HttpError(400, 'Choose boy or girl: some items have a different price for boys and girls.');
  } else if (['boy', 'girl'].includes(b.gender)) gender = b.gender;

  const lines = [];
  for (const [id, qty] of want) {
    const i = found[id];
    if (!i) throw new HttpError(400, 'One of the items is not sold in your school. Reload the page.');
    if (!i.active) throw new HttpError(400, `${i.name} is no longer sold.`);
    const unit = i.gender_priced ? (gender === 'boy' ? i.price_boys : i.price_girls) : i.price;
    if (!unit) throw new HttpError(400, `${i.name} has no ${gender} price in your school.`);
    lines.push({ item_id: i.id, item_name: i.name, category: i.category, unit_price: unit, qty, amount: unit * qty });
  }
  const total = lines.reduce((s, l) => s + l.amount, 0);
  // The screen shows the total before saving; if a price changed in between, stop so the bursar sees the new total.
  if (b.expectTotal != null && Number(b.expectTotal) !== total)
    throw new HttpError(409, `A price has just changed. The new total is ${money(total)}. Check the items and save again.`);
  return { student, studentName, studentClass, gender, payerName, payerPhone, note, lines, total };
}

// What the library can still give of each item: the stock, less what is already paid for and not yet collected.
// The bursar may sell more than this (2026-11-16): the receipt then says the child gets it when it arrives.
async function freeStock(conn, schoolId, itemIds) {
  if (!itemIds.length) return {};
  const [levels, owed] = await Promise.all([
    conn('stock_levels').where({ school_id: schoolId }).whereIn('item_id', itemIds).select('item_id', 'qty'),
    conn('receipt_lines as l').join('receipts as r', 'r.id', 'l.receipt_id').where('r.school_id', schoolId).whereIn('r.status', ['waiting', 'part'])
      .whereIn('l.item_id', itemIds).groupBy('l.item_id').select('l.item_id', conn.raw('sum(l.qty - l.given_qty)::int as n')),
  ]);
  const out = Object.fromEntries(itemIds.map((id) => [id, 0]));
  for (const l of levels) out[l.item_id] = l.qty;
  for (const o of owed) out[o.item_id] -= o.n;
  return out;
}

// Write the receipt inside a transaction. Takes the next number of the school's receipt book.
async function writeReceipt(trx, req, schoolId, sale, { method, reference, clientKey = null, billId = null }) {
  // Next number for this school. The row stays locked until the receipt is saved, so numbers never repeat or skip.
  const [s] = await trx('schools').where({ id: schoolId }).increment('last_receipt_no', 1).returning(['last_receipt_no']);
  const number = receiptNumber(s.last_receipt_no);
  const [{ id: rid }] = await trx('receipts').insert({
    school_id: schoolId, no: s.last_receipt_no, number, student_id: sale.student?.id ?? sale.studentId ?? null, student_name: sale.studentName,
    student_class: sale.studentClass, gender: sale.gender, payer_name: sale.payerName, payer_phone: sale.payerPhone, method, reference,
    total: sale.total, note: sale.note, client_key: clientKey, sold_by: req.user.id, bill_id: billId,
  }).returning('id');
  // Lines the library cannot give now (not enough in stock) are marked: the receipt and the parents say "given when it arrives".
  const free = await freeStock(trx, schoolId, sale.lines.map((l) => l.item_id));
  const short = new Set(sale.lines.filter((l) => free[l.item_id] < l.qty).map((l) => l.item_id));
  await trx('receipt_lines').insert(sale.lines.map((l) => ({
    receipt_id: rid, item_id: l.item_id, item_name: l.item_name, category: l.category, unit_price: l.unit_price, qty: l.qty, amount: l.amount, out_of_stock: short.has(l.item_id) })));
  const what = sale.lines.map((l) => `${l.qty} × ${l.item_name}`).join(', ');
  const sid = sale.student?.id ?? sale.studentId ?? null;
  if (sid) {
    const missing = sale.lines.filter((l) => short.has(l.item_id)).map((l) => l.item_name);
    await require('../lib/parents').notice(trx, { studentId: sid, schoolId, kind: 'receipt', ref: number, title: `Paid: receipt ${number}`,
      body: `${money(sale.total)} paid for ${sale.studentName}: ${what}. ${missing.length ? `Not in the library now: ${missing.join(', ')}. Your child will get ${missing.length === 1 ? 'it' : 'them'} when ${missing.length === 1 ? 'it arrives' : 'they arrive'}.` : 'Collect at the library with the receipt.'}` });
  }
  if (short.size) await audit(req, 'receipt.short', `Receipt ${number}: sold while the library has not enough: ${sale.lines.filter((l) => short.has(l.item_id)).map((l) => l.item_name).join(', ')}. Given when it arrives`,
    { schoolId, detail: { receiptId: rid } }, trx);
  await audit(req, 'receipt.create', `Receipt ${number}: ${money(sale.total)} ${METHODS[method].toLowerCase()} for ${sale.studentName} (${sale.studentClass}): ${what}`,
    { schoolId, detail: { receiptId: rid, billId } }, trx);
  return { id: rid, number };
}

router.post('/', requirePage('sell', 'f'), async (req, res) => {
  const b = req.body || {};
  const school = await db('schools').where({ id: req.user.school_id }).first();
  if (!school?.active) throw new HttpError(400, 'Your school is switched off.');

  // A double click (or a slow network that sends twice) returns the first receipt instead of writing a second one.
  const key = /^[\w-]{8,40}$/.test(b.key || '') ? b.key : null;
  if (key) {
    const done = await db('receipts').where({ client_key: key }).first('id', 'sold_by');
    if (done && done.sold_by === req.user.id) return res.json({ receipt: await one(req.user, done.id), repeated: true });
  }
  const method = String(b.method || '');
  if (method === 'control') throw new HttpError(400, 'For a control number, use "Make control number": the receipt is written when the payment is seen.');
  if (!METHODS[method]) throw new HttpError(400, 'Choose how it was paid: cash, bank or mobile money.');
  const reference = clean(b.reference, 60).toUpperCase() || null;
  if (method !== 'cash' && !reference) throw new HttpError(400, method === 'bank' ? 'Type the bank slip number.' : 'Type the mobile money transaction number.');
  const sale = await readSale(school, b);

  let id;
  try {
    id = (await db.transaction((trx) => writeReceipt(trx, req, school.id, sale, { method, reference, clientKey: key }))).id;
  } catch (e) {
    if (e.code === '23505' && key) { // the same sale arrived twice at the same moment
      const done = await db('receipts').where({ client_key: key }).first('id');
      if (done) return res.json({ receipt: await one(req.user, done.id), repeated: true });
    }
    throw e;
  }
  res.status(201).json({ receipt: await one(req.user, id) });
});

// ---------- Give: the library hands the items over ----------
router.post('/:id/give', requirePage('give', 'f'), async (req, res) => {
  const b = req.body || {};
  const collectedBy = clean(b.collectedBy, 120).toUpperCase() || null;
  const note = clean(b.note, 200) || null;
  const want = new Map();
  for (const l of Array.isArray(b.lines) ? b.lines : []) {
    const id = Number(l?.lineId), qty = Number(l?.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 0) throw new HttpError(400, 'Quantities must be whole numbers.');
    if (qty > 0) want.set(id, (want.get(id) || 0) + qty);
  }
  if (!want.size) throw new HttpError(400, 'Tick at least one item to give.');

  const result = await db.transaction(async (trx) => {
    // Lock the receipt: two librarians cannot give the same items at once.
    const r = await trx('receipts').where({ id: Number(req.params.id), school_id: req.user.school_id }).forUpdate().first();
    if (!r) throw new HttpError(404, 'Receipt not found in your school.');
    if (r.status === 'given') throw new HttpError(409, `All items on ${r.number} were already given.`);
    const lines = await trx('receipt_lines').where({ receipt_id: r.id }).orderBy('id');
    const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
    for (const [lineId, qty] of want) {
      const l = byId[lineId];
      if (!l) throw new HttpError(400, 'An item is not on this receipt. Reload the page.');
      if (qty > l.qty - l.given_qty) throw new HttpError(409, `${l.item_name}: only ${l.qty - l.given_qty} left to give on this receipt.`);
    }
    const [{ id: gid }] = await trx('gives').insert({ receipt_id: r.id, school_id: r.school_id, collected_by: collectedBy, note, given_by: req.user.id }).returning('id');
    await trx('give_lines').insert([...want].map(([lineId, qty]) => ({ give_id: gid, receipt_line_id: lineId, item_id: byId[lineId].item_id, qty })));
    for (const [lineId, qty] of want) await trx('receipt_lines').where({ id: lineId }).increment('given_qty', qty);
    // Stock goes down. Not enough recorded = refused (the whole give is undone).
    const low = [];
    const perItem = new Map();
    for (const [lineId, qty] of want) perItem.set(byId[lineId].item_id, { name: byId[lineId].item_name, qty: (perItem.get(byId[lineId].item_id)?.qty || 0) + qty });
    for (const [itemId, x] of perItem) {
      const m = await stock.move(trx, { schoolId: r.school_id, itemId, itemName: x.name, change: -x.qty, kind: 'give', ref: r.number, refId: gid, by: req.user.id });
      if (m.low) low.push(`${x.name} (${m.after} left, reorder at ${m.reorder})`);
    }
    const left = lines.reduce((s, l) => s + l.qty - l.given_qty - (want.get(l.id) || 0), 0);
    const status = left === 0 ? 'given' : 'part';
    await trx('receipts').where({ id: r.id }).update({ status, given_at: status === 'given' ? trx.fn.now() : null });
    const what = [...want].map(([lineId, qty]) => `${qty} × ${byId[lineId].item_name}`).join(', ');
    await audit(req, 'give.create', `${status === 'given' ? 'Gave all items' : 'Gave part of the items'} on ${r.number} (${r.student_name}): ${what}`
      + (collectedBy ? `. Collected by ${collectedBy}` : '') + (left ? `. ${plural(left, 'item')} still to give` : ''),
    { schoolId: r.school_id, detail: { receiptId: r.id, giveId: gid } }, trx);
    publish({ topics: ['receipt', 'stock'], schoolId: r.school_id }, trx); // receipts and stock screens refresh too
    // The parents' app tells the parents that the child collected what they paid for.
    if (r.student_id) await require('../lib/parents').notice(trx, { studentId: r.student_id, schoolId: r.school_id, kind: 'given', ref: r.number,
      title: 'Collected from the library', body: `${r.student_name} collected ${what} paid on receipt ${r.number}${left ? `. ${plural(left, 'item')} still to collect` : ''}.` });
    if (low.length) await audit(req, 'stock.low', `Low stock at the library: ${low.join(', ')}`, { schoolId: r.school_id }, trx);
    return { status, left };
  });
  res.json({ ...result, receipt: await one(req.user, req.params.id) });
});

// ---------- Alerts: receipts paid but not given for too long ----------
// Runs every few minutes (src/server.js start). Each late receipt is announced once, to its school's library
// staff and to administration (through the activity log and the notification bell).
async function alertLate(hours = LATE_HOURS) {
  const rows = await db('receipts as r').join('schools as s', 's.id', 'r.school_id')
    .whereIn('r.status', ['waiting', 'part']).whereNull('r.late_alerted_at')
    .whereRaw('r.sold_at < now() - make_interval(hours => ?)', [hours])
    .orderBy('r.sold_at').limit(200).select('r.id');
  for (const { id } of rows) {
    await db.transaction(async (trx) => {
      // Claim it: with several server processes, only one sends the alert.
      const [r] = await trx('receipts').where({ id }).whereNull('late_alerted_at').update({ late_alerted_at: trx.fn.now() }).returning('*');
      if (!r) return;
      await audit({ ip: null, user: null }, 'receipt.late',
        `Late: ${r.number} (${r.student_name}, ${money(r.total)}) was paid more than ${hours} hours ago and ${r.status === 'part' ? 'some items are' : 'the items are'} not yet given`,
        { schoolId: r.school_id, detail: { receiptId: r.id } }, trx);
    });
  }
  return rows.length;
}

module.exports = router;
module.exports.alertLate = alertLate;
module.exports.LATE_HOURS = LATE_HOURS;
module.exports.readSale = readSale;
module.exports.writeReceipt = writeReceipt;
module.exports.METHODS = METHODS;
module.exports.receiptOne = one;
