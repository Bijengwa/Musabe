// Barcodes, scanning, issuing and the main store.
//
// "My store": the librarian works in the library of own school; the store-keeper works in the main store.
// - Scan (GET /scan): says what a barcode is: an item, one piece, a student ID or a staff ID.
// - Issue (POST /issues): give things out by scanning. Things that come back are given piece by piece to a person
//   with an ID (student or staff). Things that do not come back are given by item and quantity, also to a place (kitchen).
// - Return (POST /returns): scan the piece back in: good (back on the shelf), damaged or lost.
// - Labels: system barcodes, the maker's barcodes, pieces (one code each), ID cards.
// - Items the school buys and uses (not sold): added by the store-keeper or the Finance Manager.
// Stock always changes through lib/stock.js move().
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES, ISSUERS, STORE_ITEM_MAKERS, CARD_ISSUERS, pageAccess } = require('../auth/roles');
const { sendExcel, readExcel } = require('../lib/excel');
const { uploadLimit } = require('../lib/guard');
const { codeFor, parseCode } = require('../lib/codes');
const stock = require('../lib/stock');
const { CATEGORIES, CATEGORY_LABEL } = require('./items');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const UNITS = ['pc', 'pair', 'set', 'kg', 'g', 'litre', 'bag', 'box', 'ream', 'packet', 'bottle', 'tin', 'dozen', 'roll'];
const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const classLabel = (c) => [c.class_short || c.class_name, c.class_stream].filter(Boolean).join(' ');
const anyPage = (...pages) => (req, _res, next) => {
  if (!pages.some((p) => pageAccess(req.user.role, p))) throw new HttpError(403, 'Your account is not allowed to do this.');
  next();
};
const issuer = (req, _res, next) => {
  if (!ISSUERS.includes(req.user.role)) throw new HttpError(403, 'Only the librarian (school library) or the store-keeper (main store) does this.');
  next();
};

// The store a person works in or looks at: a school library (there is no main store since 2026-11-16).
// School staff: own school. Administration: the school chosen with ?school=<id>; nothing chosen = undefined (all).
function storeOf(user, wanted) {
  if (!allSchools(user)) return user.school_id;
  return Number(wanted) || undefined;
}
const inStore = (q, col, store) => (store === undefined ? q : store === null ? q.whereNull(col) : q.where(col, store));
const storeName = async (store) => (store == null ? 'All schools' : (await db('schools').where({ id: store }).first('short_name'))?.short_name || 'School');

// ---------- People with an ID ----------
const STUDENT_COLS = ['s.id', 's.full_name', 's.admission_no', 's.status', 's.school_id', 'c.name as class_name', 'c.short_name as class_short', 'c.stream as class_stream', 'sc.short_name as school'];
const studentsQ = () => db('students as s').leftJoin('classes as c', 'c.id', 's.class_id').join('schools as sc', 'sc.id', 's.school_id');
const staffQ = () => db('users as u').leftJoin('schools as sc', 'sc.id', 'u.school_id');
const studentOut = (s) => ({ type: 'student', id: s.id, code: codeFor('student', s.id), name: s.full_name, detail: classLabel(s) || '-', admissionNo: s.admission_no,
  schoolId: s.school_id, school: s.school, left: s.status !== 'active' });
const staffOut = (u) => ({ type: 'staff', id: u.id, code: codeFor('staff', u.id), name: u.full_name, detail: ROLES[u.role]?.label || u.role, schoolId: u.school_id,
  school: u.school || 'Administration', off: !u.active });
// School staff only meet people of their own school.
const mine = (q, col, user) => (allSchools(user) ? q : q.where(col, user.school_id));

async function findStudent(user, id) {
  const s = await mine(studentsQ().where('s.id', id), 's.school_id', user).first(STUDENT_COLS);
  if (!s) throw new HttpError(404, 'This student ID is not in your school.');
  return s;
}
async function findStaff(user, id) {
  const u = await mine(staffQ().where('u.id', id), 'u.school_id', user).first('u.id', 'u.full_name', 'u.role', 'u.school_id', 'u.active', 'sc.short_name as school');
  if (!u) throw new HttpError(404, 'This staff ID is not in your school.');
  return u;
}

// What a person still holds (things that come back and are not yet returned).
async function holding(kind, id) {
  const rows = await db('issue_lines as l').join('issues as i', 'i.id', 'l.issue_id').whereNotNull('l.copy_id').whereNull('l.returned')
    .where(kind === 'student' ? 'i.student_id' : 'i.staff_id', id).orderBy('i.at')
    .select('l.id', 'l.item_name', 'l.copy_id', 'i.number', 'i.at');
  return rows.map((r) => ({ lineId: r.id, item: r.item_name, copyId: r.copy_id, code: codeFor('copy', r.copy_id), issue: r.number, at: r.at }));
}

