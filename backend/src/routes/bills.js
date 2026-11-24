// Control numbers (bills).
// The bursar makes a control number for the items the parent wants. The parent pays at the bank, an agent
// or by mobile money using that number. When the money is seen on the school account, the bursar or the
// accountant marks it paid with the bank / mobile money transaction number: the receipt is written then,
// from the same gap-free receipt book, and the library can give the items.
//
// - The price is fixed when the number is made (the parent was told that amount).
// - A control number is valid for BILL_DAYS days (7 by default). After that it must be renewed before it is paid.
// - An unpaid control number can be cancelled (with a reason). A paid one never changes (database guard, migration 012).
//
// Number: 12 digits = 88 + school (2 digits) + running number (7 digits) + a check digit (Luhn),
// so a mistyped number is caught. Later a bank can send payments to POST /api/bills/:id/paid automatically.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES, pageAccess } = require('../auth/roles');
const { sendExcel } = require('../lib/excel');
const { readSale, writeReceipt, receiptOne } = require('./receipts');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const DAYS = Number(process.env.BILL_DAYS) || 7;
const PREFIX = '88';
const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const money = (n) => `TSh ${Number(n).toLocaleString('en-GB')}`;
const STATUS = { pending: 'Waiting for payment', expired: 'Expired (not paid)', paid: 'Paid', cancelled: 'Cancelled' };

// Luhn check digit: catches one wrong digit and most swapped digits.
function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
}
const controlNo = (schoolId, n) => { const body = `${PREFIX}${String(schoolId).padStart(2, '0')}${String(n).padStart(7, '0')}`; return body + luhn(body); };
const validControl = (c) => /^\d{12}$/.test(c) && luhn(c.slice(0, 11)) === c[11];
// 881200000017 -> "8812 0000 0017" (easy to read out on the phone)
const spaced = (c) => c.replace(/(\d{4})(?=\d)/g, '$1 ');

const COLS = ['b.*', 's.short_name as school', 's.code', 's.name as school_name', 's.receipt_title', 's.receipt_contact',
  'u.full_name as created_by_name', 'p.full_name as paid_by_name', 'x.full_name as cancelled_by_name', 'r.number as receipt_number'];

function list(user, f = {}) {
  const school = allSchools(user) ? Number(f.school) || null : user.school_id;
  const q = db('bills as b').join('schools as s', 's.id', 'b.school_id').join('users as u', 'u.id', 'b.created_by')
    .leftJoin('users as p', 'p.id', 'b.paid_by').leftJoin('users as x', 'x.id', 'b.cancelled_by').leftJoin('receipts as r', 'r.id', 'b.receipt_id');
  if (school) q.where('b.school_id', school);
  if (f.status === 'pending') q.where('b.status', 'pending').where('b.expires_at', '>=', db.fn.now());
  else if (f.status === 'expired') q.where('b.status', 'pending').where('b.expires_at', '<', db.fn.now());
  else if (['paid', 'cancelled'].includes(f.status)) q.where('b.status', f.status);
  if (isDate(f.from)) q.whereRaw(`(b.created_at AT TIME ZONE '${TZ}')::date >= ?`, [f.from]);
  if (isDate(f.to)) q.whereRaw(`(b.created_at AT TIME ZONE '${TZ}')::date <= ?`, [f.to]);
  if (f.mine) q.where('b.created_by', user.id);
  const text = clean(f.q, 60);
  if (text) {
    const digits = text.replace(/\s/g, '');
    q.where((w) => {
      w.whereILike('b.student_name', `%${text}%`).orWhereILike('b.payer_name', `%${text}%`);
      if (/^\d{3,12}$/.test(digits)) w.orWhereLike('b.control_no', `%${digits}%`);
    });
  }
  return q;
}

