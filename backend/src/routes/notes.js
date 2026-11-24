// Issue Notes (2026-11-24). The Second Master writes an Issue Note; the keeper of the place gives against it.
// - Uniform (and other things the school store holds) sold on a receipt: the parent pays at the bank, the Bursar writes the
//   receipt, the Second Master writes the Issue Note from that receipt, the School Store-keeper gives. Library things on the
//   same receipt get their own note for the Librarian.
// - A note can also be for a staff member or for a place (e.g. cleaning things to the kitchen).
// - Numbers run per school and place: BS/ST/ISN.0001 (school store), BS/LIB/ISN.0001 (library).
// - Stock goes down only when the keeper gives. A note not yet given can be cancelled with a reason; nothing is deleted.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES } = require('../auth/roles');
const { publish } = require('../realtime');
const stock = require('../lib/stock');
const P = require('../lib/places');
const { sendExcel } = require('../lib/excel');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const STATUS = { open: 'Waiting to give', part: 'Partly given', given: 'Given', cancelled: 'Cancelled' };
const KIND = { receipt: 'Sold on a receipt', staff: 'To a staff member', place: 'To a place' };
const WRITERS = ['second', 'head'];

// Who may give from a place: its own keeper. While the school has not switched on "strict places", the Librarian may give both.
const canGive = (user, place, strict) => (user.role === 'sstore' && place === 'school_store') || (user.role === 'librarian' && (place === 'library' || !strict));
const myPlaces = (user, strict) => (user.role === 'sstore' ? ['school_store'] : user.role === 'librarian' ? (strict ? ['library'] : ['library', 'school_store']) : ['library', 'school_store']);
const schoolOf = (u, wanted) => (allSchools(u) ? (Number(wanted) || null) : u.school_id);

async function strictOf(schoolId, trx = db) {
  const s = await trx('schools').where({ id: schoolId }).first('places_strict');
  return !!s?.places_strict;
}

function listQuery(user, f = {}) {
  const q = db('issue_notes as n').join('schools as s', 's.id', 'n.school_id').join('users as w', 'w.id', 'n.written_by')
    .leftJoin('receipts as r', 'r.id', 'n.receipt_id');
  const school = schoolOf(user, f.school);
  if (school) q.where('n.school_id', school);
  if (f.place && P.PLACES[f.place]) q.where('n.place', f.place);
  if (f.status === 'todo') q.whereIn('n.status', ['open', 'part']);
  else if (STATUS[f.status]) q.where('n.status', f.status);
  if (f.q) { const t = `%${clean(f.q, 60)}%`; q.where((w) => w.whereILike('n.number', t).orWhereILike('n.recipient', t).orWhereILike('r.student_name', t).orWhereILike('r.number', t)); }
  return q;
}
const shape = (n, strict) => ({ id: n.id, number: n.number, place: n.place, placeLabel: P.PLACES[n.place].label, kind: n.kind, kindLabel: KIND[n.kind], status: n.status, statusLabel: STATUS[n.status],
  schoolId: n.school_id, school: n.school_short, receiptId: n.receipt_id, receipt: n.receipt_number, student: n.student_name, recipient: n.recipient, note: n.note,
  writtenBy: n.written_by_name, writtenAt: n.written_at, cancelReason: n.cancel_reason, strict });

async function one(user, id) {
  const n = await listQuery(user).where('n.id', Number(id) || 0)
    .select('n.*', 's.short_name as school_short', 's.places_strict', 'w.full_name as written_by_name', 'r.number as receipt_number', 'r.student_name').first();
  if (!n) throw new HttpError(404, 'Issue Note not found.');
  const lines = await db('issue_note_lines').where({ note_id: n.id }).orderBy('id');
  const gives = await db('issue_note_gives as g').join('users as u', 'u.id', 'g.given_by').join('issue_note_lines as l', 'l.id', 'g.line_id')
    .where('g.note_id', n.id).orderBy('g.at').select('g.id', 'g.qty', 'g.collected_by', 'g.at', 'u.full_name as by', 'l.item_name');
  return { ...shape(n, n.places_strict), canGive: canGive(user, n.place, n.places_strict) && n.school_id === user.school_id && ['open', 'part'].includes(n.status),
    canCancel: WRITERS.includes(user.role) && n.school_id === user.school_id && n.status === 'open',
    lines: lines.map((l) => ({ id: l.id, itemId: l.item_id, name: l.item_name, qty: l.qty, given: l.given_qty, left: l.qty - l.given_qty })),
    gives: gives.map((g) => ({ id: g.id, name: g.item_name, qty: g.qty, collectedBy: g.collected_by, at: g.at, by: g.by })) };
}