// ---------- Items as the stores see them ----------
async function storeItems(store, f = {}) {
  const q = db('items as i').where('i.active', true);
  if (f.id) q.where('i.id', f.id);
  if (f.q) q.whereILike('i.name', `%${clean(f.q, 60)}%`);
  if (f.category && CATEGORIES.includes(f.category)) q.where('i.category', f.category);
  const items = await q.orderBy('i.category').orderBy('i.name').limit(1000);
  const ids = items.map((i) => i.id);
  const [levels, codes, copies] = await Promise.all([
    store === undefined ? [] : inStore(db('stock_levels').whereIn('item_id', ids), 'school_id', store).select('item_id', 'qty', 'reorder_level'),
    db('item_barcodes').whereIn('item_id', ids).orderBy('added_at').select('item_id', 'code'),
    store === undefined ? [] : inStore(db('item_copies').whereIn('item_id', ids), 'school_id', store).groupBy('item_id', 'status').select('item_id', 'status', db.raw('count(*)::int as n')),
  ]);
  const L = Object.fromEntries(levels.map((l) => [l.item_id, l]));
  return items.map((i) => {
    const c = Object.fromEntries(copies.filter((x) => x.item_id === i.id).map((x) => [x.status, x.n]));
    return { id: i.id, name: i.name, category: i.category, categoryLabel: CATEGORY_LABEL[i.category], unit: i.unit, returnable: i.returnable, sellable: i.sellable,
      code: codeFor('item', i.id), barcodes: codes.filter((x) => x.item_id === i.id).map((x) => x.code),
      qty: L[i.id]?.qty ?? 0, reorder: L[i.id]?.reorder_level ?? 0, pieces: { in: c.in || 0, out: c.out || 0, damaged: c.damaged || 0, lost: c.lost || 0 } };
  });
}

router.get('/items', anyPage('issue', 'labels', 'purchases', 'counts', 'stockin', 'useitems'), async (req, res) => {
  const store = storeOf(req.user, req.query.school);
  res.json({ items: await storeItems(store, req.query), store: store === undefined ? null : { id: store, name: await storeName(store) },
    categories: CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABEL[c] })), units: UNITS,
    canAdd: STORE_ITEM_MAKERS.includes(req.user.role), canIssue: ISSUERS.includes(req.user.role) });
});

// A thing the school buys and uses but does not sell (laboratory instruments, food, text books to lend).
router.post('/items', anyPage('purchases', 'items', 'useitems'), async (req, res) => {
  if (!STORE_ITEM_MAKERS.includes(req.user.role)) throw new HttpError(403, 'The store-keeper adds these.');
  const b = req.body || {};
  const name = clean(b.name, 80).toUpperCase();
  const category = String(b.category || '');
  const unit = String(b.unit || 'pc');
  if (name.length < 2) throw new HttpError(400, 'Type the item name.');
  if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Choose a category.');
  if (!UNITS.includes(unit)) throw new HttpError(400, 'Choose how it is counted (piece, kg, bag ...).');
  const dup = await db('items').whereRaw('lower(name) = ?', [name.toLowerCase()]).first();
  if (dup) throw new HttpError(409, `There is already an item called "${dup.name}".`);
  const id = await db.transaction(async (trx) => {
    const [row] = await trx('items').insert({ name, category, unit, returnable: !!b.returnable, sellable: false, created_by: req.user.id }).returning('id');
    await audit(req, 'store.item', `Added ${name} (${CATEGORY_LABEL[category]}, counted in ${unit}${b.returnable ? ', comes back after use: every piece gets its own barcode' : ''}). Not for sale`,
      { detail: { itemId: row.id } }, trx);
    return row.id;
  });
  res.status(201).json({ item: (await storeItems(storeOf(req.user), { id }))[0] });
});

// How an item is counted, and whether it comes back after use.
router.patch('/items/:id', anyPage('purchases', 'items', 'useitems'), async (req, res) => {
  if (!STORE_ITEM_MAKERS.includes(req.user.role)) throw new HttpError(403, 'The store-keeper changes this.');
  const item = await db('items').where({ id: Number(req.params.id) || 0 }).first();
  if (!item) throw new HttpError(404, 'Item not found.');
  const b = req.body || {};
  const up = {};
  if (b.unit !== undefined) { if (!UNITS.includes(b.unit)) throw new HttpError(400, 'Choose how it is counted.'); if (b.unit !== item.unit) up.unit = b.unit; }
  if (b.returnable !== undefined && !!b.returnable !== item.returnable) {
    if (!b.returnable && await db('item_copies').where({ item_id: item.id }).first()) throw new HttpError(409, `${item.name} already has pieces with their own barcodes. It stays "comes back".`);
    if (b.returnable && await db('issue_lines').where({ item_id: item.id }).first()) throw new HttpError(409, `${item.name} was already given out by quantity. Make a new item for the pieces that come back.`);
    up.returnable = !!b.returnable;
  }
  if (Object.keys(up).length) {
    await db.transaction(async (trx) => {
      await trx('items').where({ id: item.id }).update({ ...up, updated_at: trx.fn.now() });
      await audit(req, 'store.item', `${item.name}: ${[up.unit && `counted in ${up.unit}`, up.returnable !== undefined && (up.returnable ? 'comes back after use (a barcode for every piece)' : 'does not come back')].filter(Boolean).join(', ')}`,
        { detail: { itemId: item.id } }, trx);
    });
  }
  res.json({ item: (await storeItems(storeOf(req.user), { id: item.id }))[0] });
});

