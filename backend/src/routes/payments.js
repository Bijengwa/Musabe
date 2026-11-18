// Money going out: the Requested Cash Payout Voucher (paper copy, 2026-11-18).
//   Internal payment:  Assistant Accountant PREPARES it -> Financial Officer (fm) AUTHORIZES or rejects -> Cashier PAYS, the payee signs.
//   Money to buy (a "float", kind = 'float'): made by the system when the Manager signs a requisition (routes/requisitions.js); the Manager's
//   signature is the authorization. The Cashier gives exactly that amount; the payee (the buyer) signs. Mapokezi then checks the goods.
// Every signature is made with the signer's PIN and sealed (lib/seal.js). A paid or rejected voucher is never changed.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const stock = require('../lib/stock');
const seal = require('../lib/seal');
const docs = require('../lib/docs');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const money = (n) => `TSh ${Number(n).toLocaleString('en-GB')}`;
const STATUS = { review: 'Waiting for the Financial Officer', pending: 'Authorized: waiting for the Cashier to pay', paid: 'Paid', rejected: 'Rejected' };
const WRITERS = ['aacc'];       // prepares a voucher (internal payments desk)
const DECIDERS = ['fm'];        // the Financial Officer authorizes every internal payment
const PAYERS = ['cashier'];     // pays it out
const intAmount = (v, what) => {
  const n = Number(String(v ?? '').replace(/[,\s]/g, ''));
  if (!Number.isInteger(n) || n <= 0 || n > 1000000000) throw new HttpError(400, `${what}: a whole number of shillings above 0.`);
  return n;
};

function list(f = {}) {
  const q = db('payment_requests as p').join('users as u', 'u.id', 'p.requested_by').leftJoin('users as c', 'c.id', 'p.paid_by').leftJoin('users as a', 'a.id', 'p.authorized_by')
    .leftJoin('requisitions as r', 'r.id', 'p.requisition_id').leftJoin('schools as s', 's.id', 'r.school_id');
  if (f.status && STATUS[f.status]) q.where('p.status', f.status);
  if (f.kind === 'float' || f.kind === 'general') q.where('p.kind', f.kind);
  if (f.q) { const w = `%${clean(f.q, 60)}%`; q.where((x) => x.whereILike('p.purpose', w).orWhereILike('p.number', w).orWhereILike('p.payee_name', w).orWhereILike('p.contract_ref', w)); }
  return q.select('p.*', 'u.full_name as requested_by_name', 'c.full_name as paid_by_name', 'a.full_name as authorized_by_name', 'r.number as requisition_no', 'r.status as requisition_status', 's.short_name as school');
}
const out = (p, user, lines, sigs, sealed) => {
  const sg = (step) => { const x = (sigs || []).filter((s) => s.step === step).pop(); return x ? { by: x.user_name, at: x.signed_at, image: x.image, acting: x.acting } : null; };
  return {
    id: p.id, number: p.number, kind: p.kind, purpose: p.purpose, amount: Number(p.amount), estAmount: p.est_amount == null ? null : Number(p.est_amount),
    payeeName: p.payee_name || (sigs || []).filter((s) => s.step === 'payee').map((s) => s.user_name).pop() || null, chequeNo: p.cheque_no, contractRef: p.contract_ref, approvedByName: p.approved_by_name || p.authorized_by_name,
    requisition: p.requisition_id ? { id: p.requisition_id, number: p.requisition_no, school: p.school, status: p.requisition_status } : null,
    requestedBy: p.requested_by_name, requestedAt: p.requested_at, status: p.status, statusLabel: STATUS[p.status],
    authorizedBy: p.authorized_by_name, authorizedAt: p.authorized_at, authorizeNote: p.authorize_note, paidBy: p.paid_by_name, paidAt: p.paid_at, payNote: p.pay_note,
    canAuthorize: p.status === 'review' && DECIDERS.includes(user.role), canDecide: p.status === 'pending' && PAYERS.includes(user.role),
    ...(lines ? { lines: lines.map((l) => ({ sn: l.sn, detail: l.detail, amount: Number(l.amount) })) } : {}),
    ...(sigs ? { signs: { prepared: sg('prepared'), authorized: sg('authorized'), paid: sg('paid'), payee: sg('payee') } } : {}),
    ...(sealed ? { seal: sealed } : {}),
  };
};
async function full(user, id) {
  const p = await list().where('p.id', Number(id) || 0).first();
  if (!p) throw new HttpError(404, 'Voucher not found.');
  const [lines, sigs, sealed] = await Promise.all([db('payment_lines').where({ payment_id: p.id }).orderBy('sn'), seal.signaturesOf(db, 'voucher', [p.id]), docs.voucher(db, p.id).then((c) => seal.seal(db, 'voucher', p.id, c))]);
  return out(p, user, lines, sigs, sealed);
}
const signPre = async (req, id) => seal.checkSigning(req.user, { pin: req.body?.pin, smsCode: req.body?.smsCode, type: 'voucher', id: Number(id) || 0, amount: id ? await docs.amountOf('voucher', Number(id)) : 0 });
const signStamp = async (trx, req, id, step, o) => seal.stamp(trx, req, 'voucher', id, step, await docs.voucher(trx, id), o);

