// Purchases and orders: what is bought for ONE school. There is no main store (2026-11-16): goods land at
// the office and go to that school's library. Corrected 2026-11-17 (one store-keeper, not two):
// 1. The Assistant Manager or the store-keeper writes it: the school, supplier, invoice, each item with quantity and cost.
//    An ORDER (goods not here yet) waits as "ordered" until the goods arrive.
// 2. Mapokezi checks the goods against the receipts and writes, line by line, what really came (fewer than written
//    needs a note). Status "checked". Mapokezi does not buy, so there is no self-check to guard against.
// 3. The Accountant or the Assistant Accountant checks the invoice and Mapokezi's count and confirms. A delivery to
//    the school's library is made at once; the store-keeper applies the QR codes on the way, without checking the
//    goods again (Mapokezi already did); the librarian checks it and signs, and only then the stock goes up.
//    Either of the two last steps can reject (with a reason).
//    SPLIT 2026-11-21: confirming only closes the buying (money / count). Then the store-keeper sends the goods to the
//    school with the QR labels (POST /:id/send): two people, two steps.
// 2026-11-21 also: a supplier from the list and an LPO may be chosen; buying on credit (the supplier is paid later:
// supplier debts, routes/suppliers.js); Mapokezi marks goods that came WITHOUT a receipt, with the reason, and the
// Finance Manager, the Manager and the Director are told.
// The store-keeper never sees selling prices: only what things cost to buy.
// A purchase can answer a school requisition (RQN): it is then "being bought" until confirmed, then "bought".
// A confirmed or rejected purchase is never changed (database guard).
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { PURCHASE_CONFIRMERS } = require('../auth/roles');
const { sendExcel } = require('../lib/excel');
const stock = require('../lib/stock');
const seal = require('../lib/seal');
const docs = require('../lib/docs');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const money = (n) => `TSh ${Number(n).toLocaleString('en-GB')}`;
const STATUS = { ordered: 'Ordered: waiting for the goods', tosend: 'Confirmed: the store-keeper sends it to the school', pending: 'Waiting for Mapokezi to check', checked: 'Checked by Mapokezi: waiting for the Cashier (money back)', confirmed: 'Confirmed', rejected: 'Rejected' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

function list(f = {}) {
  const q = db('purchases as p').join('users as u', 'u.id', 'p.created_by').leftJoin('users as d', 'd.id', 'p.decided_by')
    .leftJoin('users as k', 'k.id', 'p.checked_by').leftJoin('requisitions as r', 'r.id', 'p.requisition_id').leftJoin('schools as rs', 'rs.id', 'r.school_id')
    .leftJoin('schools as ps', 'ps.id', 'p.school_id').leftJoin('deliveries as dl', 'dl.id', 'p.delivery_id').leftJoin('users as ww', 'ww.id', 'p.went_with')
    .leftJoin('lpos as lp', 'lp.id', 'p.lpo_id').leftJoin('users as sb', 'sb.id', 'p.sent_by');
  if (Number(f.school)) q.where('p.school_id', Number(f.school));
  if (f.status && STATUS[f.status]) q.where('p.status', f.status);
  if (f.q) { const w = `%${clean(f.q, 60)}%`; q.where((x) => x.whereILike('p.supplier', w).orWhereILike('p.number', w).orWhereILike('p.invoice_no', w)); }
  if (isDate(f.from)) q.where('p.bought_on', '>=', f.from);
  if (isDate(f.to)) q.where('p.bought_on', '<=', f.to);
  return q.select('p.*', db.raw('p.bought_on::text as bought'), 'u.full_name as by_name', 'd.full_name as decided_by_name', 'k.full_name as checked_by_name',
    'r.number as requisition_no', 'rs.short_name as requisition_school', db.raw('p.expected_on::text as expected'), 'ps.short_name as school', 'ps.name as school_name', 'ps.code as school_code',
    'dl.number as delivery_no', 'dl.status as delivery_status', 'ww.full_name as went_with_name', 'lp.number as lpo_no', 'sb.full_name as sent_by_name', db.raw('(select amount from payment_requests f where f.id = p.float_id) as float_amount'));
}
async function withLines(rows, user) {
  const lines = rows.length ? await db('purchase_lines').whereIn('purchase_id', rows.map((r) => r.id)).orderBy('id') : [];
  return rows.map((p) => ({
    school: p.school ? { id: p.school_id, name: p.school_name, short: p.school, code: p.school_code } : null, ordered: p.ordered, expectedOn: p.expected,
    waitingGoods: p.ordered && p.status === 'pending',
    delivery: p.delivery_id ? { id: p.delivery_id, number: p.delivery_no, status: p.delivery_status } : null,
    id: p.id, number: p.number, supplier: p.supplier, supplierId: p.supplier_id, invoiceNo: p.invoice_no, boughtOn: p.bought, note: p.note, total: Number(p.total), status: p.status,
    statusLabel: p.ordered && p.status === 'pending' ? STATUS.ordered : p.status === 'confirmed' && p.school_id && !p.delivery_id ? STATUS.tosend : STATUS[p.status],
    lpo: p.lpo_id ? { id: p.lpo_id, number: p.lpo_no } : null, onCredit: p.on_credit, noReceipt: p.no_receipt ? { reason: p.no_receipt_reason } : null,
    sentBy: p.sent_by_name, toSend: p.status === 'confirmed' && !!p.school_id && !p.delivery_id,
    canSend: p.status === 'confirmed' && !!p.school_id && !p.delivery_id && user.role === 'storekeeper',
    by: p.by_name, createdAt: p.created_at, decidedBy: p.decided_by_name, decidedAt: p.decided_at, decisionNote: p.decision_note,
    checkedBy: p.checked_by_name, checkedAt: p.checked_at, checkNote: p.check_note,
    requisition: p.requisition_id ? { id: p.requisition_id, number: p.requisition_no, school: p.requisition_school } : null,
    // Step 2: Mapokezi checks against the receipts. Step 3: the accountant office, after the check.
    floatAmount: p.float_amount == null ? null : Number(p.float_amount), balanceExpected: p.balance_expected == null ? null : Number(p.balance_expected), returnedAmount: p.returned_amount == null ? null : Number(p.returned_amount), settleNote: p.settle_note,
    wentWith: p.went_with ? { id: p.went_with, name: p.went_with_name, signedAt: p.went_with_signed_at } : null,
    canSignWentWith: p.status === 'pending' && p.went_with === user.id && !p.went_with_signed_at,
    canCheck: p.status === 'pending' && user.role === 'mapokezi' && (!p.went_with || !!p.went_with_signed_at),
    canSettle: p.status === 'checked' && !!p.float_id && user.role === 'cashier',
    canDecide: p.status === 'checked' && (p.float_id ? user.role === 'cashier' : PURCHASE_CONFIRMERS.includes(user.role)) && p.created_by !== user.id,
    canReject: ['pending', 'checked'].includes(p.status) && ((p.float_id ? user.role === 'cashier' : PURCHASE_CONFIRMERS.includes(user.role)) || (user.role === 'mapokezi' && p.status === 'pending')),
    canCancel: p.status === 'pending' && p.ordered && p.created_by === user.id,
    lines: lines.filter((l) => l.purchase_id === p.id).map((l) => ({ id: l.id, itemId: l.item_id, item: l.item_name, unit: l.unit, qty: l.qty, unitCost: l.unit_cost,
      amount: Number(l.amount), confirmed: l.confirmed_qty, note: l.note })),
  }));
}
// The people sent to buy (main or extra role), except me.
async function buyers(me) {
  const R = ['storekeeper', 'amanager'];
  const rows = await db('users').where('active', true).whereIn('role', R).select('id', 'full_name', 'role')
    .union((u) => u.from('user_roles as x').join('users as y', 'y.id', 'x.user_id').where({ 'x.active': true, 'y.active': true }).whereIn('x.role', R).select('y.id', 'y.full_name', 'x.role'));
  const seen = new Set();
  return rows.filter((u) => u.id !== me.id && !seen.has(u.id) && seen.add(u.id));
}

const one = async (id, user) => {
  const p = await list().where('p.id', Number(id) || 0).first();
  if (!p) throw new HttpError(404, 'Purchase not found.');
  const out = (await withLines([p], user))[0];
  const sigs = await seal.signaturesOf(db, 'purchase', [p.id]);
  const sg = (step) => { const x = sigs.filter((q) => q.step === step).pop(); return x ? { by: x.user_name, at: x.signed_at, image: x.image } : null; };
  return { ...out, signs: { bought: sg('bought'), wentWith: sg('wentwith'), checked: sg('checked'), settled: sg('settled'), confirmed: sg('confirmed') }, seal: await seal.seal(db, 'purchase', p.id, await docs.purchase(db, p.id)) };
};
const signPre = async (req, id, amount) => seal.checkSigning(req.user, { pin: req.body?.pin, smsCode: req.body?.smsCode, type: 'purchase', id: Number(id) || 0, amount });
const signStamp = async (trx, req, id, step) => seal.stamp(trx, req, 'purchase', id, step, await docs.purchase(trx, id));

router.get('/', requirePage('purchases'), async (req, res) => {
  const q = list(req.query);
  if (req.query.status === 'open') q.whereIn('p.status', ['pending', 'checked']);
  const rows = await q.orderByRaw("p.status in ('pending','checked') desc").orderBy('p.id', 'desc').limit(300);
  const [c] = await db('purchases').select(db.raw(`(count(*) filter (where status = 'pending'))::int as pending, (count(*) filter (where status = 'checked'))::int as checked,
    coalesce(sum(total) filter (where status = 'confirmed' and date_trunc('month', bought_on) = date_trunc('month', (now() AT TIME ZONE '${TZ}')::date)), 0)::bigint as month`));
  res.json({ purchases: await withLines(rows, req.user), pending: c.pending, checked: c.checked, confirmedThisMonth: Number(c.month),
    canWrite: ['storekeeper', 'amanager'].includes(req.user.role), canCheck: req.user.role === 'mapokezi', canDecide: PURCHASE_CONFIRMERS.includes(req.user.role) });
});

router.get('/export.xlsx', requirePage('purchases'), async (req, res) => {
  const rows = await withLines(await list(req.query).orderBy('p.id', 'desc').limit(20000), req.user);
  const flat = rows.flatMap((p) => p.lines.map((l) => ({ number: p.number, bought: p.boughtOn, supplier: p.supplier, invoice: p.invoiceNo || '', item: l.item, unit: l.unit, qty: l.qty,
    cost: l.unitCost, amount: l.amount, confirmed: l.confirmed, status: p.statusLabel, by: p.by, checked: p.checkedBy || '', decided: p.decidedBy || '',
    rqn: p.requisition?.number || '', note: l.note || p.decisionNote || '' })));
  await sendExcel(res, 'musabe-purchases', [{ name: 'Purchases', title: 'Musabe Schools: purchases for the main store',
    columns: [{ header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'No.', key: 'number', width: 11 }, { header: 'Bought on', key: 'bought', width: 12 }, { header: 'Supplier', key: 'supplier', width: 26 },
      { header: 'Invoice / receipt', key: 'invoice', width: 18 }, { header: 'Item', key: 'item', width: 28 }, { header: 'Unit', key: 'unit', width: 8 }, { header: 'Qty', key: 'qty', type: 'int', width: 8 },
      { header: 'Cost each', key: 'cost', type: 'money', width: 12 }, { header: 'Amount', key: 'amount', type: 'money', width: 13 }, { header: 'Qty counted', key: 'confirmed', type: 'int', width: 12 },
      { header: 'Status', key: 'status', width: 24 }, { header: 'Bought by', key: 'by', width: 22 }, { header: 'Counted by (store-keeper)', key: 'checked', width: 24 }, { header: 'Confirmed by (accountant)', key: 'decided', width: 24 },
      { header: 'Requisition', key: 'rqn', width: 12 }, { header: 'Note', key: 'note', width: 30 }],
    rows: flat.map((r, i) => ({ sn: i + 1, ...r })) }]);
});

router.get('/:id', requirePage('purchases'), async (req, res) => res.json({ purchase: await one(req.params.id, req.user) }));

router.post('/', requirePage('purchases', 'f'), async (req, res) => {
  if (!['storekeeper', 'amanager'].includes(req.user.role)) throw new HttpError(403, 'The Assistant Manager or the store-keeper writes purchases. Mapokezi and the accountant office check them.');
  const b = req.body || {};
  // A supplier from the list (2026-11-21), or a shop name typed (small shops bought from once).
  const sup = b.supplierId ? await db('suppliers').where({ id: Number(b.supplierId) || 0, active: true }).first() : null;
  if (b.supplierId && !sup) throw new HttpError(400, 'That supplier was not found. Reload the page.');
  const supplier = sup ? sup.name : clean(b.supplier, 120).toUpperCase();
  // From an authorised LPO: same supplier; the goods come on the LPO's terms.
  const lpo = b.lpoId ? await db('lpos').where({ id: Number(b.lpoId) || 0 }).first() : null;
  if (b.lpoId && !lpo) throw new HttpError(400, 'That LPO was not found.');
  if (lpo && lpo.status !== 'authorised') throw new HttpError(409, `${lpo.number} is not authorised (or the goods already came).`);
  if (lpo && sup && lpo.supplier_id !== sup.id) throw new HttpError(400, `${lpo.number} is for another supplier.`);
  // On credit: the supplier is paid later (weekly, monthly...). Never with money the Cashier gave for a requisition.
  const onCredit = b.onCredit === true || (!!lpo && lpo.terms !== 'cash');
  if (onCredit && !sup && !lpo) throw new HttpError(400, 'Buying on credit: choose the supplier from the list, so the debt is kept on his name.');
  const invoiceNo = clean(b.invoiceNo, 60).toUpperCase() || null;
  const boughtOn = isDate(b.boughtOn) ? b.boughtOn : today();
  // "Went with" (not required): the other buyer who went to the market too. He signs it as well.
  let wentWith = null;
  if (b.wentWith) {
    wentWith = (await buyers(req.user)).find((u) => u.id === Number(b.wentWith));
    if (!wentWith) throw new HttpError(400, '"Went with" must be the Assistant Manager or a store-keeper (not you).');
  }
  const ordered = b.ordered === true;
  const expectedOn = ordered && isDate(b.expectedOn) ? b.expectedOn : null;
  if (supplier.length < 3) throw new HttpError(400, 'Type the shop or supplier name (where you bought).');
  if (boughtOn > today()) throw new HttpError(400, 'The buying date cannot be in the future.');
  const want = new Map();
  for (const l of Array.isArray(b.lines) ? b.lines : []) {
    const id = Number(l?.itemId), qty = Number(l?.qty), cost = Number(String(l?.unitCost ?? '').replace(/[,\s]/g, ''));
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 1000000) throw new HttpError(400, 'Each item needs a whole quantity from 1 to 1,000,000.');
    if (!Number.isInteger(cost) || cost < 0 || cost > 100000000) throw new HttpError(400, 'Each item needs the cost of one unit in shillings (a whole number).');
    if (want.has(id)) throw new HttpError(400, 'The same item is written twice. Put it on one line.');
    want.set(id, { qty, cost });
  }
  if (!want.size) throw new HttpError(400, 'Add at least one item.');
  if (want.size > 200) throw new HttpError(400, 'Too many items on one purchase (more than 200).');
  const items = await db('items').whereIn('id', [...want.keys()]).where({ active: true });
  if (items.length !== want.size) throw new HttpError(400, 'One of the items is not in the list. Reload the page.');
  // The school it goes to (a requisition decides it). Things for sale must be sold in that school.
  let schoolId = Number(b.schoolId) || null;
  if (b.requisitionId) schoolId = (await db('requisitions').where({ id: Number(b.requisitionId) || 0 }).first('school_id'))?.school_id ?? schoolId;
  const school = schoolId ? await db('schools').where({ id: schoolId, active: true }).first() : null;
  if (!school) throw new HttpError(400, 'Choose the school these goods go to.');
  await require('./stock').readLines([...want].map(([itemId, x]) => ({ itemId, qty: x.qty })), school.id);
  const lines = items.map((i) => ({ item_id: i.id, item_name: i.name, unit: i.unit, qty: want.get(i.id).qty, unit_cost: want.get(i.id).cost, amount: want.get(i.id).qty * want.get(i.id).cost }));
  const total = lines.reduce((s, l) => s + l.amount, 0);
  await signPre(req, 0, total);
  const id = await db.transaction(async (trx) => {
    // Buying for a school requisition: it must be signed by the Manager.
    let rqn = null;
    if (b.requisitionId) {
      rqn = await trx('requisitions').where({ id: Number(b.requisitionId) || 0 }).forUpdate().first();
      if (!rqn) throw new HttpError(400, 'That requisition was not found.');
      if (!['approved', 'buying'].includes(rqn.status)) throw new HttpError(409, `${rqn.number} is not waiting to be bought (it is ${rqn.status}).`);
    }
    const { rows: [{ id: pid }] } = await trx.raw(`SELECT nextval(pg_get_serial_sequence('purchases', 'id'))::int AS id`);
    const number = stock.paperNo('PUR', pid);
    if (onCredit && rqn && (await trx('payment_requests').where({ requisition_id: rqn.id, kind: 'float', status: 'paid' }).first('id'))) throw new HttpError(400, 'The Cashier gave money for this requisition: it is bought with that money, not on credit.');
    await trx('purchases').insert({ id: pid, number, supplier, invoice_no: invoiceNo, supplier_id: sup?.id ?? lpo?.supplier_id ?? null, lpo_id: lpo?.id ?? null, on_credit: onCredit, bought_on: boughtOn, note: clean(b.note, 300) || null, total, created_by: req.user.id, went_with: wentWith?.id ?? null,
      requisition_id: rqn?.id ?? null, school_id: school.id, ordered, expected_on: expectedOn,
      float_id: rqn ? (await trx('payment_requests').where({ requisition_id: rqn.id, kind: 'float', status: 'paid' }).first('id'))?.id ?? null : null });
    await trx('purchase_lines').insert(lines.map((l) => ({ ...l, purchase_id: pid })));
    await signStamp(trx, req, pid, 'bought');
    if (wentWith) await audit(req, 'purchase.wentwith', `${number}: ${req.user.full_name} wrote that ${wentWith.full_name} went to the market with him. ${wentWith.full_name} must sign it before Mapokezi checks`, { detail: { purchaseId: pid, userId: wentWith.id } }, trx);
    if (rqn && rqn.status === 'approved') {
      await trx('requisitions').where({ id: rqn.id }).update({ status: 'buying' });
      await audit(req, 'requisition.buying', `${rqn.number}: being bought on ${number}`, { schoolId: rqn.school_id, detail: { requisitionId: rqn.id, userId: rqn.requested_by } }, trx);
    }
    await audit(req, 'purchase.create', `${number}: ${ordered ? 'ordered' : 'bought'} from ${supplier} for ${school.short_name}, ${money(total)}${onCredit ? ' ON CREDIT' : ''}${lpo ? ` (LPO ${lpo.number})` : ''}${rqn ? ` (for ${rqn.number})` : ''}: ${lines.map((l) => `${l.qty} ${l.unit} × ${l.item_name}`).join(', ')}. ${ordered ? `Expected ${expectedOn || 'soon'}; when it arrives Mapokezi checks it against the receipts` : 'Waiting for Mapokezi to check it against the receipts'}`,
      { detail: { purchaseId: pid } }, trx);
    return pid;
  });
  res.status(201).json({ purchase: await one(id, req.user) });
});