// ---------- List ----------
router.get('/', requirePage('notes'), async (req, res) => {
  const rows = await listQuery(req.user, req.query).orderBy('n.written_at', 'desc').orderBy('n.id', 'desc').limit(300)
    .select('n.*', 's.short_name as school_short', 's.places_strict', 'w.full_name as written_by_name', 'r.number as receipt_number', 'r.student_name');
  const todo = await listQuery(req.user, {}).whereIn('n.status', ['open', 'part']).count('* as n').first();
  res.json({ notes: rows.map((n) => shape(n, n.places_strict)), todo: Number(todo.n), places: P.PLACES,
    canWrite: WRITERS.includes(req.user.role), myPlaces: myPlaces(req.user, req.user.school_id ? await strictOf(req.user.school_id) : false) });
});

router.get('/export.xlsx', requirePage('notes'), async (req, res) => {
  const rows = await listQuery(req.user, req.query).orderBy('n.written_at', 'desc')
    .select('n.*', 's.short_name as school_short', 'w.full_name as written_by_name', 'r.number as receipt_number', 'r.student_name');
  const lines = await db('issue_note_lines').whereIn('note_id', rows.map((r) => r.id));
  const by = {};
  for (const l of lines) (by[l.note_id] ||= []).push(`${l.given_qty}/${l.qty} ${l.item_name}`);
  await sendExcel(res, 'musabe-issue-notes', [{ name: 'Issue Notes', title: 'Musabe Schools: Issue Notes', columns: [
    { header: 'Number', key: 'number', width: 18 }, { header: 'School', key: 'school_short', width: 16 }, { header: 'Place', key: 'place', width: 12 }, { header: 'Kind', key: 'kind', width: 18 },
    { header: 'For', key: 'for', width: 26 }, { header: 'Status', key: 'status', width: 16 }, { header: 'Items (given/asked)', key: 'items', width: 50 }, { header: 'Written by', key: 'written_by_name', width: 22 }],
  rows: rows.map((n) => ({ ...n, place: P.PLACES[n.place].label, kind: KIND[n.kind], for: n.kind === 'receipt' ? `${n.student_name} (${n.receipt_number})` : n.recipient, status: STATUS[n.status], items: (by[n.id] || []).join('; ') })) }]);
});

// ---------- Receipts that still need an Issue Note (the Second Master's list) ----------
async function remainingOnReceipt(trx, receiptId) {
  const lines = await trx('receipt_lines as l').join('items as i', 'i.id', 'l.item_id').where('l.receipt_id', receiptId)
    .select('l.id', 'l.item_id', 'l.item_name', 'l.qty', 'l.given_qty', 'i.category');
  const noted = await trx('issue_note_lines as nl').join('issue_notes as n', 'n.id', 'nl.note_id')
    .whereIn('nl.receipt_line_id', lines.map((l) => l.id)).whereIn('n.status', ['open', 'part'])
    .groupBy('nl.receipt_line_id').select('nl.receipt_line_id as id', trx.raw('sum(nl.qty - nl.given_qty)::int as open'));
  const open = Object.fromEntries(noted.map((x) => [x.id, x.open]));
  return lines.map((l) => ({ ...l, left: l.qty - l.given_qty - (open[l.id] || 0), place: P.placeOf(l.category) })).filter((l) => l.left > 0);
}

router.get('/to-write', requirePage('notes', 'f'), async (req, res) => {
  if (!WRITERS.includes(req.user.role)) throw new HttpError(403, 'The Second Master writes Issue Notes.');
  const rs = await db('receipts').where({ school_id: req.user.school_id }).whereIn('status', ['waiting', 'part']).orderBy('sold_at').limit(100)
    .select('id', 'number', 'student_name', 'student_class', 'sold_at', 'total');
  const out = [];
  for (const r of rs) {
    const left = await remainingOnReceipt(db, r.id);
    if (left.length) out.push({ id: r.id, number: r.number, student: r.student_name, class: r.student_class, soldAt: r.sold_at, total: Number(r.total),
      lines: left.map((l) => ({ name: l.item_name, qty: l.left, place: l.place })) });
  }
  res.json({ receipts: out });
});

