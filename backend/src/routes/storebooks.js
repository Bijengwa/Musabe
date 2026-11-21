// Store books (2026-11-20): the administration store-keeper's own ledgers, like the paper books.
// Folders (FOODS, CLEANING ...) -> items (MCHELE kg, SUKARI kg, UNGA bag ...) -> lines:
//   received (into the STORE, from a supplier), sent (STORE -> a place, e.g. BOYS KITCHEN), used (at a place), corrected (after counting).
// What is left is worked out from the lines, for the store and for each place. Lines are never changed or deleted.
// The store-keeper writes; leaders and the finance / accountant offices read.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { sendExcel } = require('../lib/excel');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const STORE = 'STORE';
const UNITS = ['kg', 'g', 'litre', 'bag', 'box', 'packet', 'bottle', 'tin', 'tray', 'crate', 'bunch', 'pc', 'dozen', 'roll', 'ream'];
const KINDS = { received: 'Received', sent: 'Sent to a place', used: 'Used', corrected: 'Corrected after counting' };
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const upper = (v, max) => clean(v, max).toUpperCase();
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const n3 = (v) => Math.round(Number(v) * 1000) / 1000;
const WRITERS = ['storekeeper'];
const canWrite = (u) => WRITERS.includes(u.role);

// Balance per place of one item's lines (in date order). STORE = the store itself.
function balances(lines) {
  const at = {};
  const add = (p, q) => { at[p] = n3((at[p] || 0) + q); };
  for (const l of lines) {
    const q = Number(l.qty);
    if (l.kind === 'received') add(STORE, q);
    else if (l.kind === 'sent') { add(STORE, -q); add(l.place, q); }
    else if (l.kind === 'used') add(l.place, -q);
    else if (l.kind === 'corrected') add(l.place, q);
  }
  return at;
}
const sum = (lines, kind) => n3(lines.filter((l) => l.kind === kind).reduce((s, l) => s + Number(l.qty), 0));

async function itemsOf(folderId) {
  const items = await db('store_book_items').where({ folder_id: folderId }).orderBy('name');
  const lines = items.length ? await db('store_book_entries').whereIn('item_id', items.map((i) => i.id)).orderBy('on_date').orderBy('id').select('*', db.raw('on_date::text as d')) : [];
  return items.map((i) => {
    const ls = lines.filter((l) => l.item_id === i.id);
    const at = balances(ls);
    const store = at[STORE] || 0;
    const places = Object.entries(at).filter(([p]) => p !== STORE).map(([place, qty]) => ({ place, qty }));
    return { id: i.id, name: i.name, unit: i.unit, active: i.active, reorderLevel: i.reorder_level == null ? null : Number(i.reorder_level),
      inStore: store, atPlaces: places, total: n3(store + places.reduce((s, p) => s + p.qty, 0)),
      received: sum(ls, 'received'), used: sum(ls, 'used'), low: i.reorder_level != null && store <= Number(i.reorder_level),
      lastLine: ls.length ? ls[ls.length - 1].d : null };
  });
}

router.get('/', requirePage('books'), async (req, res) => {
  const folders = await db('store_folders as f').orderBy('f.name').select('f.*',
    db.raw('(select count(*) from store_book_items i where i.folder_id = f.id and i.active)::int as items'));
  res.json({ folders: folders.map((f) => ({ id: f.id, name: f.name, note: f.note, items: f.items })), canWrite: canWrite(req.user), units: UNITS });
});

router.post('/', requirePage('books', 'f'), async (req, res) => {
  if (!canWrite(req.user)) throw new HttpError(403, 'The store-keeper makes the folders.');
  const name = upper(req.body?.name, 60);
  if (name.length < 2) throw new HttpError(400, 'Write the folder name, e.g. FOODS.');
  if (await db('store_folders').whereRaw('upper(name) = ?', [name]).first()) throw new HttpError(409, `There is already a folder ${name}.`);
  const [f] = await db('store_folders').insert({ name, note: clean(req.body?.note, 200) || null, created_by: req.user.id }).returning('*');
  await audit(req, 'book.folder', `Store books: new folder ${name}`, { detail: { folderId: f.id } });
  res.status(201).json({ folder: { id: f.id, name: f.name } });
});

