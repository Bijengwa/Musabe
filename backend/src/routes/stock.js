// Stock: levels, history, and deliveries from the finance office to the libraries.
//
// - Stock levels and history (GET /api/stock, /api/stock/moves): only the finance office, the accountant office
//   and the top leaders (page "stock"). Finance Manager and Accountant set reorder levels.
// - Send stock (POST /api/stock/deliveries): Finance Manager, Assistant FM, Accountant (page "stockin").
// - Incoming stock (POST /api/stock/deliveries/:id/lines/:line/confirm): the librarian of that school confirms
//   each line, with what really arrived. Stock goes up only then.
// Every change goes through lib/stock.js move(): the level and its history never disagree.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES, pageAccess } = require('../auth/roles');
const { sendExcel, readExcel } = require('../lib/excel');
const stock = require('../lib/stock');

const { uploadLimit } = require('../lib/guard');
const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const KIND = { in: 'Received', give: 'Given to parent', damage: 'Damaged / lost', buy: 'Bought', send: 'Sent to a library', issue: 'Issued', return: 'Returned', count: 'Weekly check correction' };
const DSTATUS = { sent: 'On the way', received: 'Received', cancelled: 'Cancelled' };

// Either page: finance sees deliveries on "Send stock", the librarian on "Incoming stock".
const deliveryPage = (req, _res, next) => {
  if (!pageAccess(req.user.role, 'stockin') && !pageAccess(req.user.role, 'incoming') && !pageAccess(req.user.role, 'stock'))
    throw new HttpError(403, 'Your account is not allowed to do this.');
  next();
};
const schoolOf = (user, wanted) => (allSchools(user) ? (Number(wanted) || null) : user.school_id);

// ---------- Stock levels ----------
// One row per school and item that is sold there or has stock.
async function levels(user, f = {}) {
  const school = schoolOf(user, f.school);
  const q = db('schools as s').where('s.active', true)
    .crossJoin('items as i')
    .leftJoin('item_prices as p', (j) => j.on('p.item_id', 'i.id').andOn('p.school_id', 's.id'))
    .leftJoin('stock_levels as l', (j) => j.on('l.item_id', 'i.id').andOn('l.school_id', 's.id'))
    .where((w) => w.whereNotNull('p.item_id').orWhere('l.qty', '>', 0))
    .where((w) => w.where('i.active', true).orWhere('l.qty', '>', 0));
  if (school) q.where('s.id', school);
  if (f.q) q.whereILike('i.name', `%${clean(f.q, 60)}%`);
  if (f.category) q.where('i.category', f.category);
  const rows = await q.orderBy('s.id').orderBy('i.category').orderBy('i.name').select(
    's.id as school_id', 's.short_name as school', 's.code', 'i.id as item_id', 'i.name', 'i.category', 'i.active',
    db.raw('coalesce(l.qty, 0)::int as qty'), db.raw('coalesce(l.reorder_level, 0)::int as reorder'), 'l.updated_at',
    db.raw('(p.item_id is not null) as sold'));
  // Paid but not yet given (the library owes parents these), on the way, damage waiting for approval.
  const owedQ = db('receipt_lines as rl').join('receipts as r', 'r.id', 'rl.receipt_id').whereIn('r.status', ['waiting', 'part'])
    .groupBy('r.school_id', 'rl.item_id').select('r.school_id', 'rl.item_id', db.raw('sum(rl.qty - rl.given_qty)::int as n'));
  const wayQ = db('delivery_lines as dl').join('deliveries as d', 'd.id', 'dl.delivery_id').where('d.status', 'sent').whereNull('dl.received_qty')
    .groupBy('d.school_id', 'dl.item_id').select('d.school_id', 'dl.item_id', db.raw('sum(dl.qty)::int as n'));
  const dmgQ = db('damages').where('status', 'pending').groupBy('school_id', 'item_id').select('school_id', 'item_id', db.raw('sum(qty)::int as n'));
  if (school) { owedQ.where('r.school_id', school); wayQ.where('d.school_id', school); dmgQ.where('school_id', school); }
  const [owed, way, dmg] = await Promise.all([owedQ, wayQ, dmgQ]);
  const key = (x) => `${x.school_id}:${x.item_id}`;
  const map = (list) => Object.fromEntries(list.map((x) => [key(x), x.n]));
  const O = map(owed), W = map(way), D = map(dmg);
  let out = rows.map((r) => {
    const k = key(r);
    const status = r.qty === 0 ? 'out' : r.reorder > 0 && r.qty <= r.reorder ? 'low' : 'ok';
    return { schoolId: r.school_id, school: r.school, code: r.code, itemId: r.item_id, name: r.name, category: r.category, sold: r.sold,
      qty: r.qty, reorder: r.reorder, owed: O[k] || 0, onTheWay: W[k] || 0, damagePending: D[k] || 0,
      free: Math.max(0, r.qty - (O[k] || 0)), short: Math.max(0, (O[k] || 0) - r.qty), status, updatedAt: r.updated_at };
  });
  if (f.status === 'low') out = out.filter((r) => r.status !== 'ok');
  else if (f.status === 'out') out = out.filter((r) => r.status === 'out');
  else if (f.status === 'short') out = out.filter((r) => r.short > 0);
  return out;
}