function out(b, user) {
  const expired = b.status === 'pending' && new Date(b.expires_at) < new Date();
  const status = expired ? 'expired' : b.status;
  const own = allSchools(user) || b.school_id === user.school_id;
  const can = pageAccess(user.role, 'bills') === 'f' && own;
  return {
    id: b.id, controlNo: b.control_no, controlSpaced: spaced(b.control_no), schoolId: b.school_id, school: b.school, code: b.code,
    schoolName: b.school_name, receiptTitle: b.receipt_title || b.school_name?.toUpperCase(), receiptContact: b.receipt_contact || '',
    studentId: b.student_id, studentName: b.student_name, studentClass: b.student_class, gender: b.gender, payerName: b.payer_name, payerPhone: b.payer_phone,
    total: b.total, note: b.note, status, statusLabel: STATUS[status], expiresAt: b.expires_at, createdBy: b.created_by_name, createdAt: b.created_at,
    claimNetwork: b.claim_network, claimRef: b.claim_ref, claimAt: b.claim_at, paidRef: b.paid_ref, paidBy: b.paid_by_name, paidAt: b.paid_at, receiptId: b.receipt_id, receiptNumber: b.receipt_number,
    cancelledBy: b.cancelled_by_name, cancelledAt: b.cancelled_at, cancelReason: b.cancel_reason,
    canPay: can && ['acc', 'aacc'].includes(user.role) && b.status === 'pending' && !expired, canRenew: can && b.status === 'pending' && user.role === 'bursar',
    canCancel: can && b.status === 'pending',
  };
}

async function one(user, id) {
  const b = await list(user).where('b.id', Number(id) || 0).first(COLS);
  if (!b) throw new HttpError(404, 'Control number not found.');
  const lines = await db('bill_lines').where({ bill_id: b.id }).orderBy('id');
  return { ...out(b, user), lines: lines.map((l) => ({ id: l.id, itemId: l.item_id, name: l.item_name, unitPrice: l.unit_price, qty: l.qty, amount: l.amount })) };
}

router.get('/', requirePage('bills'), async (req, res) => {
  const f = { ...req.query, mine: req.user.role === 'bursar' && req.query.mine ? 1 : undefined };
  const rows = await list(req.user, f).orderBy('b.id', 'desc').limit(Math.min(Number(req.query.limit) || 200, 500)).select(COLS);
  const [c] = await list(req.user, { school: req.query.school }).select(db.raw(`
    (count(*) filter (where b.status='pending' and b.expires_at >= now()))::int as pending,
    coalesce(sum(b.total) filter (where b.status='pending' and b.expires_at >= now()),0)::bigint as pending_money,
    (count(*) filter (where b.status='pending' and b.expires_at < now()))::int as expired,
    (count(*) filter (where b.status='paid' and (b.paid_at AT TIME ZONE '${TZ}')::date = (now() AT TIME ZONE '${TZ}')::date))::int as paid_today,
    coalesce(sum(b.total) filter (where b.status='paid' and (b.paid_at AT TIME ZONE '${TZ}')::date = (now() AT TIME ZONE '${TZ}')::date),0)::bigint as paid_today_money`));
  res.json({
    bills: rows.map((b) => out(b, req.user)), validDays: DAYS,
    totals: { pending: c.pending, pendingMoney: Number(c.pending_money), expired: c.expired, paidToday: c.paid_today, paidTodayMoney: Number(c.paid_today_money) },
    canCreate: req.user.role === 'bursar' && pageAccess(req.user.role, 'bills') === 'f',
  });
});

router.get('/export.xlsx', requirePage('bills'), async (req, res) => {
  const rows = await list(req.user, req.query).orderBy('b.id').limit(20000).select(COLS);
  await sendExcel(res, 'musabe-control-numbers', [billsSheet(rows.map((b) => out(b, req.user)))]);
});