// The maker's own barcode on the packet, so the same scan works without printing a label.
router.post('/items/:id/barcodes', requirePage('labels', 'f'), async (req, res) => {
  const item = await db('items').where({ id: Number(req.params.id) || 0 }).first();
  if (!item) throw new HttpError(404, 'Item not found.');
  const p = parseCode(req.body?.code);
  if (!p) throw new HttpError(400, 'Scan or type the barcode on the packet (4 to 40 letters or numbers).');
  if (p.type !== 'barcode') throw new HttpError(400, 'This is one of the system\'s own codes. Scan the barcode printed by the maker.');
  const used = await db('item_barcodes as b').join('items as i', 'i.id', 'b.item_id').where('b.code', p.code).first('i.name', 'i.id');
  if (used) throw new HttpError(409, used.id === item.id ? 'This barcode is already saved for this item.' : `This barcode already belongs to ${used.name}.`);
  await db.transaction(async (trx) => {
    await trx('item_barcodes').insert({ code: p.code, item_id: item.id, added_by: req.user.id });
    await audit(req, 'store.barcode', `Barcode ${p.code} now means ${item.name}`, { schoolId: req.user.school_id, detail: { itemId: item.id } }, trx);
  });
  res.status(201).json({ item: (await storeItems(storeOf(req.user), { id: item.id }))[0] });
});

// ---------- Pieces (one barcode each) ----------
const copyOut = (c) => ({ id: c.id, code: codeFor('copy', c.id), itemId: c.item_id, item: c.item, status: c.status, schoolId: c.school_id, store: c.school || 'Main store',
  note: c.note, holder: c.to_name ? { name: c.to_name, detail: c.to_detail, since: c.issued_at, issue: c.issue_no } : null });
const copiesQ = () => db('item_copies as c').join('items as i', 'i.id', 'c.item_id').leftJoin('schools as s', 's.id', 'c.school_id')
  .leftJoin('issue_lines as l', 'l.id', 'c.issue_line_id').leftJoin('issues as x', 'x.id', 'l.issue_id')
  .select('c.*', 'i.name as item', 's.short_name as school', 'x.to_name', 'x.to_detail', 'x.at as issued_at', 'x.number as issue_no');

router.get('/copies', anyPage('issue', 'labels'), async (req, res) => {
  const store = storeOf(req.user, req.query.school);
  const q = inStore(copiesQ(), 'c.school_id', store);
  if (req.query.item) q.where('c.item_id', Number(req.query.item) || 0);
  if (req.query.delivery) q.whereIn('c.delivery_line_id', db('delivery_lines').where({ delivery_id: Number(req.query.delivery) || 0 }).select('id'));
  if (['coming', 'in', 'out', 'damaged', 'lost'].includes(req.query.status)) q.where('c.status', req.query.status);
  res.json({ copies: (await q.orderBy('c.id', 'desc').limit(2000)).map(copyOut) });
});

// Register pieces: the system makes one code for each. Never more pieces than the stock of the store.
router.post('/copies', requirePage('labels', 'f'), issuer, async (req, res) => {
  const store = storeOf(req.user);
  const count = Number(req.body?.count);
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new HttpError(400, 'Type how many pieces need a barcode (1 to 500).');
  const made = await db.transaction(async (trx) => {
    const item = await trx('items').where({ id: Number(req.body?.itemId) || 0, active: true }).forUpdate().first();
    if (!item) throw new HttpError(404, 'Item not found.');
    if (!item.returnable) throw new HttpError(400, `${item.name} does not come back after use, so it has one barcode for all pieces. Print the item label instead.`);
    const level = await inStore(trx('stock_levels').where({ item_id: item.id }), 'school_id', store).first();
    const have = Number((await inStore(trx('item_copies').where({ item_id: item.id, status: 'in' }), 'school_id', store).count('* as n'))[0].n);
    const free = (level?.qty || 0) - have;
    if (count > free) throw new HttpError(409, `${item.name}: the stock here is ${level?.qty || 0} and ${have} already have a barcode, so only ${Math.max(0, free)} more can get one. Receive the stock first.`);
    const rows = await trx('item_copies').insert(Array.from({ length: count }, () => ({ item_id: item.id, school_id: store, created_by: req.user.id }))).returning('id');
    await audit(req, 'store.copies', `${plural(count, 'piece')} of ${item.name} got their own barcode (${codeFor('copy', rows[0].id)} to ${codeFor('copy', rows[rows.length - 1].id)})`,
      { schoolId: store, detail: { itemId: item.id } }, trx);
    return { item, ids: rows.map((r) => r.id) };
  });
  res.status(201).json({ copies: made.ids.map((id) => ({ id, code: codeFor('copy', id), item: made.item.name, itemId: made.item.id })) });
});