router.get('/', requirePage('stock'), async (req, res) => {
  const rows = await levels(req.user, req.query);
  const all = req.query.status ? await levels(req.user, { school: req.query.school }) : rows;
  res.json({
    rows,
    totals: { items: all.length, units: all.reduce((s, r) => s + r.qty, 0), low: all.filter((r) => r.status === 'low').length,
      out: all.filter((r) => r.status === 'out').length, short: all.filter((r) => r.short > 0).length,
      onTheWay: all.reduce((s, r) => s + r.onTheWay, 0), owed: all.reduce((s, r) => s + r.owed, 0) },
    canSetReorder: pageAccess(req.user.role, 'stock') === 'f',
  });
});

router.get('/export.xlsx', requirePage('stock'), async (req, res) => {
  const rows = await levels(req.user, req.query);
  await sendExcel(res, 'musabe-stock-levels', [stockSheet(rows)]);
});

const STATUS_LABEL = { ok: 'OK', low: 'Low', out: 'Out of stock' };
function stockSheet(rows) {
  return {
    name: 'Stock levels', title: `Musabe Schools: library stock levels on ${new Date().toLocaleDateString('en-GB', { timeZone: TZ })}`,
    columns: [
      { header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'School', key: 'school', width: 16 }, { header: 'Item', key: 'name', width: 28 },
      { header: 'In stock', key: 'qty', type: 'int', width: 10 }, { header: 'Paid, not given', key: 'owed', type: 'int', width: 15 },
      { header: 'Free to sell', key: 'free', type: 'int', width: 12 }, { header: 'Short (owed more than stock)', key: 'short', type: 'int', width: 16 },
      { header: 'On the way', key: 'onTheWay', type: 'int', width: 11 }, { header: 'Damage waiting', key: 'damagePending', type: 'int', width: 14 },
      { header: 'Reorder level', key: 'reorder', type: 'int', width: 13 }, { header: 'Status', key: 'st', width: 13 },
    ],
    rows: rows.map((r, i) => ({ sn: i + 1, ...r, st: STATUS_LABEL[r.status] })),
  };
}

router.patch('/reorder', requirePage('stock', 'f'), async (req, res) => {
  const b = req.body || {};
  const schoolId = Number(b.schoolId), itemId = Number(b.itemId), level = Number(b.reorderLevel);
  if (!Number.isInteger(level) || level < 0 || level > 100000) throw new HttpError(400, 'Reorder level: type a whole number (0 = no warning).');
  const [s, i] = await Promise.all([db('schools').where({ id: schoolId }).first(), db('items').where({ id: itemId }).first()]);
  if (!s || !i) throw new HttpError(404, 'School or item not found.');
  await db.transaction(async (trx) => {
    await trx('stock_levels').insert({ school_id: schoolId, item_id: itemId, qty: 0 }).onConflict(['school_id', 'item_id']).ignore();
    await trx('stock_levels').where({ school_id: schoolId, item_id: itemId }).update({ reorder_level: level });
    await audit(req, 'stock.reorder', `Reorder level for ${i.name} at ${s.short_name}: ${level || 'no warning'}`, { schoolId }, trx);
  });
  res.json({ ok: true });
});