// ---------- Write ----------
async function insertNote(trx, req, { schoolId, place, kind, receiptId = null, recipient = null, note = null, lines }) {
  const school = await trx('schools').where({ id: schoolId }).first();
  const seq = await P.nextSeq(trx, 'issue_notes', schoolId, place);
  const number = P.placeNo(school.receipt_prefix, place, 'ISN', seq);
  const [{ id }] = await trx('issue_notes').insert({ school_id: schoolId, place, seq, number, kind, receipt_id: receiptId, recipient, note, written_by: req.user.id }).returning('id');
  await trx('issue_note_lines').insert(lines.map((l) => ({ note_id: id, item_id: l.item_id, item_name: l.item_name, qty: l.qty, receipt_line_id: l.receipt_line_id ?? null })));
  await audit(req, 'note.create', `${number} written (${P.PLACES[place].label}): ${lines.map((l) => `${l.qty} × ${l.item_name}`).join(', ')}${recipient ? ` for ${recipient}` : ''}`,
    { schoolId, detail: { noteId: id } }, trx);
  return { id, number };
}

router.post('/', requirePage('notes', 'f'), async (req, res) => {
  if (!WRITERS.includes(req.user.role)) throw new HttpError(403, 'The Second Master writes Issue Notes.');
  const b = req.body || {};
  const schoolId = req.user.school_id;
  const made = await db.transaction(async (trx) => {
    if (b.kind === 'receipt') {
      const r = await trx('receipts').where({ id: Number(b.receiptId) || 0, school_id: schoolId }).forUpdate().first();
      if (!r) throw new HttpError(404, 'Receipt not found in your school.');
      const left = await remainingOnReceipt(trx, r.id);
      if (!left.length) throw new HttpError(409, `${r.number}: everything on it is already given or has an Issue Note.`);
      const out = [];
      for (const place of ['library', 'school_store']) {
        const ls = left.filter((l) => l.place === place);
        if (ls.length) out.push(await insertNote(trx, req, { schoolId, place, kind: 'receipt', receiptId: r.id, note: clean(b.note, 300) || null,
          lines: ls.map((l) => ({ item_id: l.item_id, item_name: l.item_name, qty: l.left, receipt_line_id: l.id })) }));
      }
      return out;
    }
    if (!['staff', 'place'].includes(b.kind)) throw new HttpError(400, 'Choose what the note is for: a receipt, a staff member or a place.');
    const place = P.PLACES[b.place] ? b.place : null;
    if (!place) throw new HttpError(400, 'Choose the place that gives: Library or School store.');
    const recipient = clean(b.recipient, 120).toUpperCase();
    if (recipient.length < 3) throw new HttpError(400, b.kind === 'staff' ? 'Write the name of the staff member.' : 'Write the place that receives (e.g. Kitchen).');
    const want = new Map();
    for (const l of Array.isArray(b.lines) ? b.lines : []) {
      const id = Number(l?.itemId), qty = Number(l?.qty);
      if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 100000) throw new HttpError(400, 'Each item needs a whole quantity from 1 to 100,000.');
      want.set(id, (want.get(id) || 0) + qty);
    }
    if (!want.size) throw new HttpError(400, 'Add at least one item.');
    const items = await trx('items').whereIn('id', [...want.keys()]);
    if (items.length !== want.size) throw new HttpError(400, 'One of the items was not found. Reload the page.');
    const wrong = items.filter((i) => P.placeOf(i.category) !== place);
    if (wrong.length) throw new HttpError(400, `${wrong.map((i) => i.name).join(', ')} ${wrong.length === 1 ? 'is' : 'are'} not kept in the ${P.PLACES[place].label.toLowerCase()}. Write another note for the other place.`);
    return [await insertNote(trx, req, { schoolId, place, kind: b.kind, recipient, note: clean(b.note, 300) || null, lines: items.map((i) => ({ item_id: i.id, item_name: i.name, qty: want.get(i.id) })) })];
  });
  publish({ topics: ['note'], schoolId }, db);
  res.status(201).json({ notes: made });
});