// ---------- ID cards ----------
router.get('/cards', requirePage('labels'), async (req, res) => {
  const all = allSchools(req.user);
  const school = all ? Number(req.query.school) || null : req.user.school_id;
  const kind = req.query.kind === 'staff' ? 'staff' : 'student';
  const admin = kind === 'staff' && all && !school; // administration staff (no school)
  if (kind === 'student' && !school) throw new HttpError(400, 'Choose a school first (top of the page).');
  const cards = await require('./idcards').listCards(kind, { school, admin, classId: Number(req.query.classId) || null });
  res.json({ cards, canIssue: CARD_ISSUERS.includes(req.user.role) });
});

// ---------- Scan ----------
async function resolve(user, raw) {
  const p = parseCode(raw);
  if (!p) throw new HttpError(400, 'This is not a barcode the system knows. Scan again.');
  const store = storeOf(user);
  const card = async (kind, id) => (await require('./idcards').states(kind, [id]))[codeFor(kind, id)] || null;
  if (p.type === 'student') { const s = await findStudent(user, p.id); return { ...studentOut(s), card: await card('student', s.id), holding: await holding('student', s.id) }; }
  if (p.type === 'staff') { const u = await findStaff(user, p.id); return { ...staffOut(u), card: await card('staff', u.id), holding: await holding('staff', u.id) }; }
  if (p.type === 'copy') {
    const c = await mine(copiesQ().where('c.id', p.id), 'c.school_id', user).first();
    if (!c) throw new HttpError(404, 'This piece is not in your store.');
    return { type: 'copy', ...copyOut(c), here: store === undefined || c.school_id === store };
  }
  let itemId = p.id;
  if (p.type === 'barcode') {
    const b = await db('item_barcodes').where({ code: p.code }).first();
    if (!b) throw new HttpError(404, `Barcode ${p.code} is not known yet. Save it for its item on "Barcodes & ID cards" first.`);
    itemId = b.item_id;
  }
  const [item] = await storeItems(store, { id: itemId });
  if (!item) throw new HttpError(404, 'This item is not in the list (or is no longer used).');
  return { type: 'item', ...item };
}
router.get('/scan', anyPage('issue', 'labels'), async (req, res) => res.json({ found: await resolve(req.user, req.query.code) }));

// Find a person by name when the ID card is not at hand.
router.get('/people', anyPage('issue', 'labels'), async (req, res) => {
  const words = clean(req.query.q, 60).toLowerCase().split(' ').filter(Boolean).slice(0, 4);
  if (!words.length) return res.json({ people: [] });
  const sq = mine(studentsQ().where('s.status', 'active'), 's.school_id', req.user);
  const uq = mine(staffQ().where('u.active', true), 'u.school_id', req.user);
  for (const w of words) {
    sq.where((x) => x.whereRaw('lower(s.full_name) like ?', [`%${w}%`]).orWhereRaw('lower(s.admission_no) = ?', [w]));
    uq.whereRaw('lower(u.full_name) like ?', [`%${w}%`]);
  }
  const [students, staff] = await Promise.all([
    req.query.kind === 'staff' ? [] : sq.orderBy('s.full_name').limit(8).select(STUDENT_COLS),
    req.query.kind === 'student' ? [] : uq.orderBy('u.full_name').limit(8).select('u.id', 'u.full_name', 'u.role', 'u.school_id', 'u.active', 'sc.short_name as school'),
  ]);
  res.json({ people: [...students.map(studentOut), ...staff.map(staffOut)] });
});