router.get('/', requirePage('payments'), async (req, res) => {
  const rows = await list(req.query).orderByRaw("case p.status when 'review' then 0 when 'pending' then 1 else 2 end").orderBy('p.id', 'desc').limit(300);
  const [c] = await db('payment_requests').select(db.raw(`(count(*) filter (where status = 'pending'))::int as pending, (count(*) filter (where status = 'review'))::int as review,
    coalesce(sum(amount) filter (where status = 'paid' and date_trunc('month', paid_at AT TIME ZONE '${TZ}') = date_trunc('month', (now() AT TIME ZONE '${TZ}'))), 0)::bigint as month`));
  res.json({ payments: rows.map((p) => out(p, req.user)), pending: c.pending, review: c.review, paidThisMonth: Number(c.month),
    canWrite: WRITERS.includes(req.user.role), canPay: PAYERS.includes(req.user.role), canAuthorize: DECIDERS.includes(req.user.role) });
});

router.get('/:id', requirePage('payments'), async (req, res) => {
  res.json({ payment: await full(req.user, req.params.id) });
});

// 1. The Assistant Accountant prepares the voucher.
router.post('/', requirePage('payments', 'f'), async (req, res) => {
  if (!WRITERS.includes(req.user.role)) throw new HttpError(403, 'The Assistant Accountant prepares payment vouchers.');
  const b = req.body || {};
  const payee = clean(b.payeeName, 120);
  const purpose = clean(b.purpose, 120);
  const chequeNo = clean(b.chequeNo, 40) || null;
  const contractRef = clean(b.contractRef, 80) || null;
  if (payee.length < 3) throw new HttpError(400, 'Write the name of the payee.');
  if (purpose.length < 3) throw new HttpError(400, 'Write what the payment is for (it goes on the TOTAL line).');
  const lines = (Array.isArray(b.lines) ? b.lines : []).filter((l) => clean(l?.detail, 200) || l?.amount).map((l, i) => ({ sn: i + 1, detail: clean(l?.detail, 200), amount: intAmount(l?.amount, `Line ${i + 1}: amount`) }));
  if (!lines.length) throw new HttpError(400, 'Write at least one line: the detail and its amount.');
  if (lines.some((l) => l.detail.length < 2)) throw new HttpError(400, 'Each line needs its detail written.');
  if (lines.length > 14) throw new HttpError(400, 'At most 14 lines on one voucher.');
  const amount = lines.reduce((s, l) => s + l.amount, 0);
  await signPre(req, 0);
  const id = await db.transaction(async (trx) => {
    const { rows: [{ id: pid }] } = await trx.raw(`SELECT nextval(pg_get_serial_sequence('payment_requests', 'id'))::int AS id`);
    const number = stock.paperNo('PRQ', pid);
    await trx('payment_requests').insert({ id: pid, number, kind: 'general', status: 'review', purpose, amount, payee_name: payee, cheque_no: chequeNo, contract_ref: contractRef, requested_by: req.user.id });
    await trx('payment_lines').insert(lines.map((l) => ({ payment_id: pid, ...l })));
    await signStamp(trx, req, pid, 'prepared');
    await audit(req, 'payment.create', `${number}: ${money(amount)} to ${payee} for ${purpose}${contractRef ? ` (${contractRef})` : ''}. Prepared by ${req.user.full_name}. Waiting for the Financial Officer`, { detail: { paymentId: pid } }, trx);
    return pid;
  });
  res.status(201).json({ payment: await full(req.user, id) });
});