// History (stock card): every move, newest first.
function movesQuery(user, f = {}) {
  const school = schoolOf(user, f.school);
  const q = db('stock_moves as m').join('items as i', 'i.id', 'm.item_id').join('schools as s', 's.id', 'm.school_id').leftJoin('users as u', 'u.id', 'm.by');
  if (school) q.where('m.school_id', school);
  if (f.item) q.where('m.item_id', Number(f.item));
  if (f.kind && KIND[f.kind]) q.where('m.kind', f.kind);
  if (isDate(f.from)) q.whereRaw(`(m.at AT TIME ZONE '${TZ}')::date >= ?`, [f.from]);
  if (isDate(f.to)) q.whereRaw(`(m.at AT TIME ZONE '${TZ}')::date <= ?`, [f.to]);
  return q.select('m.*', 'i.name as item', 's.short_name as school', 's.code', 'u.full_name as by_name');
}
const moveOut = (m) => ({ id: Number(m.id), at: m.at, school: m.school, code: m.code, itemId: m.item_id, item: m.item, kind: m.kind, kindLabel: KIND[m.kind],
  change: m.change, balance: m.balance, ref: m.ref, note: m.note, by: m.by_name });

router.get('/moves', requirePage('stock'), async (req, res) => {
  const rows = await movesQuery(req.user, req.query).orderBy('m.id', 'desc').limit(Math.min(Number(req.query.limit) || 300, 1000));
  res.json({ moves: rows.map(moveOut) });
});

// ---------- Deliveries ----------
const DCOLS = ['d.*', 's.short_name as school', 's.name as school_name', 's.code', 'u.full_name as sent_by_name', 'u.role as sent_by_role', 'r.number as request_number', 'q.number as requisition_number'];
function deliveries(user, f = {}) {
  const school = schoolOf(user, f.school);
  const q = db('deliveries as d').join('schools as s', 's.id', 'd.school_id').join('users as u', 'u.id', 'd.sent_by')
    .leftJoin('stock_requests as r', 'r.id', 'd.request_id').leftJoin('requisitions as q', 'q.id', 'd.requisition_id');
  if (school) q.where('d.school_id', school);
  if (f.status && DSTATUS[f.status]) q.where('d.status', f.status);
  if (isDate(f.from)) q.whereRaw(`(d.sent_at AT TIME ZONE '${TZ}')::date >= ?`, [f.from]);
  if (isDate(f.to)) q.whereRaw(`(d.sent_at AT TIME ZONE '${TZ}')::date <= ?`, [f.to]);
  return q;
}
async function withLines(rows) {
  const lines = rows.length ? await db('delivery_lines as l').leftJoin('users as u', 'u.id', 'l.confirmed_by')
    .whereIn('l.delivery_id', rows.map((d) => d.id)).orderBy('l.id').select('l.*', 'u.full_name as confirmed_by_name') : [];
  return rows.map((d) => {
    const ls = lines.filter((l) => l.delivery_id === d.id).map((l) => ({ id: l.id, itemId: l.item_id, name: l.item_name, qty: l.qty,
      received: l.received_qty, note: l.note, confirmedBy: l.confirmed_by_name, confirmedAt: l.confirmed_at,
      short: l.received_qty == null ? 0 : l.qty - l.received_qty }));
    return { id: d.id, number: d.number, schoolId: d.school_id, school: d.school, code: d.code, status: d.status, statusLabel: DSTATUS[d.status],
      note: d.note, fromMain: !!d.from_main, schoolName: d.school_name, sentBy: d.sent_by_name, sentByRole: ROLES[d.sent_by_role]?.label || null, sentAt: d.sent_at,
      requisitionId: d.requisition_id, requisitionNumber: d.requisition_number, receivedAt: d.received_at, requestId: d.request_id, requestNumber: d.request_number,
      lines: ls, units: ls.reduce((s, l) => s + l.qty, 0), waiting: ls.filter((l) => l.received == null).length,
      short: ls.reduce((s, l) => s + l.short, 0) };
  });
}