// ---------- Issue: give out by scanning ----------
router.post('/issues', requirePage('issue', 'f'), issuer, async (req, res) => {
  const b = req.body || {};
  const store = storeOf(req.user);
  const key = /^[\w-]{8,40}$/.test(b.key || '') ? b.key : null;
  if (key) {
    const done = await db('issues').where({ client_key: key, issued_by: req.user.id }).first('id');
    if (done) return res.json({ issue: await oneIssue(req.user, done.id), repeated: true });
  }
  const toKind = String(b.toKind || '');
  let person = null, toName, toDetail;
  if (toKind === 'student') {
    person = await findStudent(req.user, Number(b.studentId) || 0);
    if (person.status !== 'active') throw new HttpError(400, `${person.full_name} is marked as left school.`);
    toName = person.full_name; toDetail = [classLabel(person), allSchools(req.user) ? person.school : null].filter(Boolean).join(' · ') || null;
  } else if (toKind === 'staff') {
    person = await findStaff(req.user, Number(b.staffId) || 0);
    if (!person.active) throw new HttpError(400, `The account of ${person.full_name} is switched off.`);
    toName = person.full_name; toDetail = [ROLES[person.role]?.label, person.school].filter(Boolean).join(' · ');
  } else if (toKind === 'dept') {
    toName = clean(b.toName, 120).toUpperCase(); toDetail = clean(b.toDetail, 80) || null;
    if (toName.length < 3) throw new HttpError(400, 'Type where it goes (e.g. KITCHEN, STAFF ROOM, OFFICE).');
  } else throw new HttpError(400, 'Scan the ID of the person who receives, or choose a place.');
  const note = clean(b.note, 200) || null;

  const copyIds = new Set(), want = new Map();
  for (const l of Array.isArray(b.lines) ? b.lines : []) {
    if (l?.copyId != null) { const id = Number(l.copyId); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'A scanned piece is not right. Scan again.'); copyIds.add(id); continue; }
    const id = Number(l?.itemId), qty = Number(l?.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 100000) throw new HttpError(400, 'Each item needs a whole quantity from 1 to 100,000.');
    want.set(id, (want.get(id) || 0) + qty);
  }
  if (!copyIds.size && !want.size) throw new HttpError(400, 'Scan at least one thing to give out.');
  if (copyIds.size + want.size > 100) throw new HttpError(400, 'Too many things on one paper (more than 100). Save this one and start another.');
  if (copyIds.size && toKind === 'dept') throw new HttpError(400, 'Things that come back are given to a person: scan the student or staff ID.');

  let id;
  try {
    id = await db.transaction(async (trx) => {
      const lines = [];
      if (want.size) {
        const items = await trx('items').whereIn('id', [...want.keys()]).where({ active: true });
        if (items.length !== want.size) throw new HttpError(400, 'One of the items is not in the list. Scan again.');
        for (const i of items) {
          if (i.returnable) throw new HttpError(400, `${i.name} comes back after use: scan the barcode of the piece itself (MC…), not the item.`);
          lines.push({ item_id: i.id, item_name: i.name, unit: i.unit, qty: want.get(i.id), copy_id: null });
        }
      }
      if (copyIds.size) {
        const copies = await trx('item_copies as c').join('items as i', 'i.id', 'c.item_id').whereIn('c.id', [...copyIds]).forUpdate('c').select('c.*', 'i.name as item', 'i.unit');
        if (copies.length !== copyIds.size) throw new HttpError(400, 'One of the scanned pieces is not known. Scan again.');
        for (const c of copies) {
          if (c.school_id !== store) throw new HttpError(409, `${codeFor('copy', c.id)} (${c.item}) is not in your store.`);
          if (c.status !== 'in') throw new HttpError(409, `${codeFor('copy', c.id)} (${c.item}) is ${c.status === 'out' ? 'already given out: scan it back in first' : c.status}.`);
          lines.push({ item_id: c.item_id, item_name: c.item, unit: c.unit, qty: 1, copy_id: c.id });
        }
      }
      // The number is made from the id, and an issue is never changed after it is written (database guard),
      // so the id is taken first and the row is written once, complete.
      const { rows: [{ id: iid }] } = await trx.raw(`SELECT nextval(pg_get_serial_sequence('issues', 'id'))::int AS id`);
      const number = stock.paperNo('ISS', iid);
      await trx('issues').insert({ id: iid, number, school_id: store, to_kind: toKind, student_id: toKind === 'student' ? person.id : null,
        staff_id: toKind === 'staff' ? person.id : null, to_name: toName, to_detail: toDetail, note, client_key: key, issued_by: req.user.id });
      const saved = await trx('issue_lines').insert(lines.map((l) => ({ ...l, issue_id: iid }))).returning(['id', 'copy_id']);
      for (const l of saved) if (l.copy_id) await trx('item_copies').where({ id: l.copy_id }).update({ status: 'out', issue_line_id: l.id });
      // Stock goes down, item by item. Not enough recorded = the whole issue is refused.
      const perItem = new Map();
      for (const l of lines) perItem.set(l.item_id, { name: l.item_name, qty: (perItem.get(l.item_id)?.qty || 0) + l.qty });
      const low = [];
      for (const [itemId, x] of perItem) {
        const m = await stock.move(trx, { schoolId: store, itemId, itemName: x.name, change: -x.qty, kind: 'issue', ref: number, refId: iid, note: `To ${toName}`, by: req.user.id });
        if (m.low) low.push(`${x.name} (${m.after} left, reorder at ${m.reorder})`);
      }
      const what = [...perItem.values()].map((x) => `${x.qty} × ${x.name}`).join(', ');
      // The parents' app will tell the parents what their child received.
      if (toKind === 'student') await require('../lib/parents').notice(trx, { studentId: person.id, schoolId: person.school_id, kind: 'issued', ref: number,
        title: 'Received from the library', body: `${person.full_name} received ${what} from the library (${number}).` });
      await audit(req, 'issue.create', `${number}: gave ${what} to ${toName}${toDetail ? ` (${toDetail})` : ''} from the library`,
        { schoolId: store, detail: { issueId: iid, userId: toKind === 'staff' ? person.id : undefined } }, trx);
      if (low.length) await audit(req, 'stock.low', `Low stock at the library: ${low.join(', ')}`, { schoolId: store }, trx);
      return iid;
    });
  } catch (e) {
    if (e.code === '23505' && key) { // the same issue arrived twice at the same moment
      const done = await db('issues').where({ client_key: key }).first('id');
      if (done) return res.json({ issue: await oneIssue(req.user, done.id), repeated: true });
    }
    throw e;
  }
  res.status(201).json({ issue: await oneIssue(req.user, id) });
});