router.get('/:fid', requirePage('books'), async (req, res) => {
  const f = await db('store_folders').where({ id: Number(req.params.fid) || 0 }).first();
  if (!f) throw new HttpError(404, 'Folder not found.');
  const places = await db('store_book_entries as e').join('store_book_items as i', 'i.id', 'e.item_id').where('i.folder_id', f.id).whereNot('e.place', STORE).distinct('e.place').orderBy('e.place');
  res.json({ folder: { id: f.id, name: f.name, note: f.note }, items: await itemsOf(f.id), places: places.map((p) => p.place), canWrite: canWrite(req.user), units: UNITS, kinds: KINDS });
});

router.get('/:fid/export.xlsx', requirePage('books'), async (req, res) => {
  const f = await db('store_folders').where({ id: Number(req.params.fid) || 0 }).first();
  if (!f) throw new HttpError(404, 'Folder not found.');
  const items = await itemsOf(f.id);
  const lines = await db('store_book_entries as e').join('store_book_items as i', 'i.id', 'e.item_id').leftJoin('users as u', 'u.id', 'e.by').where('i.folder_id', f.id)
    .orderBy('i.name').orderBy('e.on_date').orderBy('e.id').select('e.*', db.raw('e.on_date::text as d'), 'i.name as item', 'i.unit', 'u.full_name as by_name');
  await sendExcel(res, `store-book-${f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, [
    { name: 'What is left', columns: [{ header: 'Item', key: 'name', width: 26 }, { header: 'Unit', key: 'unit', width: 8 }, { header: 'In the store', key: 'inStore', width: 13 },
      { header: 'At places', key: 'places', width: 40 }, { header: 'Received (all)', key: 'received', width: 14 }, { header: 'Used (all)', key: 'used', width: 12 }],
    rows: items.map((i) => ({ ...i, places: i.atPlaces.map((p) => `${p.place}: ${p.qty}`).join('; ') })) },
    { name: 'All lines', columns: [{ header: 'Date', key: 'd', width: 12 }, { header: 'Item', key: 'item', width: 24 }, { header: 'What', key: 'what', width: 22 }, { header: 'Qty', key: 'qty', width: 10 },
      { header: 'Unit', key: 'unit', width: 8 }, { header: 'Place', key: 'place', width: 18 }, { header: 'From / to', key: 'party', width: 22 }, { header: 'Note', key: 'note', width: 30 }, { header: 'Written by', key: 'by_name', width: 20 }],
    rows: lines.map((l) => ({ ...l, qty: Number(l.qty), what: KINDS[l.kind] })) },
  ]);
});

router.post('/:fid/items', requirePage('books', 'f'), async (req, res) => {
  if (!canWrite(req.user)) throw new HttpError(403, 'The store-keeper adds the items.');
  const f = await db('store_folders').where({ id: Number(req.params.fid) || 0 }).first();
  if (!f) throw new HttpError(404, 'Folder not found.');
  const name = upper(req.body?.name, 80);
  const unit = String(req.body?.unit || '');
  if (name.length < 2) throw new HttpError(400, 'Write the item name, e.g. MCHELE.');
  if (!UNITS.includes(unit)) throw new HttpError(400, 'Choose how it is counted (kg, litre, bag ...).');
  const rl = req.body?.reorderLevel === '' || req.body?.reorderLevel == null ? null : Number(req.body.reorderLevel);
  if (rl !== null && !(rl >= 0)) throw new HttpError(400, 'The warning level must be a number.');
  if (await db('store_book_items').where({ folder_id: f.id }).whereRaw('upper(name) = ?', [name]).first()) throw new HttpError(409, `${name} is already in ${f.name}.`);
  const [i] = await db('store_book_items').insert({ folder_id: f.id, name, unit, reorder_level: rl, created_by: req.user.id }).returning('*');
  await audit(req, 'book.item', `Store books: ${name} (${unit}) added to ${f.name}`, { detail: { folderId: f.id, itemId: i.id } });
  res.status(201).json({ item: { id: i.id, name: i.name } });
});

router.get('/items/:iid', requirePage('books'), async (req, res) => {
  const i = await db('store_book_items as i').join('store_folders as f', 'f.id', 'i.folder_id').where('i.id', Number(req.params.iid) || 0).first('i.*', 'f.name as folder');
  if (!i) throw new HttpError(404, 'Item not found.');
  const lines = await db('store_book_entries as e').leftJoin('users as u', 'u.id', 'e.by').where('e.item_id', i.id).orderBy('e.on_date').orderBy('e.id')
    .select('e.*', db.raw('e.on_date::text as d'), 'u.full_name as by_name');
  // Running balance of the store and of the place on each line, as in a paper ledger.
  const run = {};
  const rows = lines.map((l) => {
    const one = balances([l]);
    for (const [p, q] of Object.entries(one)) run[p] = n3((run[p] || 0) + q);
    return { id: l.id, date: l.d, kind: l.kind, kindLabel: KINDS[l.kind], qty: Number(l.qty), place: l.place, party: l.party, note: l.note, by: l.by_name, at: l.at,
      storeAfter: run[STORE] || 0, placeAfter: l.place === STORE ? null : run[l.place] || 0 };
  });
  const at = balances(lines);
  res.json({ item: { id: i.id, name: i.name, unit: i.unit, folderId: i.folder_id, folder: i.folder, reorderLevel: i.reorder_level == null ? null : Number(i.reorder_level),
    inStore: at[STORE] || 0, atPlaces: Object.entries(at).filter(([p]) => p !== STORE).map(([place, qty]) => ({ place, qty })) },
  lines: rows.reverse(), canWrite: canWrite(req.user), kinds: KINDS });
});

// Write a line. kind: received | sent | used | corrected. For "corrected", send the amount COUNTED (counted) and the place.
router.post('/items/:iid/lines', requirePage('books', 'f'), async (req, res) => {
  if (!canWrite(req.user)) throw new HttpError(403, 'The store-keeper writes in the store books.');
  const b = req.body || {};
  if (!KINDS[b.kind]) throw new HttpError(400, 'Choose: received, sent to a place, used, or corrected.');
  const date = isDate(b.date) ? b.date : today();
  if (date > today()) throw new HttpError(400, 'The date cannot be in the future.');
  const place = b.kind === 'received' ? STORE : (upper(b.place, 60) || STORE);
  if (b.kind === 'sent' && place === STORE) throw new HttpError(400, 'Write the place it went to, e.g. BOYS KITCHEN.');
  const note = clean(b.note, 300) || null;
  const party = clean(b.party, 120) || null;
  await db.transaction(async (trx) => {
    const i = await trx('store_book_items').where({ id: Number(req.params.iid) || 0 }).forUpdate().first();
    if (!i) throw new HttpError(404, 'Item not found.');
    const at = balances(await trx('store_book_entries').where({ item_id: i.id }).orderBy('on_date').orderBy('id'));
    let qty;
    if (b.kind === 'corrected') {
      const counted = Number(b.counted);
      if (!(counted >= 0)) throw new HttpError(400, 'Write how much you counted.');
      if (!note) throw new HttpError(400, 'Write why it is different (a note is needed for a correction).');
      qty = n3(counted - (at[place] || 0));
      if (qty === 0) throw new HttpError(400, `The book already says ${counted} ${i.unit} at ${place}: nothing to correct.`);
    } else {
      qty = n3(Number(b.qty));
      if (!(qty > 0)) throw new HttpError(400, 'Write the amount (more than 0).');
      const from = b.kind === 'sent' ? STORE : place;
      if (['sent', 'used'].includes(b.kind) && qty > (at[from] || 0)) throw new HttpError(400, `Only ${at[from] || 0} ${i.unit} at ${from} in the book. Write what came in first, or correct the count.`);
    }
    await trx('store_book_entries').insert({ item_id: i.id, kind: b.kind, on_date: date, qty, place, party, note, by: req.user.id });
    const words = { received: `received ${qty} ${i.unit}${party ? ` from ${party}` : ''}`, sent: `sent ${qty} ${i.unit} to ${place}`, used: `${qty} ${i.unit} used at ${place}`,
      corrected: `corrected at ${place} by ${qty > 0 ? '+' : ''}${qty} ${i.unit} (${note})` };
    await audit(req, 'book.line', `Store books, ${i.name}: ${words[b.kind]}`, { detail: { itemId: i.id } }, trx);
  });
  res.status(201).json({ ok: true });
});

module.exports = router;
