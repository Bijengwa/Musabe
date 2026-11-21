// Order Book (2026-11-20) = the paper "ORDER" each place keeps (one book per place, e.g. "Boys Kitchen"):
//   M/s (to whom), Date, "Please supply following goods", Qty (with unit) / Particulars, Name, Signature.
// Who orders and where it goes:
//   (teachers do not write orders since 2026-11-20: they ask the Academic Master by word, who gives it if he has it)
//   Academic Master                  -> store-keeper (no Head Master signature)
//   School Store-keeper, Patron      -> Head Master approves -> store-keeper / Assistant Manager go to buy
//   librarian                        -> Head Master approves -> Manager approves -> store-keeper
//   Head Master                      -> Manager approves -> store-keeper
// The store-keeper (or the Assistant Manager) then writes a payment requisition from it (routes/requisitions.js, orderId),
// or rejects it with a reason. Approvers may give fewer than asked. Nothing is deleted; an order only moves forward.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES, REQUISITION_MAKERS } = require('../auth/roles');
const { sendExcel } = require('../lib/excel');
const stock = require('../lib/stock');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const allSchools = (u) => ROLES[u.role]?.scope === 'all';

const PLACES = { library: 'Library', store: 'School store', academic: 'Academic office', kitchen: 'Kitchen', dormitory: 'Dormitory', office: 'Office', other: 'Other' };
const STATUS = {
  acad: 'Waiting for the Academic Master', head: 'Waiting for the Head Master', manager: 'Waiting for the Manager', keeper: 'With the store-keeper',
  given: 'Given by the Academic Master', requisition: 'Requisition written', rejected: 'Rejected', withdrawn: 'Withdrawn',
};
const OPEN = ['acad', 'head', 'manager', 'keeper'];
// Once the requisition is written, the order shows how far the buying has gone.
const RQN_LABEL = { manager: 'Requisition waiting for the Manager / Finance Manager', approved: 'Approved: money and buying', buying: 'Being bought', arrived: 'Bought: on the way to the school',
  sent: 'Sent to the school', done: 'Received at the school', rejected: 'The requisition was rejected', closed: 'Not bought: the money was given back' };
// 2026-11-20: teachers do NOT write orders: a teacher just asks the Academic Master (e.g. for chalk), who gives it if he has it.
const WRITERS = ['acad', 'librarian', 'sstore', 'patron', 'head'];
// Where a new order starts, by the writer's role.
const FIRST = { teacher: 'acad', acad: 'keeper', librarian: 'head', sstore: 'head', patron: 'head', head: 'manager' };
// After the Head Master: the library goes on to the Manager; the School Store-keeper and the Patron go straight to the buyers
// (the Manager / Finance Manager approve the money on the requisition).
const AFTER_HEAD = { librarian: 'manager' };
// The place a writer orders for, unless he says another one.
const PLACE_OF = { teacher: 'academic', acad: 'academic', librarian: 'library', sstore: 'store', patron: 'dormitory', head: 'office' };
// Who it is addressed to on the paper ("M/s").
const TO = { acad: 'Academic Master', keeper: 'Store-keeper', head: 'Store-keeper', manager: 'Store-keeper' };

// Whose turn it is.
function turn(user, o) {
  const here = user.school_id === o.school_id;
  const mine = o.written_by === user.id;
  if (o.status === 'acad') return user.role === 'acad' && here ? 'acad' : mine ? 'withdraw' : null;
  if (o.status === 'head') return user.role === 'head' && here ? 'head' : mine ? 'withdraw' : null;
  if (o.status === 'manager') return user.role === 'manager' ? 'manager' : null;
  if (o.status === 'keeper') return REQUISITION_MAKERS.includes(user.role) ? 'keeper' : null;
  return null;
}