router.get('/deliveries', deliveryPage, async (req, res) => {
  const rows = await deliveries(req.user, req.query).orderBy('d.id', 'desc').limit(200).select(DCOLS);
  res.json({ deliveries: await withLines(rows), canSend: pageAccess(req.user.role, 'stockin') === 'f', canConfirm: pageAccess(req.user.role, 'incoming') === 'f' });
});

// ---------- Excel for sending stock ----------
router.get('/deliveries/template.xlsx', requirePage('stockin', 'f'), async (req, res) => {
  const school = Number(req.query.school) || null;
  const q = db('items as i').where('i.active', true).orderBy('i.category').orderBy('i.name');
  // Sold things: only those with a price in that school. Things only used (books to lend, reams, food): always.
  if (school) q.where((w) => w.where('i.sellable', false).orWhereExists(db('item_prices').where({ school_id: school }).whereRaw('item_id = i.id')));
  const items = await q;
  await sendExcel(res, 'musabe-send-stock', [{
    name: 'Send stock', title: 'Musabe Schools: send stock. Type the quantity to send; leave the rest empty. Then upload on "Send stock".',
    columns: [{ header: 'Item', key: 'name', width: 32 }, { header: 'Qty', key: 'qty', type: 'int', width: 10 }],
    rows: items.map((i) => ({ name: i.name, qty: null })),
    notes: ['One row per item. "Item" must be the item name as in Items & prices or Items to issue. "Qty" is how many you send.',
      'Rows with an empty Qty are skipped. Choose the school on the screen before uploading.'],
  }]);
});

async function oneDelivery(user, id) {
  const d = await deliveries(user).where('d.id', Number(id) || 0).first(DCOLS);
  if (!d) throw new HttpError(404, 'Delivery not found.');
  return (await withLines([d]))[0];
}
router.get('/deliveries/:id', deliveryPage, async (req, res) => res.json({ delivery: await oneDelivery(req.user, req.params.id) }));

// Lines from the form or from Excel: [{ itemId, qty }]. The same item twice becomes one line.
async function readLines(list, schoolId) {
  const want = new Map();
  for (const l of Array.isArray(list) ? list : []) {
    const id = Number(l?.itemId), qty = Number(l?.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 100000) throw new HttpError(400, 'Each item needs a whole quantity from 1 to 100,000.');
    want.set(id, (want.get(id) || 0) + qty);
  }
  if (!want.size) throw new HttpError(400, 'Add at least one item.');
  if (want.size > 100) throw new HttpError(400, 'Too many items on one delivery (more than 100). Send two deliveries.');
  const items = await db('items').whereIn('id', [...want.keys()]);
  if (items.length !== want.size) throw new HttpError(400, 'One of the items was not found. Reload the page.');
  // Things the school sells need a price in that school first. Things only used (books to lend, instruments) do not.
  const sold = new Set(await db('item_prices').where({ school_id: schoolId }).whereIn('item_id', [...want.keys()]).pluck('item_id'));
  const notSold = items.filter((i) => i.sellable && !sold.has(i.id));
  if (notSold.length) {
    const fm = await db('users').where({ role: 'fm', active: true }).first('full_name');
    const who = fm ? `Contact the Finance office, ${fm.full_name}.` : 'Contact the Finance office — it has no price there yet.';
    throw new HttpError(400, `Not sold in this school: ${notSold.map((i) => i.name).join(', ')}. ${who}`);
  }
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  return [...want].map(([id, qty]) => ({ item_id: id, item_name: byId[id].name, qty }));
}