// Step 2: Mapokezi counts what really came against the receipts, line by line.
router.get('/buyers/list', requirePage('purchases'), async (req, res) => {
  res.json({ buyers: (await buyers(req.user)).map((u) => ({ id: u.id, name: u.full_name })) });
});

// The one who went to the market with the buyer signs that he was there (before Mapokezi checks).
router.post('/:id/went-with', requirePage('purchases'), async (req, res) => {
  await signPre(req, req.params.id, await docs.amountOf('purchase', Number(req.params.id) || 0));
  await db.transaction(async (trx) => {
    const p = await trx('purchases').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!p || p.went_with !== req.user.id) throw new HttpError(404, 'Purchase not found.');
    if (p.status !== 'pending' || p.went_with_signed_at) throw new HttpError(409, `${p.number} is already signed or checked.`);
    await trx('purchases').where({ id: p.id }).update({ went_with_signed_at: trx.fn.now() });
    await signStamp(trx, req, p.id, 'wentwith');
    await audit(req, 'purchase.wentwith_signed', `${p.number}: ${req.user.full_name} signed that he went to the market too. Waiting for Mapokezi to check the goods`, { detail: { purchaseId: p.id, userId: p.created_by } }, trx);
  });
  res.json({ purchase: await one(req.params.id, req.user) });
});