function list(user, f = {}) {
  const q = db('orders as o').join('schools as s', 's.id', 'o.school_id').join('users as w', 'w.id', 'o.written_by')
    .leftJoin('users as a', 'a.id', 'o.acad_by').leftJoin('users as h', 'h.id', 'o.head_by').leftJoin('users as m', 'm.id', 'o.manager_by')
    .leftJoin('users as k', 'k.id', 'o.keeper_by').leftJoin('users as x', 'x.id', 'o.rejected_by').leftJoin('requisitions as r', 'r.id', 'o.requisition_id');
  if (!allSchools(user)) q.where('o.school_id', user.school_id);
  // A teacher, librarian or School Store-keeper sees what they ordered; the Academic Master also the teachers' orders.
  if (['teacher', 'librarian', 'sstore', 'patron'].includes(user.role)) q.where('o.written_by', user.id);
  if (user.role === 'acad') q.where((w) => w.where('o.written_by', user.id).orWhere('o.written_role', 'teacher'));
  // Administration sees an order once the school has signed it.
  if (allSchools(user)) q.whereIn('o.status', ['manager', 'keeper', 'requisition', 'rejected']).where((w) => w.whereNot('o.status', 'rejected').orWhereIn('o.rejected_step', ['manager', 'keeper']));
  if (Number(f.school)) q.where('o.school_id', Number(f.school));
  if (f.status === 'open') q.whereIn('o.status', OPEN);
  else if (STATUS[f.status]) q.where('o.status', f.status);
  if (f.q) { const w = `%${clean(f.q, 60)}%`; q.where((x) => x.whereILike('o.number', w).orWhereExists(db('order_lines as l').whereRaw('l.order_id = o.id').whereILike('l.particulars', w).select(db.raw('1')))); }
  return q.orderBy('o.id', 'desc').select('o.*', db.raw('o.needed_by::text as needed'), 's.short_name as school', 's.name as school_name', 's.code',
    'w.full_name as writer', 'a.full_name as acad_name', 'h.full_name as head_name', 'm.full_name as manager_name', 'k.full_name as keeper_name',
    'x.full_name as rejected_name', 'r.number as rqn_no', 'r.status as rqn_status');
}

async function withLines(user, rows) {
  const ids = rows.map((o) => o.id);
  const lines = ids.length ? await db('order_lines').whereIn('order_id', ids).orderBy('id') : [];
  const sg = (by, at, note) => (by ? { by, at, note: note || null } : null);
  return rows.map((o) => ({
    id: o.id, number: o.number, schoolId: o.school_id, school: o.school, schoolName: o.school_name, code: o.code,
    place: o.place, placeLabel: o.place_name || PLACES[o.place], to: TO[o.status] || (o.acad_by && o.written_role === 'teacher' && !o.keeper_by ? 'Academic Master' : 'Store-keeper'),
    status: o.status, statusLabel: o.status === 'requisition' && RQN_LABEL[o.rqn_status] ? RQN_LABEL[o.rqn_status] : STATUS[o.status], writer: o.writer, writerRole: ROLES[o.written_role]?.label, writtenAt: o.created_at, note: o.note, neededBy: o.needed,
    signs: { acad: sg(o.acad_name, o.acad_at, o.acad_note), head: sg(o.head_name, o.head_at), manager: sg(o.manager_name, o.manager_at, o.manager_note), keeper: sg(o.keeper_name, o.keeper_at) },
    rejected: o.rejected_by ? { by: o.rejected_name, at: o.rejected_at, reason: o.reject_reason } : null,
    requisition: o.requisition_id ? { id: o.requisition_id, number: o.rqn_no, status: o.rqn_status } : null,
    lines: lines.filter((l) => l.order_id === o.id).map((l) => ({ id: l.id, qty: l.qty, unit: l.unit, particulars: l.particulars, approvedQty: l.approved_qty })),
    turn: turn(user, o),
  }));
}

async function one(user, id) {
  const rows = await list(user).where('o.id', Number(id) || 0);
  if (!rows.length) throw new HttpError(404, 'Order not found.');
  return (await withLines(user, rows))[0];
}