// Make a delivery to one school's library (used by "Send stock" and when a purchase for a school is confirmed).
// There is no main store (2026-11-16): goods land at the office and go straight to the school.
// Things that come back (books, instruments) get one QR code per piece now; the store-keeper prints and sticks them.
// The pieces wait as "coming" until the librarian confirms.
async function makeDelivery(trx, req, { school, lines, note, sentBy, request = null, rqn = null, purchase = null }) {
  const [{ id: did }] = await trx('deliveries').insert({ school_id: school.id, request_id: request?.id ?? null, requisition_id: rqn?.id ?? null, note,
    sent_by: sentBy, from_main: false }).returning('id');
  const number = stock.paperNo('DLV', did);
  await trx('deliveries').where({ id: did }).update({ number });
  const saved = await trx('delivery_lines').insert(lines.map((l) => ({ item_id: l.item_id, item_name: l.item_name, qty: l.qty, delivery_id: did }))).returning(['id', 'item_id', 'qty']);
  const back = new Set(await trx('items').whereIn('id', saved.map((l) => l.item_id)).where({ returnable: true }).pluck('id'));
  let pieces = 0;
  for (const l of saved.filter((x) => back.has(x.item_id))) {
    await trx('item_copies').insert(Array.from({ length: l.qty }, () => ({ item_id: l.item_id, school_id: school.id, status: 'coming', delivery_line_id: l.id, created_by: req.user.id })));
    pieces += l.qty;
  }
  if (request) {
    const rl = await trx('stock_request_lines').where({ request_id: request.id });
    for (const l of rl) {
      const sent = lines.filter((x) => x.item_id === l.item_id).reduce((s, x) => s + x.qty, 0);
      if (sent) await trx('stock_request_lines').where({ id: l.id }).update({ sent_qty: sent });
    }
    await trx('stock_requests').where({ id: request.id }).update({ status: 'sent', answered_by: req.user.id, answered_at: trx.fn.now(), answer_note: `Sent on ${number}` });
    await audit(req, 'request.sent', `${request.number} answered: stock sent on ${number}`, { schoolId: school.id, detail: { requestId: request.id, deliveryId: did } }, trx);
  }
  if (rqn) {
    await trx('requisitions').where({ id: rqn.id }).update({ status: 'sent', delivery_id: did });
    await audit(req, 'requisition.sent', `${rqn.number}: sent to ${school.short_name} on ${number}. The librarian checks and signs`,
      { schoolId: school.id, detail: { requisitionId: rqn.id, deliveryId: did, userId: rqn.requested_by } }, trx);
  }
  const units = lines.reduce((s, l) => s + l.qty, 0);
  await audit(req, 'delivery.send', `${purchase ? `${purchase.number} confirmed: ` : ''}Sent ${number} to ${school.short_name}: ${lines.map((l) => `${l.qty} × ${l.item_name}`).join(', ')} (${plural(units, 'item')})${pieces ? `, ${pieces} QR labels to stick on` : ''}. Waiting for the librarian to check and sign`,
    { schoolId: school.id, detail: { deliveryId: did } }, trx);
  return { id: did, number };
}

router.post('/deliveries', requirePage('stockin', 'f'), async (req, res) => {
  const b = req.body || {};
  const school = await db('schools').where({ id: Number(b.schoolId) || 0, active: true }).first();
  if (!school) throw new HttpError(400, 'Choose the school the stock goes to.');
  const lines = await readLines(b.lines, school.id);
  const note = clean(b.note, 300) || null;
  let request = null;
  if (b.requestId) {
    request = await db('stock_requests').where({ id: Number(b.requestId) }).first();
    if (!request || request.school_id !== school.id) throw new HttpError(400, 'That stock request is not from this school.');
    if (request.status !== 'pending') throw new HttpError(409, `${request.number} was already ${request.status}.`);
  }
  if (b.requisitionId) throw new HttpError(400, 'A requisition is bought on Purchases; it goes to the school when the accountant confirms.');
  const d = await db.transaction((trx) => makeDelivery(trx, req, { school, lines, note, sentBy: req.user.id, request }));
  res.status(201).json({ delivery: await oneDelivery(req.user, d.id) });
});