router.post('/:id/check', requirePage('purchases', 'f'), async (req, res) => {
  if (req.user.role !== 'mapokezi') throw new HttpError(403, 'Mapokezi checks the goods against the receipts.');
  const b = req.body || {};
  const note = clean(b.note, 300) || null;
  // Goods that came WITHOUT a receipt (2026-11-21): Mapokezi writes why. The Finance Manager, the Manager and the Director are told.
  const noReceipt = b.noReceipt === true;
  const noReceiptReason = clean(b.noReceiptReason, 300);
  if (noReceipt && noReceiptReason.length < 5) throw new HttpError(400, 'Goods without a receipt: write the reason (why there is no receipt).');
  await signPre(req, req.params.id, await docs.amountOf('purchase', Number(req.params.id) || 0));
  const seen = new Map((Array.isArray(b.lines) ? b.lines : []).map((l) => [Number(l?.lineId), { qty: Number(l?.countedQty ?? l?.confirmedQty), note: clean(l?.note, 200) || null }]));
  await db.transaction(async (trx) => {
    const p = await trx('purchases').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!p) throw new HttpError(404, 'Purchase not found.');
    if (p.status !== 'pending') throw new HttpError(409, `${p.number} is already ${STATUS[p.status].toLowerCase()}.`);
    if (p.went_with && !p.went_with_signed_at) throw new HttpError(409, `${p.number}: the one who went with the buyer has not signed yet.`);
    const shorts = [];
    for (const l of await trx('purchase_lines').where({ purchase_id: p.id }).orderBy('id')) {
      const s = seen.get(l.id);
      const got = s && Number.isInteger(s.qty) ? s.qty : l.qty;
      if (got < 0 || got > l.qty) throw new HttpError(400, `${l.item_name}: type how many really came (0 to ${l.qty}).`);
      if (got < l.qty && !s?.note) throw new HttpError(400, `${l.item_name}: ${l.qty - got} fewer than written. Write a note.`);
      await trx('purchase_lines').where({ id: l.id }).update({ confirmed_qty: got, note: s?.note || null });
      if (got < l.qty) shorts.push(`${l.item_name}: ${l.qty - got} ${l.unit} fewer (${s.note})`);
    }
    await trx('purchases').where({ id: p.id }).update({ status: 'checked', checked_by: req.user.id, checked_at: trx.fn.now(), check_note: note,
      no_receipt: noReceipt, no_receipt_reason: noReceipt ? noReceiptReason : null });
    await signStamp(trx, req, p.id, 'checked');
    if (noReceipt) {
      const buyer = await trx('users').where({ id: p.created_by }).first('full_name');
      await audit(req, 'purchase.no_receipt', `${p.number}: goods from ${p.supplier} (${money(p.total)}) came WITHOUT a receipt. Bought by ${buyer?.full_name || '—'}. Reason: ${noReceiptReason}`,
        { schoolId: p.school_id, detail: { purchaseId: p.id } }, trx);
    }
    // Office money spent exactly: nothing to give back to the Cashier, so it closes now and the goods go to the school.
    let closed = false;
    if (p.float_id) {
      const given = Number((await trx('payment_requests').where({ id: p.float_id }).first('amount'))?.amount || 0);
      const worth = (await trx('purchase_lines').where({ purchase_id: p.id })).reduce((x, l) => x + Number(l.unit_cost) * (l.confirmed_qty ?? l.qty), 0);
      if (given === worth) {
        await finish(trx, req, { ...p, status: 'checked', checked_by: req.user.id }, { approve: true, note: 'Nothing to give back: closed when Mapokezi accepted the goods', returned: 0, auto: true });
        closed = true;
      }
    }
    if (closed) return;
    await audit(req, 'purchase.check', `${p.number} (${p.supplier}) ${p.ordered ? 'arrived and ' : ''}checked by Mapokezi against the receipts${shorts.length ? `. Less than written: ${shorts.join('; ')}` : ': everything as written'}. ${p.float_id ? 'Waiting for the Cashier: the buyer gives back the money left' : 'Waiting for the accountant office'}`,
      { detail: { purchaseId: p.id, userId: p.created_by } }, trx);
  });
  res.json({ purchase: await one(req.params.id, req.user) });
});