router.get('/', requirePage('orders'), async (req, res) => {
  const orders = await withLines(req.user, await list(req.user, req.query).limit(500));
  res.json({ orders, places: PLACES, statuses: STATUS, canWrite: WRITERS.includes(req.user.role), mine: orders.filter((o) => o.turn && o.turn !== 'withdraw').length });
});

router.get('/export.xlsx', requirePage('orders'), async (req, res) => {
  const orders = await withLines(req.user, await list(req.user, req.query).limit(5000));
  const rows = orders.flatMap((o) => o.lines.map((l) => ({ number: o.number, date: new Date(o.writtenAt).toLocaleDateString('en-GB', { timeZone: TZ }), school: o.school, place: o.placeLabel,
    writer: o.writer, qty: l.approvedQty ?? l.qty, unit: l.unit || '', particulars: l.particulars, status: o.statusLabel, requisition: o.requisition?.number || '' })));
  await sendExcel(res, 'order-book', [{ name: 'Orders', columns: [
    { header: 'No.', key: 'number', width: 12 }, { header: 'Date', key: 'date', width: 12 }, { header: 'School', key: 'school', width: 10 }, { header: 'Place', key: 'place', width: 16 },
    { header: 'Ordered by', key: 'writer', width: 22 }, { header: 'Qty', key: 'qty', width: 8 }, { header: 'Unit', key: 'unit', width: 8 }, { header: 'Particulars', key: 'particulars', width: 36 },
    { header: 'Status', key: 'status', width: 26 }, { header: 'Requisition', key: 'requisition', width: 12 }], rows }]);
});

router.get('/:id', requirePage('orders'), async (req, res) => res.json({ order: await one(req.user, req.params.id) }));

// Write an order (as on the paper: Qty, unit, particulars). It starts at the first signer for the writer's role.
router.post('/', requirePage('orders', 'f'), async (req, res) => {
  if (!WRITERS.includes(req.user.role)) throw new HttpError(403, 'Only the staff of a school write in the Order Book.');
  const b = req.body || {};
  const place = PLACES[b.place] ? b.place : PLACE_OF[req.user.role];
  const placeName = clean(b.placeName, 80) || null;
  const note = clean(b.note, 300) || null;
  const neededBy = isDate(b.neededBy) ? b.neededBy : null;
  if (neededBy && neededBy < today()) throw new HttpError(400, 'The "needed by" date is already past.');
  const raw = (Array.isArray(b.lines) ? b.lines : []).filter((l) => clean(l?.particulars, 200) || l?.qty);
  if (!raw.length) throw new HttpError(400, 'Write at least one thing to supply.');
  if (raw.length > 40) throw new HttpError(400, 'At most 40 lines on one order.');
  const lines = raw.map((l) => {
    const particulars = clean(l?.particulars, 200);
    if (particulars.length < 2) throw new HttpError(400, 'Each line needs the particulars (what you want).');
    const q = l?.qty === '' || l?.qty == null ? null : Number(l.qty);
    if (q !== null && (!Number.isInteger(q) || q < 1 || q > 1000000)) throw new HttpError(400, `${particulars}: the quantity must be a whole number from 1, or left empty.`);
    return { particulars, qty: q, unit: clean(l?.unit, 20) || null };
  });
  const status = FIRST[req.user.role];
  const id = await db.transaction(async (trx) => {
    const { rows: [{ id: oid }] } = await trx.raw(`SELECT nextval(pg_get_serial_sequence('orders', 'id'))::int AS id`);
    const number = stock.paperNo('ORD', oid);
    await trx('orders').insert({ id: oid, number, school_id: req.user.school_id, place, place_name: placeName, status, written_by: req.user.id, written_role: req.user.role, note, needed_by: neededBy,
      ...(req.user.role === 'head' ? { head_by: req.user.id, head_at: trx.fn.now() } : {}), ...(req.user.role === 'acad' ? { acad_by: req.user.id, acad_at: trx.fn.now() } : {}) });
    await trx('order_lines').insert(lines.map((l) => ({ order_id: oid, ...l })));
    await audit(req, `order.create_${status}`, `${number}: ${req.user.full_name} (${PLACES[place]}) orders ${lines.map((l) => `${l.qty ?? ''}${l.unit ? ` ${l.unit}` : ''} ${l.particulars}`.trim()).join(', ')}. ${STATUS[status]}`,
      { schoolId: req.user.school_id, detail: { orderId: oid, step: status } }, trx);
    return oid;
  });
  res.status(201).json({ order: await one(req.user, id) });
});