function billsSheet(bills) {
  const d = (v) => v && new Date(v);
  return {
    name: 'Control numbers', title: 'Musabe Schools: control numbers (TSh)',
    columns: [
      { header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'Control no.', key: 'controlNo', type: 'text', width: 15 },
      { header: 'Made on', key: 'createdAt', type: 'date', width: 18 }, { header: 'School', key: 'school', width: 16 },
      { header: 'Student', key: 'studentName', width: 26 }, { header: 'Class', key: 'studentClass', width: 10 },
      { header: 'Paid by', key: 'payerName', width: 22 }, { header: 'Phone', key: 'payerPhone', width: 12 },
      { header: 'Amount', key: 'total', type: 'money', width: 12 }, { header: 'Status', key: 'statusLabel', width: 20 },
      { header: 'Valid until', key: 'expiresAt', type: 'date', width: 18 }, { header: 'Paid on', key: 'paidAt', type: 'date', width: 18 },
      { header: 'Bank / mobile ref.', key: 'paidRef', width: 18 }, { header: 'Receipt no.', key: 'receiptNumber', width: 12 },
      { header: 'Made by', key: 'createdBy', width: 20 }, { header: 'Cancel reason', key: 'cancelReason', width: 24 },
    ],
    rows: bills.map((b, i) => ({ ...b, sn: i + 1, createdAt: d(b.createdAt), expiresAt: d(b.expiresAt), paidAt: d(b.paidAt) })),
  };
}

router.get('/:id', requirePage('bills'), async (req, res) => res.json({ bill: await one(req.user, req.params.id) }));

// The bursar makes a control number (same form as Sell).
router.post('/', requirePage('bills', 'f'), async (req, res) => {
  if (req.user.role !== 'bursar') throw new HttpError(403, 'The bursar makes control numbers.');
  const b = req.body || {};
  const school = await db('schools').where({ id: req.user.school_id }).first();
  if (!school?.active) throw new HttpError(400, 'Your school is switched off.');
  const key = /^[\w-]{8,40}$/.test(b.key || '') ? b.key : null;
  if (key) {
    const done = await db('bills').where({ client_key: key }).first('id', 'created_by');
    if (done && done.created_by === req.user.id) return res.json({ bill: await one(req.user, done.id), repeated: true });
  }
  const sale = await readSale(school, b);
  let id;
  try {
    id = await db.transaction(async (trx) => {
      const [s] = await trx('schools').where({ id: school.id }).increment('last_bill_no', 1).returning(['last_bill_no']);
      const control = controlNo(school.id, s.last_bill_no);
      const [{ id: bid }] = await trx('bills').insert({
        school_id: school.id, no: s.last_bill_no, control_no: control, student_id: sale.student?.id ?? null, student_name: sale.studentName,
        student_class: sale.studentClass, gender: sale.gender, payer_name: sale.payerName, payer_phone: sale.payerPhone, total: sale.total,
        note: sale.note, client_key: key, created_by: req.user.id, expires_at: trx.raw(`now() + make_interval(days => ?)`, [DAYS]),
      }).returning('id');
      await trx('bill_lines').insert(sale.lines.map((l) => ({ ...l, bill_id: bid })));
      await audit(req, 'bill.create', `Control number ${spaced(control)}: ${money(sale.total)} for ${sale.studentName} (${sale.studentClass}): `
        + sale.lines.map((l) => `${l.qty} × ${l.item_name}`).join(', '), { schoolId: school.id, detail: { billId: bid } }, trx);
      return bid;
    });
  } catch (e) {
    if (e.code === '23505' && key) {
      const done = await db('bills').where({ client_key: key }).first('id');
      if (done) return res.json({ bill: await one(req.user, done.id), repeated: true });
    }
    throw e;
  }
  res.status(201).json({ bill: await one(req.user, id) });
});

async function lockBill(trx, req) {
  const b = await trx('bills').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
  if (!b || (!allSchools(req.user) && b.school_id !== req.user.school_id)) throw new HttpError(404, 'Control number not found.');
  if (b.status === 'paid') throw new HttpError(409, `${spaced(b.control_no)} is already paid.`);
  if (b.status === 'cancelled') throw new HttpError(409, `${spaced(b.control_no)} was cancelled.`);
  return b;
}