// Step 3: the accountant office confirms the count (goods go into the main store), or anyone of the checkers rejects.
router.post('/:id/decide', requirePage('purchases', 'f'), async (req, res) => {
  const b = req.body || {};
  const approve = b.approve === true;
  const note = clean(b.note, 300) || null;
  if (!approve && !note) throw new HttpError(400, 'Write why it is rejected, so the store-keeper knows.');
  const confirmer = PURCHASE_CONFIRMERS.includes(req.user.role) || req.user.role === 'cashier';
  if (approve && !confirmer) throw new HttpError(403, 'Only the Cashier (money back) or the Assistant Accountant confirms purchases.');
  const writer = ['storekeeper', 'amanager'].includes(req.user.role);   // may cancel his own order (checked below)
  if (!approve && !confirmer && req.user.role !== 'mapokezi' && !writer) throw new HttpError(403, 'Your account is not allowed to do this.');
  const returned = b.returnedAmount === undefined || b.returnedAmount === '' ? null : Number(String(b.returnedAmount).replace(/[,\s]/g, ''));
  if (approve) await signPre(req, req.params.id, await docs.amountOf('purchase', Number(req.params.id) || 0));
  await db.transaction(async (trx) => {
    const p = await trx('purchases').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!p) throw new HttpError(404, 'Purchase not found.');
    if (approve && p.float_id && req.user.role !== 'cashier') throw new HttpError(403, 'This buying used money from the office: the Cashier confirms it, when the buyer gives back what is left.');
    if (approve && !p.float_id && req.user.role === 'cashier') throw new HttpError(403, 'The Cashier only confirms buying that used money from the office.');
    if (!['pending', 'checked'].includes(p.status)) throw new HttpError(409, `${p.number} was already ${p.status}.`);
    // The one who wrote an ORDER may cancel it while the goods have not come (the shop cannot supply, ...).
    const cancelOwnOrder = !approve && p.created_by === req.user.id && p.ordered && p.status === 'pending';
    if (p.created_by === req.user.id && !cancelOwnOrder) throw new HttpError(403, 'Nobody confirms or rejects their own purchase.');
    if (writer && !confirmer && !cancelOwnOrder) throw new HttpError(403, 'Only the one who wrote an order cancels it, before the goods come.');
    if (!confirmer && p.status !== 'pending') throw new HttpError(409, `${p.number} is already checked. Only the accountant office decides now.`);
    if (approve && p.status !== 'checked') throw new HttpError(409, `${p.number} must first be checked by Mapokezi.`);
    if (approve && p.checked_by === req.user.id) throw new HttpError(403, 'The one who counted cannot also confirm.');
    await finish(trx, req, p, { approve, note, returned });
  });
  res.json({ purchase: await one(req.params.id, req.user) });
});