router.post('/deliveries/:id/cancel', requirePage('stockin', 'f'), async (req, res) => {
  await db.transaction(async (trx) => {
    const d = await trx('deliveries').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!d) throw new HttpError(404, 'Delivery not found.');
    if (d.status !== 'sent') throw new HttpError(409, `${d.number} is already ${DSTATUS[d.status].toLowerCase()}.`);
    const done = await trx('delivery_lines').where({ delivery_id: d.id }).whereNotNull('received_qty').first();
    if (done) throw new HttpError(409, `The librarian has already confirmed part of ${d.number}. It cannot be cancelled now.`);
    await trx('deliveries').where({ id: d.id }).update({ status: 'cancelled', cancelled_by: req.user.id, cancelled_at: trx.fn.now() });
    // QR labels made for this delivery will not be used.
    await trx('item_copies').whereIn('delivery_line_id', trx('delivery_lines').where({ delivery_id: d.id }).select('id')).where({ status: 'coming' })
      .update({ status: 'lost', note: `Label not used: ${d.number} cancelled` });
    if (d.from_main) { // back into the main store (old deliveries only)
      for (const l of await trx('delivery_lines').where({ delivery_id: d.id }))
        await stock.move(trx, { schoolId: null, itemId: l.item_id, itemName: l.item_name, change: l.qty, kind: 'send', ref: d.number, refId: d.id, note: 'Delivery cancelled', by: req.user.id });
    }
    if (d.request_id) await trx('stock_requests').where({ id: d.request_id, status: 'sent' }).update({ status: 'pending', answer_note: `${d.number} was cancelled` });
    if (d.requisition_id) { // the requisition waits to be sent again
      const bought = await trx('purchases').where({ requisition_id: d.requisition_id, status: 'confirmed' }).first();
      await trx('requisitions').where({ id: d.requisition_id, status: 'sent' }).update({ status: bought ? 'arrived' : 'approved', delivery_id: null });
    }
    await audit(req, 'delivery.cancel', `Cancelled ${d.number} (not yet received)${clean(req.body?.reason, 200) ? `: ${clean(req.body.reason, 200)}` : ''}`,
      { schoolId: d.school_id, detail: { deliveryId: d.id } }, trx);
  });
  res.json({ delivery: await oneDelivery(req.user, req.params.id) });
});

// The librarian confirms one line: how many really arrived. Fewer than sent needs a note.
async function confirmLine(trx, req, d, line, received, note) {
  if (!Number.isInteger(received) || received < 0 || received > line.qty) throw new HttpError(400, `${line.item_name}: type how many arrived (0 to ${line.qty}).`);
  if (received < line.qty && !note) throw new HttpError(400, `${line.item_name}: ${line.qty - received} fewer than sent. Write a note (e.g. "3 missing", "2 torn").`);
  await trx('delivery_lines').where({ id: line.id }).update({ received_qty: received, note, confirmed_by: req.user.id, confirmed_at: trx.fn.now() });
  if (received > 0) await stock.move(trx, { schoolId: d.school_id, itemId: line.item_id, itemName: line.item_name, change: received, kind: 'in', ref: d.number, refId: d.id, note, by: req.user.id });
  // Pieces with their own QR code: the ones that arrived are now on the shelf; the missing ones are marked lost.
  const coming = await trx('item_copies').where({ delivery_line_id: line.id, status: 'coming' }).orderBy('id').pluck('id');
  if (coming.length) {
    await trx('item_copies').whereIn('id', coming.slice(0, received)).update({ status: 'in' });
    if (coming.length > received) await trx('item_copies').whereIn('id', coming.slice(received)).update({ status: 'lost', note: `Did not arrive on ${d.number}: ${note || ''}`.slice(0, 200) });
  }
  return received < line.qty ? `${line.item_name}: ${line.qty - received} short (${note})` : null;
}

async function afterConfirm(trx, req, d, confirmed, shorts) {
  const left = await trx('delivery_lines').where({ delivery_id: d.id }).whereNull('received_qty').count('* as n');
  const done = Number(left[0].n) === 0;
  if (done) await trx('deliveries').where({ id: d.id }).update({ status: 'received', received_at: trx.fn.now() });
  if (done && d.requisition_id) {
    const r = await trx('requisitions').where({ id: d.requisition_id, status: 'sent' }).first();
    if (r) {
      await trx('requisitions').where({ id: r.id }).update({ status: 'done', done_at: trx.fn.now() });
      await audit(req, 'requisition.done', `${r.number}: received by the library of the school (${d.number})${shorts.length ? `, with differences` : ''}`,
        { schoolId: d.school_id, detail: { requisitionId: r.id, deliveryId: d.id, userId: r.requested_by } }, trx);
    }
  }
  await audit(req, 'delivery.confirm', `${done ? 'Received all of' : 'Confirmed part of'} ${d.number}: ${confirmed.join(', ')}`,
    { schoolId: d.school_id, detail: { deliveryId: d.id } }, trx);
  if (shorts.length) await audit(req, 'delivery.short', `${d.number}: less arrived than was sent. ${shorts.join('; ')}`, { schoolId: d.school_id, detail: { deliveryId: d.id } }, trx);
}