// Paid: write the receipt now (gap-free number), with the prices on the control number.
router.post('/:id/paid', requirePage('bills', 'f'), async (req, res) => {
  if (!['acc', 'aacc'].includes(req.user.role)) throw new HttpError(403, 'Only the Accountant or Assistant Accountant confirms a control-number payment.');
  const paidRef = clean(req.body?.paidRef, 60).toUpperCase();
  if (paidRef.length < 4) throw new HttpError(400, 'Type the bank or mobile money transaction number of this payment.');
  if (req.body?.controlNo != null) {
    const typed = String(req.body.controlNo).replace(/\s/g, '');
    if (!validControl(typed)) throw new HttpError(400, 'This control number is not correct. Check the 12 digits again.');
  }
  const receiptId = await db.transaction(async (trx) => {
    const b = await lockBill(trx, req);
    if (req.body?.controlNo != null && String(req.body.controlNo).replace(/\s/g, '') !== b.control_no)
      throw new HttpError(400, 'The control number typed does not match this one.');
    if (new Date(b.expires_at) < new Date()) throw new HttpError(409, `${spaced(b.control_no)} has expired. The bursar must renew it first (check with the parent).`);
    const used = await trx('bills').where({ paid_ref: paidRef, school_id: b.school_id }).first('control_no');
    if (used) throw new HttpError(409, `Transaction ${paidRef} was already used for ${spaced(used.control_no)}.`);
    const lines = await trx('bill_lines').where({ bill_id: b.id }).orderBy('id');
    const sale = { studentId: b.student_id, studentName: b.student_name, studentClass: b.student_class, gender: b.gender,
      payerName: b.payer_name, payerPhone: b.payer_phone, note: b.note, total: b.total, lines };
    const r = await writeReceipt(trx, req, b.school_id, sale, { method: 'control', reference: `${b.control_no} / ${paidRef}`.slice(0, 60), billId: b.id });
    await trx('bills').where({ id: b.id }).update({ status: 'paid', paid_ref: paidRef, paid_by: req.user.id, paid_at: trx.fn.now(), receipt_id: r.id });
    await audit(req, 'bill.paid', `Control number ${spaced(b.control_no)} paid (${paidRef}): ${money(b.total)} for ${b.student_name}. Receipt ${r.number} written`,
      { schoolId: b.school_id, detail: { billId: b.id, receiptId: r.id } }, trx);
    return r.id;
  });
  res.json({ bill: await one(req.user, req.params.id), receipt: await receiptOne(req.user, receiptId) });
});

router.post('/:id/renew', requirePage('bills', 'f'), async (req, res) => {
  if (req.user.role !== 'bursar') throw new HttpError(403, 'The bursar renews control numbers.');
  await db.transaction(async (trx) => {
    const b = await lockBill(trx, req);
    await trx('bills').where({ id: b.id }).update({ expires_at: trx.raw(`now() + make_interval(days => ?)`, [DAYS]) });
    await audit(req, 'bill.renew', `Control number ${spaced(b.control_no)} renewed for ${DAYS} more days`, { schoolId: b.school_id, detail: { billId: b.id } }, trx);
  });
  res.json({ bill: await one(req.user, req.params.id) });
});

router.post('/:id/cancel', requirePage('bills', 'f'), async (req, res) => {
  const reason = clean(req.body?.reason, 200);
  if (reason.length < 3) throw new HttpError(400, 'Write why it is cancelled (e.g. "parent changed the items").');
  await db.transaction(async (trx) => {
    const b = await lockBill(trx, req);
    await trx('bills').where({ id: b.id }).update({ status: 'cancelled', cancelled_by: req.user.id, cancelled_at: trx.fn.now(), cancel_reason: reason });
    await audit(req, 'bill.cancel', `Control number ${spaced(b.control_no)} (${money(b.total)}, ${b.student_name}) cancelled before payment: ${reason}`,
      { schoolId: b.school_id, detail: { billId: b.id } }, trx);
  });
  res.json({ bill: await one(req.user, req.params.id) });
});

module.exports = router;
module.exports.list = list;
module.exports.out = out;
module.exports.COLS = COLS;
module.exports.billsSheet = billsSheet;
module.exports.validControl = validControl;
module.exports.controlNo = controlNo;