// Confirm (goods go to the school, money settled) or reject a purchase. Used by the Cashier / Assistant Accountant,
// by Mapokezi's reject, and by itself when Mapokezi accepts goods bought with office money and nothing is left to give back.
async function finish(trx, req, p, { approve, note, returned, auto = false }) {
  const lines = await trx('purchase_lines').where({ purchase_id: p.id }).orderBy('id');
  let delivery = null;
  const rqn = p.requisition_id ? await trx('requisitions').where({ id: p.requisition_id }).forUpdate().first() : null;
  if (approve && p.school_id) {
    // 2026-11-21: confirming does not send. The requisition is "bought: to send"; the store-keeper sends it (POST /:id/send).
    if (rqn && rqn.status === 'buying') {
      await trx('requisitions').where({ id: rqn.id }).update({ status: 'arrived' });
      await audit(req, 'requisition.arrived', `${rqn.number}: bought on ${p.number}. The store-keeper sends it to the school`, { schoolId: rqn.school_id, detail: { requisitionId: rqn.id, userId: rqn.requested_by } }, trx);
    }
    if (p.lpo_id) await trx('lpos').where({ id: p.lpo_id, status: 'authorised' }).update({ status: 'delivered' });
  } else if (approve) { // old purchases written before 2026-11-16 (no school): into the old main store
    for (const l of lines) {
      if (l.confirmed_qty > 0) await stock.move(trx, { schoolId: null, itemId: l.item_id, itemName: l.item_name, change: l.confirmed_qty, kind: 'buy', ref: p.number, refId: p.id, note: p.supplier, by: req.user.id });
    }
  }
  let settle = {};
  if (approve && p.float_id) {
    const given = Number((await trx('payment_requests').where({ id: p.float_id }).first('amount'))?.amount || 0);
    const worth = lines.reduce((s, l) => s + Number(l.unit_cost) * (l.confirmed_qty ?? l.qty), 0);
    const expected = given - worth;
    if (!Number.isInteger(returned) || returned < 0) throw new HttpError(400, 'Write how much money the buyer gave back (0 if nothing).');
    if (returned !== Math.max(expected, 0) && !note) throw new HttpError(400, `The money back should be TSh ${Math.max(expected, 0).toLocaleString('en-GB')}${expected < 0 ? ' (he spent more than he was given: the office settles the difference)' : ''}. Write a note why it is different.`);
    settle = { balance_expected: expected, returned_amount: returned, settle_note: note };
  }
  await trx('purchases').where({ id: p.id }).update({ status: approve ? 'confirmed' : 'rejected', decided_by: auto ? null : req.user.id, decided_at: trx.fn.now(), decision_note: note,
    delivery_id: delivery?.id ?? null, ...settle });
  if (approve && !auto) await signStamp(trx, req, p.id, p.float_id ? 'settled' : 'confirmed');
  const shorts = lines.filter((l) => l.confirmed_qty != null && l.confirmed_qty < l.qty).map((l) => `${l.item_name}: ${l.qty - l.confirmed_qty} ${l.unit} fewer`);
  await audit(req, approve ? 'purchase.confirm' : 'purchase.reject',
    `${p.number} (${p.supplier}, ${money(p.total)}) ${approve ? (p.school_id ? 'confirmed: the store-keeper sends it to the school' : 'confirmed') : 'rejected'}${approve && shorts.length ? `. Less than written: ${shorts.join('; ')}` : ''}${note ? ` (${note})` : ''}`,
    { detail: { purchaseId: p.id, userId: p.created_by } }, trx);
  // The requisition it answers: sent with the delivery (above), or back to "approved" when nothing else is being bought.
  if (rqn && rqn.status === 'buying' && !approve) {
    const open = await trx('purchases').where({ requisition_id: rqn.id }).whereIn('status', ['pending', 'checked']).whereNot({ id: p.id }).first();
    if (!open) await trx('requisitions').where({ id: rqn.id }).update({ status: 'approved' });
  }
}