// ---------- Give ----------
router.post('/:id/give', requirePage('notes', 'f'), async (req, res) => {
  const b = req.body || {};
  const collectedBy = clean(b.collectedBy, 120).toUpperCase() || null;
  const want = new Map();
  for (const l of Array.isArray(b.lines) ? b.lines : []) {
    const id = Number(l?.lineId), qty = Number(l?.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 0) throw new HttpError(400, 'Quantities must be whole numbers.');
    if (qty > 0) want.set(id, (want.get(id) || 0) + qty);
  }
  if (!want.size) throw new HttpError(400, 'Tick at least one item to give.');
  await db.transaction(async (trx) => {
    const n = await trx('issue_notes').where({ id: Number(req.params.id) || 0, school_id: req.user.school_id }).forUpdate().first();
    if (!n) throw new HttpError(404, 'Issue Note not found in your school.');
    const strict = await strictOf(n.school_id, trx);
    if (!canGive(req.user, n.place, strict)) throw new HttpError(403, `${P.PLACES[n.place].label} things are given by the ${n.place === 'library' ? 'Librarian' : 'School Store-keeper'}.`);
    if (!['open', 'part'].includes(n.status)) throw new HttpError(409, `${n.number} is ${STATUS[n.status].toLowerCase()}.`);
    const lines = await trx('issue_note_lines').where({ note_id: n.id }).orderBy('id');
    const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
    for (const [lineId, qty] of want) {
      const l = byId[lineId];
      if (!l) throw new HttpError(400, 'An item is not on this note. Reload the page.');
      if (qty > l.qty - l.given_qty) throw new HttpError(409, `${l.item_name}: only ${l.qty - l.given_qty} left to give on this note.`);
    }
    let r = null, gid = null;
    if (n.kind === 'receipt') { // the receipt shows what was given, like a give at the library desk
      r = await trx('receipts').where({ id: n.receipt_id }).forUpdate().first();
      const rls = await trx('receipt_lines').whereIn('id', lines.map((l) => l.receipt_line_id).filter(Boolean));
      const rb = Object.fromEntries(rls.map((l) => [l.id, l]));
      for (const [lineId, qty] of want) {
        const rl = rb[byId[lineId].receipt_line_id];
        if (!rl || qty > rl.qty - rl.given_qty) throw new HttpError(409, `${byId[lineId].item_name}: this was already given on the receipt.`);
      }
      [{ id: gid }] = await trx('gives').insert({ receipt_id: r.id, school_id: r.school_id, collected_by: collectedBy, note: `Issue Note ${n.number}`, given_by: req.user.id }).returning('id');
      await trx('give_lines').insert([...want].map(([lineId, qty]) => ({ give_id: gid, receipt_line_id: byId[lineId].receipt_line_id, item_id: byId[lineId].item_id, qty })));
      for (const [lineId, qty] of want) await trx('receipt_lines').where({ id: byId[lineId].receipt_line_id }).increment('given_qty', qty);
    }
    const low = [];
    const per = new Map();
    for (const [lineId, qty] of want) per.set(byId[lineId].item_id, { name: byId[lineId].item_name, qty: (per.get(byId[lineId].item_id)?.qty || 0) + qty });
    for (const [itemId, x] of per) {
      const m = await stock.move(trx, { schoolId: n.school_id, itemId, itemName: x.name, change: -x.qty, kind: n.kind === 'receipt' ? 'give' : 'issue', ref: n.number, refId: n.id, by: req.user.id });
      if (m.low) low.push(`${x.name} (${m.after} left, reorder at ${m.reorder})`);
    }
    for (const [lineId, qty] of want) {
      await trx('issue_note_lines').where({ id: lineId }).increment('given_qty', qty);
      await trx('issue_note_gives').insert({ note_id: n.id, line_id: lineId, qty, collected_by: collectedBy, given_by: req.user.id });
    }
    const left = lines.reduce((s, l) => s + l.qty - l.given_qty - (want.get(l.id) || 0), 0);
    await trx('issue_notes').where({ id: n.id }).update({ status: left === 0 ? 'given' : 'part' });
    if (r) {
      const rleft = await trx('receipt_lines').where({ receipt_id: r.id }).select(trx.raw('sum(qty - given_qty)::int as left')).first();
      const status = Number(rleft.left) === 0 ? 'given' : 'part';
      await trx('receipts').where({ id: r.id }).update({ status, given_at: status === 'given' ? trx.fn.now() : null });
      if (r.student_id) await require('../lib/parents').notice(trx, { studentId: r.student_id, schoolId: r.school_id, kind: 'given', ref: r.number,
        title: `Collected from the ${P.PLACES[n.place].label.toLowerCase()}`, body: `${r.student_name} collected ${[...want].map(([lineId, qty]) => `${qty} × ${byId[lineId].item_name}`).join(', ')} paid on receipt ${r.number}.` });
    }
    const what = [...want].map(([lineId, qty]) => `${qty} × ${byId[lineId].item_name}`).join(', ');
    await audit(req, 'note.give', `${left === 0 ? 'Gave all items' : 'Gave part of the items'} on ${n.number}: ${what}${collectedBy ? `. Collected by ${collectedBy}` : ''}${left ? `. ${plural(left, 'item')} still to give` : ''}`,
      { schoolId: n.school_id, detail: { noteId: n.id } }, trx);
    if (low.length) await audit(req, 'stock.low', `Low stock at the ${P.PLACES[n.place].label.toLowerCase()}: ${low.join(', ')}`, { schoolId: n.school_id }, trx);
  });
  publish({ topics: ['note', 'stock', 'receipt'], schoolId: req.user.school_id }, db);
  res.json({ note: await one(req.user, req.params.id) });
});