async function forStep(trx, user, id, step) {
  const o = await trx('orders').where({ id: Number(id) || 0 }).forUpdate().first();
  if (!o || (!allSchools(user) && o.school_id !== user.school_id)) throw new HttpError(404, 'Order not found.');
  if (turn(user, o) !== step) {
    if (o.status !== step) throw new HttpError(409, `${o.number}: ${STATUS[o.status].toLowerCase()}.`);
    throw new HttpError(403, 'It is not your turn for this order.');
  }
  return o;
}
// A signer may give fewer: { lines: [{ lineId, qty }] }.
async function fewer(trx, o, given) {
  const cut = [];
  for (const g of Array.isArray(given) ? given : []) {
    const l = await trx('order_lines').where({ id: Number(g?.lineId) || 0, order_id: o.id }).first();
    if (!l || l.qty == null) continue;
    const q = Number(g.qty);
    if (!Number.isInteger(q) || q < 0 || q > (l.approved_qty ?? l.qty)) throw new HttpError(400, `${l.particulars}: give 0 to ${l.approved_qty ?? l.qty}.`);
    if (q !== (l.approved_qty ?? l.qty)) { await trx('order_lines').where({ id: l.id }).update({ approved_qty: q }); cut.push(`${l.particulars} ${q} of ${l.qty}`); }
  }
  return cut;
}
function decision(b) {
  const approve = b?.approve === true;
  const note = clean(b?.note, 300) || null;
  if (!approve && !note) throw new HttpError(400, 'Write why it is rejected, so the person who ordered knows.');
  return { approve, note };
}
async function reject(trx, req, o, note) {
  await trx('orders').where({ id: o.id }).update({ status: 'rejected', rejected_step: o.status, rejected_by: req.user.id, rejected_at: trx.fn.now(), reject_reason: note });
  await audit(req, 'order.reject', `${o.number} rejected by the ${ROLES[req.user.role].label} (${req.user.full_name}): ${note}`, { schoolId: o.school_id, detail: { orderId: o.id, userId: o.written_by } }, trx);
}

// Academic Master: give it from what he keeps (chalk...), send it on to the store-keeper, or reject.
router.post('/:id/acad', requirePage('orders', 'f'), async (req, res) => {
  const b = req.body || {};
  const action = b.action;   // 'give' | 'forward' | 'reject'
  if (!['give', 'forward', 'reject'].includes(action)) throw new HttpError(400, 'Choose: give it, send it on to the store-keeper, or reject.');
  const note = clean(b.note, 300) || null;
  if (action === 'reject' && !note) throw new HttpError(400, 'Write why it is rejected, so the teacher knows.');
  await db.transaction(async (trx) => {
    const o = await forStep(trx, req.user, req.params.id, 'acad');
    if (action === 'reject') return reject(trx, req, o, note);
    const cut = await fewer(trx, o, b.lines);
    const status = action === 'give' ? 'given' : 'keeper';
    await trx('orders').where({ id: o.id }).update({ status, acad_by: req.user.id, acad_at: trx.fn.now(), acad_note: note });
    await audit(req, action === 'give' ? 'order.given' : 'order.acad', `${o.number}: ${action === 'give' ? 'given to the teacher' : 'sent on to the store-keeper'} by the Academic Master (${req.user.full_name})${cut.length ? `, fewer: ${cut.join(', ')}` : ''}${note ? ` (${note})` : ''}`,
      { schoolId: o.school_id, detail: { orderId: o.id, userId: o.written_by, step: status } }, trx);
  });
  res.json({ order: await one(req.user, req.params.id) });
});

