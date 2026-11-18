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
//    STILL TO DO (needs the Money-going-out module first): the store-keeper's "send with QR" and the Accountant's
//    money confirm are one click here; once Cashier float-closing exists, split them so the store-keeper sends and
//    the Accountant's confirm only closes the float, as the plan describes.
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
const STATUS = { ordered: 'Ordered: waiting for the goods', pending: 'Waiting for Mapokezi to check', checked: 'Checked by Mapokezi: waiting for the Cashier (money back)', confirmed: 'Confirmed', rejected: 'Rejected' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

function list(f = {}) {
  const q = db('purchases as p').join('users as u', 'u.id', 'p.created_by').leftJoin('users as d', 'd.id', 'p.decided_by')
    .leftJoin('users as k', 'k.id', 'p.checked_by').leftJoin('requisitions as r', 'r.id', 'p.requisition_id').leftJoin('schools as rs', 'rs.id', 'r.school_id')
    .leftJoin('schools as ps', 'ps.id', 'p.school_id').leftJoin('deliveries as dl', 'dl.id', 'p.delivery_id');
  if (Number(f.school)) q.where('p.school_id', Number(f.school));
  if (f.status && STATUS[f.status]) q.where('p.status', f.status);
  if (f.q) { const w = `%${clean(f.q, 60)}%`; q.where((x) => x.whereILike('p.supplier', w).orWhereILike('p.number', w).orWhereILike('p.invoice_no', w)); }
  if (isDate(f.from)) q.where('p.bought_on', '>=', f.from);
  if (isDate(f.to)) q.where('p.bought_on', '<=', f.to);
  return q.select('p.*', db.raw('p.bought_on::text as bought'), 'u.full_name as by_name', 'd.full_name as decided_by_name', 'k.full_name as checked_by_name',
    'r.number as requisition_no', 'rs.short_name as requisition_school', db.raw('p.expected_on::text as expected'), 'ps.short_name as school', 'ps.name as school_name', 'ps.code as school_code',
    'dl.number as delivery_no', 'dl.status as delivery_status', db.raw('(select amount from payment_requests f where f.id = p.float_id) as float_amount'));
}
async function withLines(rows, user) {
  const lines = rows.length ? await db('purchase_lines').whereIn('purchase_id', rows.map((r) => r.id)).orderBy('id') : [];
  return rows.map((p) => ({
    school: p.school ? { id: p.school_id, name: p.school_name, short: p.school, code: p.school_code } : null, ordered: p.ordered, expectedOn: p.expected,
    waitingGoods: p.ordered && p.status === 'pending',
    delivery: p.delivery_id ? { id: p.delivery_id, number: p.delivery_no, status: p.delivery_status } : null,
    id: p.id, number: p.number, supplier: p.supplier, invoiceNo: p.invoice_no, boughtOn: p.bought, note: p.note, total: Number(p.total), status: p.status, statusLabel: p.ordered && p.status === 'pending' ? STATUS.ordered : STATUS[p.status],
    by: p.by_name, createdAt: p.created_at, decidedBy: p.decided_by_name, decidedAt: p.decided_at, decisionNote: p.decision_note,
    checkedBy: p.checked_by_name, checkedAt: p.checked_at, checkNote: p.check_note,
    requisition: p.requisition_id ? { id: p.requisition_id, number: p.requisition_no, school: p.requisition_school } : null,
    // Step 2: Mapokezi checks against the receipts. Step 3: the accountant office, after the check.
    floatAmount: p.float_amount == null ? null : Number(p.float_amount), balanceExpected: p.balance_expected == null ? null : Number(p.balance_expected), returnedAmount: p.returned_amount == null ? null : Number(p.returned_amount), settleNote: p.settle_note,
    canCheck: p.status === 'pending' && user.role === 'mapokezi',
    canSettle: p.status === 'checked' && !!p.float_id && user.role === 'cashier',
    canDecide: p.status === 'checked' && (p.float_id ? user.role === 'cashier' : PURCHASE_CONFIRMERS.includes(user.role)) && p.created_by !== user.id,
    canReject: ['pending', 'checked'].includes(p.status) && ((p.float_id ? user.role === 'cashier' : PURCHASE_CONFIRMERS.includes(user.role)) || (user.role === 'mapokezi' && p.status === 'pending')),
    canCancel: p.status === 'pending' && p.ordered && p.created_by === user.id,
    lines: lines.filter((l) => l.purchase_id === p.id).map((l) => ({ id: l.id, itemId: l.item_id, item: l.item_name, unit: l.unit, qty: l.qty, unitCost: l.unit_cost,
      amount: Number(l.amount), confirmed: l.confirmed_qty, note: l.note })),
  }));
}
const one = async (id, user) => {
  const p = await list().where('p.id', Number(id) || 0).first();
  if (!p) throw new HttpError(404, 'Purchase not found.');
  const out = (await withLines([p], user))[0];
  const sigs = await seal.signaturesOf(db, 'purchase', [p.id]);
  const sg = (step) => { const x = sigs.filter((q) => q.step === step).pop(); return x ? { by: x.user_name, at: x.signed_at, image: x.image } : null; };
  return { ...out, signs: { bought: sg('bought'), checked: sg('checked'), settled: sg('settled'), confirmed: sg('confirmed') }, seal: await seal.seal(db, 'purchase', p.id, await docs.purchase(db, p.id)) };
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
    canWrite: ['storekeeper', 'manager'].includes(req.user.role), canCheck: req.user.role === 'mapokezi', canDecide: PURCHASE_CONFIRMERS.includes(req.user.role) });
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
  if (!['storekeeper', 'manager'].includes(req.user.role)) throw new HttpError(403, 'The Assistant Manager or the store-keeper writes purchases. Mapokezi and the accountant office check them.');
  const b = req.body || {};
  const supplier = clean(b.supplier, 120).toUpperCase() || (b.requisitionId ? 'MANUNUZI YA KILA SIKU' : '');
  const invoiceNo = clean(b.invoiceNo, 60).toUpperCase() || null;
  const boughtOn = isDate(b.boughtOn) ? b.boughtOn : today();
  const ordered = b.ordered === true;
  const expectedOn = ordered && isDate(b.expectedOn) ? b.expectedOn : null;
  if (supplier.length < 3) throw new HttpError(400, 'Type the shop or supplier name.');
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
    await trx('purchases').insert({ id: pid, number, supplier, invoice_no: invoiceNo, bought_on: boughtOn, note: clean(b.note, 300) || null, total, created_by: req.user.id,
      requisition_id: rqn?.id ?? null, school_id: school.id, ordered, expected_on: expectedOn,
      float_id: rqn ? (await trx('payment_requests').where({ requisition_id: rqn.id, kind: 'float', status: 'paid' }).first('id'))?.id ?? null : null });
    await trx('purchase_lines').insert(lines.map((l) => ({ ...l, purchase_id: pid })));
    await signStamp(trx, req, pid, 'bought');
    if (rqn && rqn.status === 'approved') {
      await trx('requisitions').where({ id: rqn.id }).update({ status: 'buying' });
      await audit(req, 'requisition.buying', `${rqn.number}: being bought on ${number}`, { schoolId: rqn.school_id, detail: { requisitionId: rqn.id, userId: rqn.requested_by } }, trx);
    }
    await audit(req, 'purchase.create', `${number}: ${ordered ? 'ordered' : 'bought'} from ${supplier} for ${school.short_name}, ${money(total)}${rqn ? ` (for ${rqn.number})` : ''}: ${lines.map((l) => `${l.qty} ${l.unit} × ${l.item_name}`).join(', ')}. ${ordered ? `Expected ${expectedOn || 'soon'}; when it arrives Mapokezi checks it against the receipts` : 'Waiting for Mapokezi to check it against the receipts'}`,
      { detail: { purchaseId: pid } }, trx);
    return pid;
  });
  res.status(201).json({ purchase: await one(id, req.user) });
});