router.post('/:id/cancel', requirePage('notes', 'f'), async (req, res) => {
  if (!WRITERS.includes(req.user.role)) throw new HttpError(403, 'The Second Master cancels Issue Notes.');
  const reason = clean(req.body?.reason, 200);
  if (reason.length < 3) throw new HttpError(400, 'Write why the note is cancelled.');
  await db.transaction(async (trx) => {
    const n = await trx('issue_notes').where({ id: Number(req.params.id) || 0, school_id: req.user.school_id }).forUpdate().first();
    if (!n) throw new HttpError(404, 'Issue Note not found in your school.');
    if (n.status !== 'open') throw new HttpError(409, `${n.number} is ${STATUS[n.status].toLowerCase()}: only a note with nothing given can be cancelled.`);
    await trx('issue_notes').where({ id: n.id }).update({ status: 'cancelled', cancelled_by: req.user.id, cancelled_at: trx.fn.now(), cancel_reason: reason });
    await audit(req, 'note.cancel', `${n.number} cancelled: ${reason}`, { schoolId: n.school_id, detail: { noteId: n.id } }, trx);
  });
  publish({ topics: ['note'], schoolId: req.user.school_id }, db);
  res.json({ note: await one(req.user, req.params.id) });
});

// ---------- Stock of the place ----------
router.get('/stock', requirePage('notes'), async (req, res) => {
  const schoolId = schoolOf(req.user, req.query.school);
  if (!schoolId) throw new HttpError(400, 'Choose a school.');
  const strict = await strictOf(schoolId);
  const places = req.query.place && P.PLACES[req.query.place] ? [req.query.place] : myPlaces(req.user, strict);
  const rows = await db('stock_levels as l').join('items as i', 'i.id', 'l.item_id').where('l.school_id', schoolId).where('l.qty', '>', 0)
    .whereIn('i.category', places.flatMap(P.categoriesOf)).orderBy('i.category').orderBy('i.name').select('l.item_id', 'i.name', 'i.category', 'i.unit', 'l.qty', 'l.reorder_level');
  res.json({ strict, places, items: rows.map((r) => ({ itemId: r.item_id, name: r.name, category: r.category, place: P.placeOf(r.category), unit: r.unit, qty: r.qty, reorder: r.reorder_level, low: r.reorder_level > 0 && r.qty <= r.reorder_level })) });
});

// Things the Second Master may put on a note: items of one place (not only those with stock).
router.get('/items', requirePage('notes', 'f'), async (req, res) => {
  const place = P.PLACES[req.query.place] ? req.query.place : 'school_store';
  const rows = await db('items').where({ active: true }).whereIn('category', P.categoriesOf(place)).orderBy('name').select('id', 'name', 'unit');
  res.json({ items: rows });
});

// ---------- Strict places: the School Admin or Super Admin switches it on once the School Store-keeper has an account ----------
router.post('/strict', requirePage('notes'), async (req, res) => {
  if (!['sadmin', 'super'].includes(req.user.role)) throw new HttpError(403, 'The School Admin or the Super Admin changes this.');
  const schoolId = schoolOf(req.user, req.body?.schoolId);
  if (!schoolId) throw new HttpError(400, 'Choose a school.');
  const strict = !!req.body?.strict;
  if (strict && !(await db('users').where({ school_id: schoolId, role: 'sstore', active: true }).first())
    && !(await db('user_roles').where({ school_id: schoolId, role: 'sstore', active: true }).first())) throw new HttpError(409, 'Create the School Store-keeper account of this school first.');
  await db('schools').where({ id: schoolId }).update({ places_strict: strict });
  await audit(req, 'school.places', strict ? 'Library and School store are now kept apart: each keeper gives and receives only his own place' : 'Library and School store are no longer kept apart: the Librarian may handle both', { schoolId });
  res.json({ strict });
});

router.get('/:id', requirePage('notes'), async (req, res) => res.json({ note: await one(req.user, req.params.id) }));

module.exports = router;