// Head Master approves (it goes to the Manager) or rejects.
router.post('/:id/head', requirePage('orders', 'f'), async (req, res) => {
  const { approve, note } = decision(req.body);
  await db.transaction(async (trx) => {
    const o = await forStep(trx, req.user, req.params.id, 'head');
    if (!approve) return reject(trx, req, o, note);
    const cut = await fewer(trx, o, req.body?.lines);
    const next = AFTER_HEAD[o.written_role] || 'keeper';
    await trx('orders').where({ id: o.id }).update({ status: next, head_by: req.user.id, head_at: trx.fn.now() });
    await audit(req, next === 'manager' ? 'order.head' : 'order.head_keeper', `${o.number} approved by the Head Master (${req.user.full_name})${cut.length ? `, fewer: ${cut.join(', ')}` : ''}. ${next === 'manager' ? 'Waiting for the Manager' : 'With the store-keeper / Assistant Manager to buy'}`,
      { schoolId: o.school_id, detail: { orderId: o.id, userId: o.written_by, step: next } }, trx);
  });
  res.json({ order: await one(req.user, req.params.id) });
});

// Manager approves (it goes to the store-keeper) or rejects.
router.post('/:id/manager', requirePage('orders', 'f'), async (req, res) => {
  const { approve, note } = decision(req.body);
  await db.transaction(async (trx) => {
    const o = await forStep(trx, req.user, req.params.id, 'manager');
    if (!approve) return reject(trx, req, o, note);
    const cut = await fewer(trx, o, req.body?.lines);
    await trx('orders').where({ id: o.id }).update({ status: 'keeper', manager_by: req.user.id, manager_at: trx.fn.now(), manager_note: note });
    await audit(req, 'order.manager', `${o.number} approved by the Manager (${req.user.full_name})${cut.length ? `, fewer: ${cut.join(', ')}` : ''}. With the store-keeper`,
      { schoolId: o.school_id, detail: { orderId: o.id, userId: o.written_by, step: 'keeper' } }, trx);
  });
  res.json({ order: await one(req.user, req.params.id) });
});

// Store-keeper / Assistant Manager: reject it (the requisition is written on the requisition page, with ?order=ID).
router.post('/:id/keeper', requirePage('orders'), async (req, res) => {
  const note = clean(req.body?.note, 300);
  if (!note) throw new HttpError(400, 'Write why it cannot be supplied, so the school knows.');
  await db.transaction(async (trx) => {
    const o = await forStep(trx, req.user, req.params.id, 'keeper');
    await reject(trx, req, o, note);
  });
  res.json({ order: await one(req.user, req.params.id) });
});

// The writer may withdraw it before the school signer has signed.
router.post('/:id/withdraw', requirePage('orders', 'f'), async (req, res) => {
  await db.transaction(async (trx) => {
    const o = await trx('orders').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!o || o.written_by !== req.user.id) throw new HttpError(404, 'Order not found.');
    if (!['acad', 'head'].includes(o.status)) throw new HttpError(409, `${o.number}: ${STATUS[o.status].toLowerCase()}. It can be withdrawn only before it is signed.`);
    await trx('orders').where({ id: o.id }).update({ status: 'withdrawn' });
    await audit(req, 'order.withdraw', `${o.number} withdrawn by ${req.user.full_name}`, { schoolId: o.school_id, detail: { orderId: o.id } }, trx);
  });
  res.json({ order: await one(req.user, req.params.id) });
});

module.exports = router;
module.exports.STATUS = STATUS;