async function lockDelivery(trx, req) {
  const d = await trx('deliveries').where({ id: Number(req.params.id) || 0, school_id: req.user.school_id }).forUpdate().first();
  if (!d) throw new HttpError(404, 'Delivery not found in your school.');
  if (d.status !== 'sent') throw new HttpError(409, `${d.number} is already ${DSTATUS[d.status].toLowerCase()}.`);
  return d;
}

router.post('/deliveries/:id/lines/:line/confirm', requirePage('incoming', 'f'), async (req, res) => {
  const b = req.body || {};
  await db.transaction(async (trx) => {
    const d = await lockDelivery(trx, req);
    const line = await trx('delivery_lines').where({ id: Number(req.params.line) || 0, delivery_id: d.id }).first();
    if (!line) throw new HttpError(404, 'This line is not on the delivery.');
    if (line.received_qty != null) throw new HttpError(409, `${line.item_name} is already confirmed.`);
    const received = b.receivedQty === undefined ? line.qty : Number(b.receivedQty);
    const note = clean(b.note, 200) || null;
    const short = await confirmLine(trx, req, d, line, received, note);
    await afterConfirm(trx, req, d, [`${received} × ${line.item_name}`], short ? [short] : []);
  });
  res.json({ delivery: await oneDelivery(req.user, req.params.id) });
});

// Everything not yet confirmed arrived as sent.
router.post('/deliveries/:id/confirm-all', requirePage('incoming', 'f'), async (req, res) => {
  await db.transaction(async (trx) => {
    const d = await lockDelivery(trx, req);
    const lines = await trx('delivery_lines').where({ delivery_id: d.id }).whereNull('received_qty').orderBy('id');
    for (const l of lines) await confirmLine(trx, req, d, l, l.qty, null);
    await afterConfirm(trx, req, d, lines.map((l) => `${l.qty} × ${l.item_name}`), []);
  });
  res.json({ delivery: await oneDelivery(req.user, req.params.id) });
});

// Read an uploaded file into lines for the form (nothing is saved here).
router.post('/deliveries/read', requirePage('stockin', 'f'), uploadLimit, express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
  const rows = await readExcel(req.body, 'item');
  const items = await db('items').where({ active: true });
  const byName = Object.fromEntries(items.map((i) => [i.name.toLowerCase(), i]));
  const lines = [], mistakes = [];
  for (const r of rows) {
    const qtyText = String(r.qty ?? r.quantity ?? '').replace(/[,\s]/g, '');
    if (!qtyText) continue;
    const item = byName[String(r.item || '').trim().replace(/\s+/g, ' ').toLowerCase()];
    const qty = Number(qtyText);
    if (!item) mistakes.push(`Row ${r._row}: "${r.item}" is not in the items list.`);
    else if (!Number.isInteger(qty) || qty < 1) mistakes.push(`Row ${r._row}: ${item.name}: quantity must be a whole number above 0.`);
    else lines.push({ itemId: item.id, name: item.name, qty });
  }
  if (!lines.length && !mistakes.length) throw new HttpError(400, 'No quantities found. Type a number in the Qty column for the items you send.');
  res.json({ lines, mistakes });
});

module.exports = router;
module.exports.makeDelivery = makeDelivery;
module.exports.readLines = readLines;
module.exports.levels = levels;
module.exports.stockSheet = stockSheet;
module.exports.movesQuery = movesQuery;
module.exports.moveOut = moveOut;
module.exports.deliveries = deliveries;
module.exports.withLines = withLines;
module.exports.DCOLS = DCOLS;
module.exports.KIND = KIND;