// Step 2: Mapokezi counts what really came against the receipts, line by line.
router.post('/:id/check', requirePage('purchases', 'f'), async (req, res) => {
  if (req.user.role !== 'mapokezi') throw new HttpError(403, 'Mapokezi checks the goods against the receipts.');
  const b = req.body || {};
  const note = clean(b.note, 300) || null;
  await signPre(req, req.params.id, await docs.amountOf('purchase', Number(req.params.id) || 0));
  const seen = new Map((Array.isArray(b.lines) ? b.lines : []).map((l) => [Number(l?.lineId), { qty: Number(l?.countedQty ?? l?.confirmedQty), note: clean(l?.note, 200) || null }]));
  await db.transaction(async (trx) => {
    const p = await trx('purchases').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!p) throw new HttpError(404, 'Purchase not found.');
    if (p.status !== 'pending') throw new HttpError(409, `${p.number} is already ${STATUS[p.status].toLowerCase()}.`);
    const shorts = [];
    for (const l of await trx('purchase_lines').where({ purchase_id: p.id }).orderBy('id')) {
      const s = seen.get(l.id);
      const got = s && Number.isInteger(s.qty) ? s.qty : l.qty;
      if (got < 0 || got > l.qty) throw new HttpError(400, `${l.item_name}: type how many really came (0 to ${l.qty}).`);
      if (got < l.qty && !s?.note) throw new HttpError(400, `${l.item_name}: ${l.qty - got} fewer than written. Write a note.`);
      await trx('purchase_lines').where({ id: l.id }).update({ confirmed_qty: got, note: s?.note || null });
      if (got < l.qty) shorts.push(`${l.item_name}: ${l.qty - got} ${l.unit} fewer (${s.note})`);
    }
    await trx('purchases').where({ id: p.id }).update({ status: 'checked', checked_by: req.user.id, checked_at: trx.fn.now(), check_note: note });
    await signStamp(trx, req, p.id, 'checked');
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
  if (!approve && !confirmer && req.user.role !== 'mapokezi') throw new HttpError(403, 'Your account is not allowed to do this.');
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
    if (!confirmer && p.status !== 'pending') throw new HttpError(409, `${p.number} is already checked. Only the accountant office decides now.`);
    if (approve && p.status !== 'checked') throw new HttpError(409, `${p.number} must first be checked by Mapokezi.`);
    if (approve && p.checked_by === req.user.id) throw new HttpError(403, 'The one who counted cannot also confirm.');
    const lines = await trx('purchase_lines').where({ purchase_id: p.id }).orderBy('id');
    let delivery = null;
    const rqn = p.requisition_id ? await trx('requisitions').where({ id: p.requisition_id }).forUpdate().first() : null;
    if (approve && p.school_id) {
      // Goes to the school's library now; the librarian checks and signs.
      const school = await trx('schools').where({ id: p.school_id }).first();
      const send = lines.filter((l) => l.confirmed_qty > 0).map((l) => ({ item_id: l.item_id, item_name: l.item_name, qty: l.confirmed_qty }));
      if (send.length) delivery = await require('./stock').makeDelivery(trx, req, { school, lines: send, note: `From ${p.number} (${p.supplier})`, sentBy: p.created_by,
        rqn: rqn && rqn.status === 'buying' ? rqn : null, purchase: p });
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
    await trx('purchases').where({ id: p.id }).update({ status: approve ? 'confirmed' : 'rejected', decided_by: req.user.id, decided_at: trx.fn.now(), decision_note: note,
      delivery_id: delivery?.id ?? null, ...settle });
    if (approve) await signStamp(trx, req, p.id, p.float_id ? 'settled' : 'confirmed');
    const shorts = lines.filter((l) => l.confirmed_qty != null && l.confirmed_qty < l.qty).map((l) => `${l.item_name}: ${l.qty - l.confirmed_qty} ${l.unit} fewer`);
    await audit(req, approve ? 'purchase.confirm' : 'purchase.reject',
      `${p.number} (${p.supplier}, ${money(p.total)}) ${approve ? (delivery ? `confirmed: sent to the school on ${delivery.number}` : 'confirmed') : 'rejected'}${approve && shorts.length ? `. Less than written: ${shorts.join('; ')}` : ''}${note ? ` (${note})` : ''}`,
      { detail: { purchaseId: p.id, userId: p.created_by } }, trx);
    // The requisition it answers: sent with the delivery (above), or back to "approved" when nothing else is being bought.
    if (rqn && rqn.status === 'buying' && !delivery) {
      const open = await trx('purchases').where({ requisition_id: rqn.id }).whereIn('status', ['pending', 'checked']).whereNot({ id: p.id }).first();
      if (!open) await trx('requisitions').where({ id: rqn.id }).update({ status: 'approved' });
    }
  });
  res.json({ purchase: await one(req.params.id, req.user) });
});

module.exports = router;