// ---------- Issues: lists ----------
const RETURNED = { good: 'Returned', damaged: 'Returned damaged', lost: 'Lost' };
function issuesQ(user, f = {}) {
  const store = storeOf(user, f.school);
  const q = inStore(db('issues as i').join('users as u', 'u.id', 'i.issued_by').leftJoin('schools as s', 's.id', 'i.school_id'), 'i.school_id', store);
  if (f.q) { const w = `%${clean(f.q, 60)}%`; q.where((x) => x.whereILike('i.to_name', w).orWhereILike('i.number', w)); }
  if (isDate(f.from)) q.whereRaw(`(i.at AT TIME ZONE '${TZ}')::date >= ?`, [f.from]);
  if (isDate(f.to)) q.whereRaw(`(i.at AT TIME ZONE '${TZ}')::date <= ?`, [f.to]);
  return q.select('i.*', 'u.full_name as by_name', 's.short_name as school', 's.code');
}
async function withIssueLines(rows) {
  const lines = rows.length ? await db('issue_lines as l').leftJoin('users as u', 'u.id', 'l.returned_to').whereIn('l.issue_id', rows.map((r) => r.id)).orderBy('l.id')
    .select('l.*', 'u.full_name as returned_to_name') : [];
  return rows.map((i) => {
    const ls = lines.filter((l) => l.issue_id === i.id).map((l) => ({ id: l.id, itemId: l.item_id, item: l.item_name, unit: l.unit, qty: l.qty,
      copyId: l.copy_id, code: l.copy_id ? codeFor('copy', l.copy_id) : null, comesBack: !!l.copy_id, returned: l.returned, returnedLabel: RETURNED[l.returned] || null,
      returnedAt: l.returned_at, returnedTo: l.returned_to_name, returnNote: l.return_note }));
    return { id: i.id, number: i.number, at: i.at, schoolId: i.school_id, store: i.school || 'Main store', code: i.code || null, toKind: i.to_kind, toName: i.to_name, toDetail: i.to_detail,
      studentId: i.student_id, staffId: i.staff_id, note: i.note, by: i.by_name, lines: ls, out: ls.filter((l) => l.comesBack && !l.returned).length };
  });
}
async function oneIssue(user, id) {
  const row = await issuesQ(user).where('i.id', Number(id) || 0).first();
  if (!row) throw new HttpError(404, 'Issue not found.');
  return (await withIssueLines([row]))[0];
}

router.get('/issues', requirePage('issue'), async (req, res) => {
  const q = issuesQ(req.user, req.query);
  if (req.query.open) q.whereExists(db('issue_lines as l').whereRaw('l.issue_id = i.id').whereNotNull('l.copy_id').whereNull('l.returned'));
  const rows = await q.orderBy('i.id', 'desc').limit(200);
  const store = storeOf(req.user, req.query.school);
  const outQ = inStore(db('item_copies').where({ status: 'out' }), 'school_id', store).count('* as n');
  const todayQ = inStore(db('issues'), 'school_id', store).whereRaw(`(at AT TIME ZONE '${TZ}')::date = (now() AT TIME ZONE '${TZ}')::date`).count('* as n');
  const [[o], [t]] = await Promise.all([outQ, todayQ]);
  res.json({ issues: await withIssueLines(rows), outNow: Number(o.n), today: Number(t.n), canIssue: ISSUERS.includes(req.user.role) });
});

router.get('/issues/export.xlsx', requirePage('issue'), async (req, res) => {
  const rows = await withIssueLines(await issuesQ(req.user, req.query).orderBy('i.id', 'desc').limit(20000));
  const flat = rows.flatMap((i) => i.lines.map((l) => ({ number: i.number, at: new Date(i.at), store: i.store, to: i.toName, detail: i.toDetail || '', item: l.item, code: l.code || '',
    qty: l.qty, unit: l.unit, state: l.comesBack ? (l.returnedLabel || 'Still out') : 'Used (does not come back)', back: l.returnedAt ? new Date(l.returnedAt) : null, by: i.by, note: l.returnNote || i.note || '' })));
  await sendExcel(res, 'musabe-issued', [{ name: 'Issued', title: 'Musabe Schools: things given out (not sold)',
    columns: [{ header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'No.', key: 'number', width: 11 }, { header: 'Date', key: 'at', type: 'date', width: 19 }, { header: 'Store', key: 'store', width: 16 },
      { header: 'Given to', key: 'to', width: 28 }, { header: 'Class / role / place', key: 'detail', width: 24 }, { header: 'Item', key: 'item', width: 28 }, { header: 'Piece barcode', key: 'code', width: 14 },
      { header: 'Qty', key: 'qty', type: 'int', width: 8 }, { header: 'Unit', key: 'unit', width: 8 }, { header: 'State', key: 'state', width: 22 }, { header: 'Returned on', key: 'back', type: 'date', width: 19 },
      { header: 'Given by', key: 'by', width: 22 }, { header: 'Note', key: 'note', width: 30 }],
    rows: flat.map((r, i) => ({ sn: i + 1, ...r })) }]);
});