// Step 4 (2026-11-21): the store-keeper sends the confirmed goods to the school, with the QR labels. The librarian checks and signs.
router.post('/:id/send', requirePage('purchases', 'f'), async (req, res) => {
  if (req.user.role !== 'storekeeper') throw new HttpError(403, 'The store-keeper sends the goods to the school.');
  await db.transaction(async (trx) => {
    const p = await trx('purchases').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!p) throw new HttpError(404, 'Purchase not found.');
    if (p.status !== 'confirmed' || !p.school_id) throw new HttpError(409, `${p.number} is not confirmed yet.`);
    if (p.delivery_id) throw new HttpError(409, `${p.number} was already sent.`);
    const lines = await trx('purchase_lines').where({ purchase_id: p.id }).orderBy('id');
    const send = lines.filter((l) => (l.confirmed_qty ?? l.qty) > 0).map((l) => ({ item_id: l.item_id, item_name: l.item_name, qty: l.confirmed_qty ?? l.qty }));
    if (!send.length) throw new HttpError(409, `${p.number}: nothing came, nothing to send.`);
    const school = await trx('schools').where({ id: p.school_id }).first();
    const rqn = p.requisition_id ? await trx('requisitions').where({ id: p.requisition_id }).forUpdate().first() : null;
    const d = await require('./stock').makeDelivery(trx, req, { school, lines: send, note: `From ${p.number} (${p.supplier})`, sentBy: req.user.id,
      rqn: rqn && ['arrived', 'buying'].includes(rqn.status) ? rqn : null, purchase: p });
    await trx('purchases').where({ id: p.id }).update({ delivery_id: d.id, sent_by: req.user.id });
  });
  res.json({ purchase: await one(req.params.id, req.user) });
});