// 2. The Financial Officer authorizes (or rejects) an internal payment.
router.post('/:id/authorize', requirePage('payments', 'f'), async (req, res) => {
  if (!DECIDERS.includes(req.user.role)) throw new HttpError(403, 'Only the Financial Officer authorizes a payment.');
  const approve = req.body?.approve === true;
  const note = clean(req.body?.note, 300) || null;
  if (!approve && !note) throw new HttpError(400, 'Write why it is rejected.');
  if (approve) await signPre(req, req.params.id);
  await db.transaction(async (trx) => {
    const p = await trx('payment_requests').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!p) throw new HttpError(404, 'Voucher not found.');
    if (p.status !== 'review') throw new HttpError(409, `${p.number} is ${STATUS[p.status].toLowerCase()}.`);
    if (p.requested_by === req.user.id) throw new HttpError(403, 'You cannot authorize a voucher you prepared yourself.');
    if (!approve) {
      await trx('payment_requests').where({ id: p.id }).update({ status: 'rejected', authorized_by: req.user.id, authorized_at: trx.fn.now(), authorize_note: note });
      await audit(req, 'payment.reject', `${p.number} rejected by the Financial Officer (${req.user.full_name}): ${note}`, { detail: { paymentId: p.id, userId: p.requested_by } }, trx);
      return;
    }
    await trx('payment_requests').where({ id: p.id }).update({ status: 'pending', authorized_by: req.user.id, authorized_at: trx.fn.now(), authorize_note: note });
    await signStamp(trx, req, p.id, 'authorized');
    await audit(req, 'payment.authorized', `${p.number}: ${money(p.amount)} to ${p.payee_name} authorized by the Financial Officer (${req.user.full_name})${note ? `: ${note}` : ''}. Waiting for the Cashier`, { detail: { paymentId: p.id, userId: p.requested_by } }, trx);
  });
  res.json({ payment: await full(req.user, req.params.id) });
});

const pngOrNull = (v) => { const s = String(v || ''); return /^data:image\/png;base64,[A-Za-z0-9+/=]{800,150000}$/.test(s) ? s : null; };
// 3. The Cashier pays; the payee signs on the screen. Or the Cashier cannot pay and says why.
router.post('/:id/decide', requirePage('payments', 'f'), async (req, res) => {
  if (!PAYERS.includes(req.user.role)) throw new HttpError(403, 'Only the Cashier pays or rejects a payment.');
  const b = req.body || {};
  const approve = b.approve === true;
  const note = clean(b.note, 300) || null;
  if (!approve && !note) throw new HttpError(400, 'Write why it cannot be paid.');
  const payeeImage = pngOrNull(b.payeeImage);
  const payeeName = clean(b.payeeName, 120) || (await db('payment_requests').where({ id: Number(req.params.id) || 0 }).first('payee_name'))?.payee_name || '';
  if (approve) {
    if (payeeName.length < 3) throw new HttpError(400, 'Write the name of the person who receives the money.');
    if (!payeeImage) throw new HttpError(400, 'The payee must sign in the box before the money is given.');
    await signPre(req, req.params.id);
  }
  await db.transaction(async (trx) => {
    const p = await trx('payment_requests').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!p) throw new HttpError(404, 'Voucher not found.');
    if (p.status !== 'pending') throw new HttpError(409, `${p.number} is ${STATUS[p.status].toLowerCase()}.`);
    const amount = Number(p.amount);
    if (approve && p.kind === 'float' && !(amount > 0)) throw new HttpError(409, 'No amount was settled for this one. Reject it with a reason: the Manager must settle the cost first.');
    await trx('payment_requests').where({ id: p.id }).update({ status: approve ? 'paid' : 'rejected', paid_by: req.user.id, paid_at: trx.fn.now(), pay_note: note });
    if (approve) {
      await signStamp(trx, req, p.id, 'paid');
      await signStamp(trx, req, p.id, 'payee', { user: { id: null, full_name: payeeName, role: null }, image: payeeImage, name: payeeName, role: null });
    }
    if (p.kind === 'float') {
      const rq = await trx('requisitions').where({ id: p.requisition_id }).first('number', 'school_id', 'requested_by');
      await audit(req, approve ? 'payment.floatpaid' : 'payment.reject',
        approve ? `${rq.number}: the Cashier gave ${money(amount)} to ${payeeName} to buy it. Goods will come to be checked by Mapokezi` : `${p.number} (money for ${rq.number}) rejected by the Cashier: ${note}`,
        { schoolId: rq.school_id, detail: { paymentId: p.id, requisitionId: p.requisition_id, userId: p.requested_by } }, trx);
      return;
    }
    await audit(req, approve ? 'payment.pay' : 'payment.reject', `${p.number} (${money(p.amount)} to ${approve ? payeeName : p.payee_name}) ${approve ? 'paid by the Cashier' : 'rejected by the Cashier'}${note ? `: ${note}` : ''}`,
      { detail: { paymentId: p.id, userId: p.requested_by } }, trx);
  });
  res.json({ payment: await full(req.user, req.params.id) });
});

module.exports = router;