router.get('/issues/:id', requirePage('issue'), async (req, res) => res.json({ issue: await oneIssue(req.user, req.params.id) }));

// ---------- Return: scan the piece back in ----------
router.post('/returns', requirePage('issue', 'f'), issuer, async (req, res) => {
  const b = req.body || {};
  const store = storeOf(req.user);
  const condition = String(b.condition || 'good');
  const note = clean(b.note, 200) || null;
  if (!RETURNED[condition]) throw new HttpError(400, 'Choose: good, damaged or lost.');
  if (condition !== 'good' && !note) throw new HttpError(400, 'Write what happened (e.g. "cover torn", "student says it was stolen").');
  const out = await db.transaction(async (trx) => {
    const c = await trx('item_copies').where({ id: Number(b.copyId) || 0 }).forUpdate().first();
    if (!c || c.school_id !== store) throw new HttpError(404, 'This piece is not in your store.');
    const item = await trx('items').where({ id: c.item_id }).first();
    const code = codeFor('copy', c.id);
    if (c.status !== 'out') throw new HttpError(409, `${code} (${item.name}) is not out: it is ${c.status === 'in' ? 'already in the store' : c.status}.`);
    const line = await trx('issue_lines').where({ id: c.issue_line_id }).first();
    const issue = await trx('issues').where({ id: line.issue_id }).first();
    await trx('issue_lines').where({ id: line.id }).update({ returned: condition, returned_at: trx.fn.now(), returned_to: req.user.id, return_note: note });
    await trx('item_copies').where({ id: c.id }).update({ status: condition === 'good' ? 'in' : condition, issue_line_id: null, note: condition === 'good' ? c.note : note });
    if (issue.student_id) await require('../lib/parents').notice(trx, { studentId: issue.student_id, schoolId: issue.school_id, kind: 'returned', ref: issue.number,
      title: condition === 'good' ? 'Returned to the library' : condition === 'lost' ? 'Reported lost' : 'Returned damaged',
      body: `${issue.to_name}: ${item.name} (${code}) ${condition === 'good' ? 'was returned to the library' : condition === 'lost' ? 'is recorded as lost' : 'came back damaged'}${note ? `: ${note}` : ''}.` });
    if (condition === 'good') {
      await stock.move(trx, { schoolId: store, itemId: c.item_id, itemName: item.name, change: 1, kind: 'return', ref: issue.number, refId: issue.id, note: `From ${issue.to_name}`, by: req.user.id });
      await audit(req, 'issue.return', `${code} (${item.name}) returned by ${issue.to_name} (${issue.number})`, { schoolId: store, detail: { issueId: issue.id } }, trx);
    } else {
      await audit(req, 'issue.return_bad', `${code} (${item.name}) given to ${issue.to_name} on ${issue.number} ${condition === 'lost' ? 'is lost' : 'came back damaged'}: ${note}. It is out of the stock`,
        { schoolId: store, detail: { issueId: issue.id } }, trx);
    }
    return { code, item: item.name, from: issue.to_name, detail: issue.to_detail, issue: issue.number, condition };
  });
  res.json({ returned: out });
});

// ---------- Stock history of a library ----------
const KIND = { in: 'Received', give: 'Given to parent', damage: 'Damaged / lost', buy: 'Bought', send: 'Sent to a library', issue: 'Issued', return: 'Returned', count: 'Weekly check correction' };
router.get('/moves', anyPage('counts'), async (req, res) => {
  const store = storeOf(req.user, req.query.school);
  const q = inStore(db('stock_moves as m').join('items as i', 'i.id', 'm.item_id').leftJoin('users as u', 'u.id', 'm.by'), 'm.school_id', store);
  if (req.query.item) q.where('m.item_id', Number(req.query.item) || 0);
  const rows = await q.orderBy('m.id', 'desc').limit(300).select('m.*', 'i.name as item', 'i.unit', 'u.full_name as by_name');
  res.json({ moves: rows.map((m) => ({ id: Number(m.id), at: m.at, item: m.item, unit: m.unit, kind: m.kind, kindLabel: KIND[m.kind], change: m.change, balance: m.balance, ref: m.ref, note: m.note, by: m.by_name })) });
});


// ---------- Items the school uses (not sold): Excel upload ----------
// Columns: Item, Category, Unit, Comes back (Yes / No). New names are added; names already in the list are left as they are.
// A file with any mistake saves nothing, and the mistakes are shown with their row numbers.
router.get('/items/template.xlsx', anyPage('purchases', 'items', 'useitems'), async (_req, res) => {
  await sendExcel(res, 'musabe-items-to-issue-template', [{ name: 'Items to issue', title: 'Musabe Schools: items the schools use (not sold)',
    columns: [{ header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'Item', key: 'item', width: 34 }, { header: 'Category', key: 'category', width: 16 },
      { header: 'Unit', key: 'unit', width: 10 }, { header: 'Comes back', key: 'back', width: 12 }],
    rows: [{ sn: 1, item: 'ENGLISH STD 5 (TIE)', category: 'Book', unit: 'pc', back: 'Yes' }, { sn: 2, item: 'PAPER REAM A4', category: 'Stationery', unit: 'ream', back: 'No' }] }]);
});