// Summary of Daily Goods Received (book No. 1701), as on the paper: Date; S/N, Supplier's name, Buyer's name, Item, Qty,
// Unit cost, Total cost, Terms of payment (cash / credit), Destination; TOTAL; Prepared by, Checked by, Approved by.
// Goods count as received when Mapokezi has checked them (rejected buying is left out). Any dates.
router.get('/summary/received', requirePage('purchases'), async (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : today();
  const to = isDate(req.query.to) ? req.query.to : from;
  if (to < from) throw new HttpError(400, 'The end date is before the start date.');
  const rows = await db('purchase_lines as l').join('purchases as p', 'p.id', 'l.purchase_id').join('users as u', 'u.id', 'p.created_by')
    .leftJoin('schools as s', 's.id', 'p.school_id').leftJoin('users as k', 'k.id', 'p.checked_by')
    .whereIn('p.status', ['checked', 'confirmed']).whereNotNull('p.checked_at')
    .whereRaw(`(p.checked_at AT TIME ZONE '${TZ}')::date BETWEEN ? AND ?`, [from, to])
    .orderBy('p.checked_at').orderBy('l.id')
    .select('p.id as pid', 'p.number', 'p.supplier', 'p.on_credit', 'p.no_receipt', 'p.float_id', 'u.full_name as buyer', 'k.full_name as checker', 's.short_name as school',
      db.raw(`(p.checked_at AT TIME ZONE '${TZ}')::date::text as day`), 'l.item_name', 'l.unit', 'l.qty', 'l.confirmed_qty', 'l.unit_cost');
  const lines = rows.map((r) => {
    const qty = r.confirmed_qty ?? r.qty;
    return { day: r.day, purchaseId: r.pid, number: r.number, supplier: r.supplier, buyer: r.buyer, item: r.item_name, unit: r.unit, qty, unitCost: Number(r.unit_cost),
      total: qty * Number(r.unit_cost), terms: r.on_credit ? 'Credit' : 'Cash', destination: r.school || 'Office', noReceipt: r.no_receipt, checkedBy: r.checker };
  });
  const sum = (f) => lines.filter(f).reduce((s, l) => s + l.total, 0);
  const out = { from, to, lines, total: sum(() => true), cash: sum((l) => l.terms === 'Cash'), credit: sum((l) => l.terms === 'Credit'), noReceipt: lines.filter((l) => l.noReceipt).length };
  if (req.query.format === 'xlsx') {
    return sendExcel(res, `musabe-goods-received-${from}${to !== from ? `-to-${to}` : ''}`, [{ name: 'Goods received', title: `Musabe Schools: Summary of Daily Goods Received ${from}${to !== from ? ` to ${to}` : ''}`,
      columns: [{ header: 'Date', key: 'day', width: 12 }, { header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: "Supplier's name", key: 'supplier', width: 26 }, { header: "Buyer's name", key: 'buyer', width: 22 },
        { header: 'Item', key: 'item', width: 28 }, { header: 'Qty', key: 'qty', type: 'int', width: 8 }, { header: 'Unit', key: 'unit', width: 8 }, { header: 'Unit cost', key: 'unitCost', type: 'money', width: 12 },
        { header: 'Total cost', key: 'total', type: 'money', width: 13 }, { header: 'Terms of payment', key: 'terms', width: 12 }, { header: 'Destination', key: 'destination', width: 16 },
        { header: 'Buying form', key: 'number', width: 11 }, { header: 'No receipt', key: 'nr', width: 10 }],
      rows: [...lines.map((l, i) => ({ ...l, sn: i + 1, nr: l.noReceipt ? 'YES' : '' })), { item: 'TOTAL', total: out.total }] }]);
  }
  res.json(out);
});

module.exports = router;