router.post('/items/import', anyPage('purchases', 'items', 'useitems'), uploadLimit, express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
  if (!STORE_ITEM_MAKERS.includes(req.user.role)) throw new HttpError(403, 'The store-keeper adds these.');
  const rows = await readExcel(req.body, 'item');
  if (rows.length > 2000) throw new HttpError(400, 'At most 2000 rows in one file.');
  const have = new Map((await db('items').select('id', 'name')).map((i) => [i.name.toLowerCase(), i]));
  const byLabel = Object.fromEntries(CATEGORIES.map((c) => [CATEGORY_LABEL[c].toLowerCase(), c]).concat(CATEGORIES.map((c) => [c, c])));
  const add = [], same = [], mistakes = [], seen = new Set();
  for (const r of rows) {
    const name = clean(r.item, 80).toUpperCase();
    if (!name) continue;
    const category = byLabel[String(r.category || '').trim().toLowerCase().replace(/\s+/g, '_')] || byLabel[String(r.category || '').trim().toLowerCase()];
    const unitRaw = String(r.unit || 'pc').trim().toLowerCase();
    const unit = { pcs: 'pc', piece: 'pc', pieces: 'pc', reams: 'ream', boxes: 'box', bags: 'bag', litres: 'litre', liters: 'litre', liter: 'litre', pairs: 'pair', sets: 'set' }[unitRaw] || unitRaw;
    const back = /^(y|yes|ndiyo|1|true)$/i.test(String(r['comes back'] ?? r.returnable ?? '').trim());
    if (name.length < 2) mistakes.push(`Row ${r._row}: the item name is too short.`);
    else if (!category) mistakes.push(`Row ${r._row}: ${name}: category must be one of ${CATEGORIES.map((c) => CATEGORY_LABEL[c]).join(', ')}.`);
    else if (!UNITS.includes(unit)) mistakes.push(`Row ${r._row}: ${name}: unit must be one of ${UNITS.join(', ')}.`);
    else if (seen.has(name)) mistakes.push(`Row ${r._row}: ${name} is written twice in the file.`);
    else if (have.has(name.toLowerCase())) { same.push(name); seen.add(name); }
    else { add.push({ name, category, unit, returnable: back, sellable: false, created_by: req.user.id }); seen.add(name); }
  }
  if (mistakes.length) return res.status(400).json({ error: `Nothing was saved: ${mistakes.length} mistake${mistakes.length === 1 ? '' : 's'} in the file.`, mistakes: mistakes.slice(0, 100) });
  if (add.length) {
    await db.transaction(async (trx) => {
      await trx('items').insert(add);
      await audit(req, 'store.item', `Added ${add.length} item${add.length === 1 ? '' : 's'} (not for sale) from Excel: ${add.slice(0, 8).map((i) => i.name).join(', ')}${add.length > 8 ? ' …' : ''}`, {}, trx);
    });
  }
  res.json({ added: add.length, already: same.length, alreadyNames: same.slice(0, 50) });
});

// ---------- QR labels for a delivery (the store-keeper sticks them on before the goods go) ----------
// Things that come back: one label per piece (its own code). Other things: the item code, one label per piece.
router.get('/delivery-labels/:id', anyPage('purchases', 'stockin', 'incoming', 'labels'), async (req, res) => {
  const d = await db('deliveries as d').join('schools as s', 's.id', 'd.school_id').where('d.id', Number(req.params.id) || 0).first('d.*', 's.short_name as school');
  if (!d || (!allSchools(req.user) && d.school_id !== req.user.school_id)) throw new HttpError(404, 'Delivery not found.');
  const lines = await db('delivery_lines as l').join('items as i', 'i.id', 'l.item_id').where('l.delivery_id', d.id).orderBy('l.id').select('l.*', 'i.unit', 'i.returnable');
  const copies = await db('item_copies').whereIn('delivery_line_id', lines.map((l) => l.id)).orderBy('id').select('id', 'delivery_line_id', 'status');
  const COUNTED = ['pc', 'pair', 'set', 'ream', 'box', 'packet', 'bottle', 'tin', 'roll', 'dozen'];
  res.json({ number: d.number, school: d.school, lines: lines.map((l) => ({
    item: l.item_name, unit: l.unit, qty: l.qty, returnable: l.returnable,
    labels: l.returnable ? copies.filter((c) => c.delivery_line_id === l.id).map((c) => ({ code: codeFor('copy', c.id), status: c.status }))
      : [{ code: codeFor('item', l.item_id), count: COUNTED.includes(l.unit) ? l.qty : 1 }],
  })) });
});

module.exports = router;
module.exports.storeOf = storeOf;
module.exports.inStore = inStore;
module.exports.storeName = storeName;
module.exports.storeItems = storeItems;
module.exports.UNITS = UNITS;
