// Library items and prices.
// Finance Manager adds and changes items and prices. Others with access can look.
// School staff (bursar, librarian, head master) only see their own school's prices.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES } = require('../auth/roles');
const { publish } = require('../realtime');
const { sendExcel, readExcel } = require('../lib/excel');

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = ['uniform', 'book', 'exercise_book', 'stationery', 'other']; // same list as migration 004
const LABEL = { uniform: 'Uniform', book: 'Book', exercise_book: 'Exercise book', stationery: 'Stationery', other: 'Other' };
const money = (n) => `TSh ${Number(n).toLocaleString('en-GB')}`;
const allSchools = (u) => ROLES[u.role]?.scope === 'all';

// "36,000" / "36000" / 36000 -> 36000. Empty -> null.
function amount(v, what) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  if (!Number.isInteger(n) || n <= 0 || n > 10000000) throw new HttpError(400, `${what}: type a whole amount in shillings, e.g. 36000.`);
  return n;
}

const priceOf = (p) => (p ? { price: p.price, boys: p.price_boys, girls: p.price_girls } : null);
const describe = (p) => (!p ? 'not sold' : p.price != null ? money(p.price) : [p.boys != null && `boys ${money(p.boys)}`, p.girls != null && `girls ${money(p.girls)}`].filter(Boolean).join(', '));

async function list(user, { q, category, status, id } = {}) {
  let query = db('items as i').select('i.*');
  if (id) query = query.where('i.id', id);
  if (q) query = query.whereILike('i.name', `%${q}%`);
  if (category) query = query.where('i.category', category);
  if (status === 'archived') query = query.where('i.active', false);
  else if (status !== 'all') query = query.where('i.active', true);
  const items = await query.orderBy('i.category').orderBy('i.name');
  let prices = await db('item_prices').whereIn('item_id', items.map((i) => i.id));
  if (!allSchools(user)) prices = prices.filter((p) => p.school_id === user.school_id);
  const by = {};
  for (const p of prices) (by[p.item_id] ||= {})[p.school_id] = priceOf(p);
  return items
    .filter((i) => allSchools(user) || by[i.id]) // school staff: only items sold in their school
    .map((i) => ({
      id: i.id, name: i.name, category: i.category, categoryLabel: LABEL[i.category],
      genderPriced: i.gender_priced, active: i.active, updatedAt: i.updated_at, prices: by[i.id] || {},
    }));
}

router.get('/', requirePage('items'), async (req, res) => {
  const { q, category, status } = req.query;
  res.json({ items: await list(req.user, { q: q && String(q).trim(), category, status }), categories: CATEGORIES.map((c) => ({ key: c, label: LABEL[c] })) });
});

// Read and check the form. Returns the item fields and the price for each school (null = not sold there).
async function readBody(b, existing) {
  const name = String(b.name ?? existing?.name ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  const category = String(b.category ?? existing?.category ?? '');
  const genderPriced = b.genderPriced !== undefined ? !!b.genderPriced : !!existing?.gender_priced;
  if (name.length < 2) throw new HttpError(400, 'Type the item name.');
  if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Choose a category.');
  const dup = await db('items').whereRaw('lower(name) = ?', [name.toLowerCase()]).modify((q) => existing && q.whereNot('id', existing.id)).first();
  if (dup) throw new HttpError(409, `There is already an item called "${dup.name}".`);

  const schools = await db('schools').where({ active: true }).orderBy('id');
  const input = b.prices && typeof b.prices === 'object' ? b.prices : null;
  const prices = {};
  for (const s of schools) {
    const p = input ? input[s.id] : undefined;
    if (p === undefined) continue; // not sent = leave as it is
    if (p === null || p.sold === false) { prices[s.id] = null; continue; }
    if (!genderPriced) {
      prices[s.id] = { price: amount(p.price, s.short_name), price_boys: null, price_girls: null };
      if (prices[s.id].price == null) throw new HttpError(400, `${s.short_name}: type the price, or untick "Sold here".`);
    } else {
      const boys = s.students === 'girls' ? null : amount(p.boys, `${s.short_name} boys price`);
      const girls = s.students === 'boys' ? null : amount(p.girls, `${s.short_name} girls price`);
      if (s.students !== 'girls' && boys == null) throw new HttpError(400, `${s.short_name}: type the price for boys.`);
      if (s.students !== 'boys' && girls == null) throw new HttpError(400, `${s.short_name}: type the price for girls.`);
      prices[s.id] = { price: null, price_boys: boys, price_girls: girls };
    }
  }
  return { fields: { name, category, gender_priced: genderPriced }, prices, schools };
}

// Save prices for each school and keep a record of every change.
async function savePrices(trx, itemId, prices, userId, genderChanged) {
  const current = Object.fromEntries((await trx('item_prices').where({ item_id: itemId })).map((p) => [p.school_id, p]));
  const changes = [];
  const ids = new Set([...Object.keys(prices).map(Number), ...(genderChanged ? Object.keys(current).map(Number) : [])]);
  for (const schoolId of ids) {
    const before = current[schoolId] || null;
    let after = prices[schoolId];
    if (after === undefined) after = null; // gender switch with no new price for this school: stop selling until priced
    const same = before && after && before.price === after.price && before.price_boys === after.price_boys && before.price_girls === after.price_girls;
    if (same || (!before && !after)) continue;
    if (after) {
      await trx('item_prices').insert({ item_id: itemId, school_id: schoolId, ...after, updated_at: trx.fn.now(), updated_by: userId })
        .onConflict(['item_id', 'school_id']).merge();
    } else {
      await trx('item_prices').where({ item_id: itemId, school_id: schoolId }).del();
    }
    const o = priceOf(before), n = after && { price: after.price, boys: after.price_boys, girls: after.price_girls };
    await trx('item_price_changes').insert({ item_id: itemId, school_id: schoolId, old_price: o && JSON.stringify(o), new_price: n && JSON.stringify(n), changed_by: userId });
    changes.push({ schoolId, from: describe(o), to: describe(n) });
  }
  return changes;
}

// School staff screens refresh too when an item of their school changes.
const tellSchools = (ids, trx) => [...new Set(ids.map(Number))].forEach((schoolId) => publish({ topics: ['item'], schoolId }, trx));

const nameOf = (schools, id) => schools.find((s) => s.id === Number(id))?.short_name || `school ${id}`;

router.post('/', requirePage('items', 'f'), async (req, res) => {
  const { fields, prices, schools } = await readBody(req.body || {});
  const id = await db.transaction(async (trx) => {
    const [{ id: newId }] = await trx('items').insert({ ...fields, created_by: req.user.id }).returning('id');
    const changes = await savePrices(trx, newId, prices, req.user.id, false);
    const where = changes.length ? changes.map((c) => `${nameOf(schools, c.schoolId)} ${c.to}`).join('; ') : 'not sold anywhere yet';
    await audit(req, 'item.create', `Added item ${fields.name} (${where})`, { detail: { itemId: newId } }, trx);
    tellSchools(changes.map((c) => c.schoolId), trx);
    return newId;
  });
  res.status(201).json({ item: (await list(req.user, { id, status: 'all' }))[0] });
});

router.patch('/:id', requirePage('items', 'f'), async (req, res) => {
  const item = await db('items').where({ id: Number(req.params.id) }).first();
  if (!item) throw new HttpError(404, 'Item not found.');
  const { fields, prices, schools } = await readBody(req.body || {}, item);
  await db.transaction(async (trx) => {
    const edits = [];
    if (fields.name !== item.name) edits.push(`renamed from ${item.name}`);
    if (fields.category !== item.category) edits.push(`category ${LABEL[fields.category]}`);
    const genderChanged = fields.gender_priced !== item.gender_priced;
    if (genderChanged) edits.push(fields.gender_priced ? 'now priced by gender' : 'same price for boys and girls');
    if (edits.length) await trx('items').where({ id: item.id }).update({ ...fields, updated_at: trx.fn.now() });
    const changes = await savePrices(trx, item.id, prices, req.user.id, genderChanged);
    for (const c of changes) {
      await audit(req, 'item.price', `Price of ${fields.name} at ${nameOf(schools, c.schoolId)}: ${c.from} → ${c.to}`,
        { schoolId: c.schoolId, detail: { itemId: item.id } }, trx);
    }
    if (edits.length) {
      await audit(req, 'item.update', `Changed item ${fields.name}: ${edits.join(', ')}`, { detail: { itemId: item.id } }, trx);
      tellSchools((await trx('item_prices').where({ item_id: item.id }).pluck('school_id')), trx);
    }
  });
  res.json({ item: (await list(req.user, { id: item.id, status: 'all' }))[0] });
});

// Stop selling everywhere (kept for history) or sell again.
router.post('/:id/active', requirePage('items', 'f'), async (req, res) => {
  const item = await db('items').where({ id: Number(req.params.id) }).first();
  if (!item) throw new HttpError(404, 'Item not found.');
  const active = !!req.body?.active;
  if (active !== item.active) {
    await db.transaction(async (trx) => {
      await trx('items').where({ id: item.id }).update({ active, updated_at: trx.fn.now() });
      await audit(req, active ? 'item.restore' : 'item.archive', active ? `Started selling ${item.name} again` : `Stopped selling ${item.name}`, { detail: { itemId: item.id } }, trx);
      tellSchools(await trx('item_prices').where({ item_id: item.id }).pluck('school_id'), trx);
    });
  }
  res.json({ item: (await list(req.user, { id: item.id, status: 'all' }))[0] });
});

router.get('/:id/history', requirePage('items'), async (req, res) => {
  const rows = await db('item_price_changes as c')
    .join('schools as s', 's.id', 'c.school_id')
    .leftJoin('users as u', 'u.id', 'c.changed_by')
    .where('c.item_id', Number(req.params.id))
    .modify((q) => { if (!allSchools(req.user)) q.where('c.school_id', req.user.school_id); })
    .orderBy('c.at', 'desc').limit(100)
    .select('c.id', 'c.at', 's.short_name as school', 's.code as school_code', 'c.old_price', 'c.new_price', 'u.full_name as by');
  res.json({ changes: rows.map((r) => ({ id: r.id, at: r.at, school: r.school, schoolCode: r.school_code, from: describe(r.old_price), to: describe(r.new_price), by: r.by || 'System setup' })) });
});

// ---------- Excel ----------
// Download the price list (what the person may see). One row per item per school.
async function priceRows(user) {
  const schools = (await db('schools').where({ active: true }).orderBy('id')).filter((s) => allSchools(user) || s.id === user.school_id);
  const items = await list(user, { status: 'all' });
  const rows = [];
  for (const i of items) {
    for (const s of schools) {
      const p = i.prices[s.id];
      rows.push({ item: i.name, category: LABEL[i.category], school: s.short_name, gender: i.genderPriced ? 'Yes' : 'No',
        price: p?.price ?? null, boys: p?.boys ?? null, girls: p?.girls ?? null, sold: p ? 'Yes' : 'No', status: i.active ? 'On sale' : 'Stopped' });
    }
  }
  return rows;
}
// S/N: 1, 2, 3 ... down the sheet.
const numbered = (rows) => rows.map((r, i) => ({ sn: i + 1, ...r }));
const PRICE_COLUMNS = [
  { header: 'S/N', key: 'sn', type: 'int', width: 6 },
  { header: 'Item', key: 'item', width: 28 }, { header: 'Category', key: 'category', width: 16 },
  { header: 'School', key: 'school', width: 18 }, { header: 'Price by gender', key: 'gender', width: 15 },
  { header: 'Price', key: 'price', type: 'money', width: 12 }, { header: 'Boys price', key: 'boys', type: 'money', width: 12 },
  { header: 'Girls price', key: 'girls', type: 'money', width: 12 },
];

router.get('/export.xlsx', requirePage('items'), async (req, res) => {
  await sendExcel(res, 'musabe-items-prices', [{
    name: 'Items & prices', title: 'Musabe Schools: items and prices (TSh)',
    columns: [...PRICE_COLUMNS, { header: 'Sold here', key: 'sold', width: 10 }, { header: 'Status', key: 'status', width: 10 }],
    rows: numbered(await priceRows(req.user)),
  }]);
});

// Template for upload: today's list, ready to change and add to.
router.get('/template.xlsx', requirePage('itemsupload', 'f'), async (req, res) => {
  const cats = CATEGORIES.map((c) => LABEL[c]).join(', ');
  await sendExcel(res, 'musabe-items-template', [{
    name: 'Items & prices', title: 'Musabe Schools: items and prices. Change prices or add new rows, then upload.',
    columns: PRICE_COLUMNS,
    rows: numbered((await priceRows(req.user)).filter((r) => r.status === 'On sale')),
    notes: [
      'One row for each item in each school. Prices in TSh, numbers only (e.g. 36000).',
      `Category: ${cats}.`,
      'Price by gender = No: fill "Price". Price by gender = Yes: fill "Boys price" and/or "Girls price".',
      'Leave all prices empty for a school that does not sell the item. Rows not in the file are not changed.',
    ],
  }]);
});

// Sample: a filled example that shows how to arrange the file. It cannot be uploaded (the import refuses it).
const SAMPLE_ROWS = [
  { item: 'SWEATER', category: 'Uniform', school: 'English Medium', gender: 'No', price: 21000, why: 'One price for everyone: fill "Price" only.' },
  { item: 'SWEATER', category: 'Uniform', school: 'Boys Secondary', gender: 'No', price: 25000, why: 'Same item, another school: a new row with that school\'s price.' },
  { item: 'SWEATER', category: 'Uniform', school: 'Girls Secondary', gender: 'No', price: 25000, why: 'One row for each school that sells the item.' },
  { item: 'SPECIAL UNIFORM', category: 'Uniform', school: 'English Medium', gender: 'Yes', boys: 36000, girls: 41000, why: 'Price by gender = Yes: fill "Boys price" and "Girls price". Leave "Price" empty.' },
  { item: 'SPECIAL UNIFORM', category: 'Uniform', school: 'Boys Secondary', gender: 'Yes', why: 'All prices empty: Boys Secondary does not sell this item.' },
  { item: 'BOX FILE', category: 'Stationery', school: 'Boys Secondary', gender: 'No', price: 5000, why: 'Stationery item.' },
  { item: 'BOX FILE', category: 'Stationery', school: 'Girls Secondary', gender: 'No', price: 4000, why: 'Prices can differ between schools.' },
  { item: 'COUNTER BOOK (QUIRE 3)', category: 'Exercise book', school: 'Boys Secondary', gender: 'No', price: 4000, why: 'Price for ONE book, not for 15. Numbers only, no "TSh" or "/=".' },
  { item: 'MATHEMATICAL SET', category: 'Stationery', school: 'Girls Secondary', gender: 'No', price: 5000, why: 'A new item name is added as a new item.' },
  { item: 'BLANKET', category: 'Other', school: 'English Medium', gender: 'No', price: 30000, why: 'Category "Other" for things that are not uniform, books or stationery.' },
];

router.get('/sample.xlsx', requirePage('items'), async (req, res) => {
  const cats = CATEGORIES.map((c) => LABEL[c]).join(', ');
  const schools = (await db('schools').where({ active: true }).orderBy('id')).map((s) => s.short_name).join(', ');
  await sendExcel(res, 'musabe-items-SAMPLE', [{
    name: 'SAMPLE - how to arrange',
    title: 'SAMPLE ONLY: this shows how to arrange your file. Do not upload it. Use "Download template" for your real items.',
    columns: [...PRICE_COLUMNS, { header: 'What this row shows (not needed in your file)', key: 'why', width: 70 }],
    rows: numbered(SAMPLE_ROWS),
    notes: [
      'Your file needs one header row with these columns: S/N, Item, Category, School, Price by gender, Price, Boys price, Girls price.',
      'S/N: just the row number (1, 2, 3 ...). It helps you count rows; the system does not need it and does not save it.',
      'The header row can be anywhere near the top. Extra columns (like "What this row shows") are ignored.',
      '',
      'Item: the item name, e.g. SWEATER. The same name on many rows = the same item in different schools. Names are saved in CAPITAL letters.',
      `Category: one of ${cats}.`,
      `School: one of ${schools}.`,
      'Price by gender: No = one price for everyone. Yes = a boys price and a girls price. Use the same answer on every row of one item.',
      'Price: fill only when "Price by gender" is No.',
      'Boys price / Girls price: fill only when "Price by gender" is Yes. Boys Secondary needs only the boys price, Girls Secondary only the girls price, English Medium needs both.',
      'Prices: whole shillings, numbers only, e.g. 25000 or 25,000. No "TSh", no "/=". The price is for ONE piece (e.g. one exercise book).',
      'Leave all prices empty when a school does not sell the item.',
      'Each item can appear only once for each school.',
      '',
      'Steps: 1) Download the template (it has today\'s items). 2) Change prices or add rows like this sample. 3) Upload it. 4) A review page opens: check the rows by school; mistakes are shown in red with the row number. 5) Press Approve.',
      'Rows you leave out of the file are not changed. Nothing reaches the items list until you approve it.',
      'One school only: put only that school\'s rows. All three schools: put a row for each item in each school.',
    ],
  }]);
});

// ---------- Upload from Excel, then check and approve ----------
// 1) Finance Manager or Assistant Finance Manager uploads a file: it is kept as "waiting" (nothing changes yet).
// 2) The review page shows every row: new items, new prices, start/stop selling, mistakes, by school.
// 3) The uploader (or the Finance Manager) approves: the file is checked again against today's prices and saved.
//    Or discards it. Rows not in the file are never changed.

// Read and check a file against today's items and prices. Changes nothing.
async function checkFile(buffer) {
  const rows = (await readExcel(buffer, 'item')).filter((r) => r.item || r.school); // a row with only an S/N is empty
  if (!rows.length) throw new HttpError(400, 'The file has no rows under the header.');
  if (rows.length > 3000) throw new HttpError(400, 'Too many rows (more than 3000).');
  const schools = await db('schools').where({ active: true });
  const findSchool = (v) => schools.find((s) => [s.short_name, s.name, s.code].some((x) => x.toLowerCase() === v.toLowerCase()));
  const catOf = (v) => CATEGORIES.find((c) => c === v.toLowerCase().replace(/\s+/g, '_') || LABEL[c].toLowerCase() === v.toLowerCase());
  const yes = (v) => /^(yes|y|ndiyo|true|1)$/i.test(v);
  const existing = Object.fromEntries((await db('items')).map((i) => [i.name.toLowerCase(), i]));
  const curPrices = {};
  for (const p of await db('item_prices')) curPrices[`${p.item_id}:${p.school_id}`] = p;

  const plan = {};  // name -> { name, category, gender, item, prices: {schoolId: price|null} }
  const out = [];
  for (const r of rows) {
    if (!r.item && !r.school) continue; // a row with only an S/N number is an empty row
    const line = { row: r._row, sn: r['s/n'] || '', item: (r.item || '').toUpperCase().replace(/\s+/g, ' '), school: r.school || '', schoolId: null, category: '', isNew: false, error: null, change: '' };
    try {
      const amt = (v, what) => { try { return amount(v, what); } catch (e) { throw new Error(e.message); } };
      if (!line.item) throw new Error('Item name is empty.');
      const s = findSchool(r.school || '');
      if (!s) throw new Error(`School "${r.school || ''}" not found. Use: ${schools.map((x) => x.short_name).join(', ')}.`);
      line.school = s.short_name; line.schoolId = s.id;
      const old = existing[line.item.toLowerCase()];
      const cat = r.category ? catOf(r.category) : old?.category;
      if (!cat) throw new Error(`Category "${r.category || ''}" is not known.`);
      const gender = r['price by gender'] ? yes(r['price by gender']) : !!old?.gender_priced;
      line.category = LABEL[cat]; line.isNew = !old;
      const p = plan[line.item] ||= { name: line.item, category: cat, gender, item: old, prices: {}, rows: [] };
      if (p.gender !== gender) throw new Error('"Price by gender" must be the same on every row of this item.');
      let price = null;
      if (!gender) {
        const v = amt(r.price, 'Price');
        if (v != null) price = { price: v, price_boys: null, price_girls: null };
        if (r['boys price'] || r['girls price']) throw new Error('This item has one price. Put it in "Price", or set "Price by gender" to Yes.');
      } else {
        const b = s.students === 'girls' ? null : amt(r['boys price'], 'Boys price');
        const g = s.students === 'boys' ? null : amt(r['girls price'], 'Girls price');
        if (b != null || g != null) {
          if (s.students !== 'girls' && b == null) throw new Error(`${s.short_name} teaches boys: fill "Boys price".`);
          if (s.students !== 'boys' && g == null) throw new Error(`${s.short_name} teaches girls: fill "Girls price".`);
          price = { price: null, price_boys: b, price_girls: g };
        }
      }
      if (s.id in p.prices) throw new Error(`${line.item} for ${s.short_name} appears twice in the file.`);
      p.prices[s.id] = price;
      const before = old && curPrices[`${old.id}:${s.id}`];
      const same = before && price && before.price === price.price && before.price_boys === price.price_boys && before.price_girls === price.price_girls;
      line.from = describe(priceOf(before));
      line.to = describe(price && { price: price.price, boys: price.price_boys, girls: price.price_girls });
      line.change = !old ? (price ? 'New item' : 'No change') : same || (!before && !price) ? 'No change' : !before ? 'Start selling' : !price ? 'Stop selling here' : 'New price';
      if (old && (old.category !== cat || old.gender_priced !== gender) && line.change === 'No change') line.change = 'Item details';
    } catch (e) { line.error = e.message; }
    out.push(line);
  }
  const errors = out.filter((l) => l.error).length;
  const count = (c) => out.filter((l) => !l.error && l.change === c).length;
  const summary = {
    rows: out.length, errors, changes: out.filter((l) => !l.error && l.change !== 'No change').length,
    newItems: Object.values(plan).filter((p) => !p.item && Object.values(p.prices).some(Boolean)).length,
    newPrices: count('New price'), startSelling: count('Start selling'), stopSelling: count('Stop selling here'),
    itemDetails: count('Item details'), schools: [...new Set(out.filter((l) => l.schoolId).map((l) => l.school))],
  };
  return { rows: out, plan, summary };
}

// Save a checked plan. Returns how many items were added and prices changed.
async function applyPlan(trx, plan, req) {
  let added = 0, priced = 0;
  for (const p of Object.values(plan)) {
    let id = p.item?.id;
    if (!id && !Object.values(p.prices).some(Boolean)) continue; // new item with no price in any school: nothing to add
    if (!id) {
      [{ id }] = await trx('items').insert({ name: p.name, category: p.category, gender_priced: p.gender, created_by: req.user.id }).returning('id');
      added++;
    } else if (p.item.category !== p.category || p.item.gender_priced !== p.gender) {
      await trx('items').where({ id }).update({ category: p.category, gender_priced: p.gender, updated_at: trx.fn.now() });
    }
    const ch = await savePrices(trx, id, p.prices, req.user.id, !!p.item && p.item.gender_priced !== p.gender);
    priced += ch.length;
    tellSchools(ch.map((c) => c.schoolId), trx);
  }
  return { added, priced };
}

const IMPORT_COLS = ['m.id', 'm.file_name', 'm.status', 'm.summary', 'm.created_at', 'm.decided_at', 'm.uploaded_by',
  'u.full_name as uploaded_by_name', 'd.full_name as decided_by_name'];
const importQuery = () => db('item_imports as m').join('users as u', 'u.id', 'm.uploaded_by').leftJoin('users as d', 'd.id', 'm.decided_by');
const importOut = (m, user) => ({
  id: m.id, fileName: m.file_name, status: m.status, summary: m.summary, createdAt: m.created_at, decidedAt: m.decided_at,
  uploadedBy: m.uploaded_by_name, decidedBy: m.decided_by_name, mine: m.uploaded_by === user.id,
  canDecide: m.status === 'pending' && (m.uploaded_by === user.id || user.role === 'fm'),
});
async function getImport(req) {
  const m = await importQuery().where('m.id', Number(req.params.id)).first(IMPORT_COLS);
  if (!m) throw new HttpError(404, 'This upload was not found.');
  return m;
}
const mayDecide = (m, user) => {
  if (m.status !== 'pending') throw new HttpError(409, `This upload was already ${m.status}.`);
  if (m.uploaded_by !== user.id && user.role !== 'fm') throw new HttpError(403, 'Only the person who uploaded it, or the Finance Manager, can approve or discard it.');
};

// Upload: keep the file as waiting, and show its review page.
router.post('/imports', requirePage('itemsupload', 'f'), express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
  const { summary } = await checkFile(req.body);
  if (!summary.changes && !summary.errors) throw new HttpError(400, 'Nothing to change: every row in this file is the same as the items list today.');
  let rawName = req.get('X-File-Name') || 'items.xlsx';
  try { rawName = decodeURIComponent(rawName); } catch { /* keep as sent */ }
  const fileName = String(rawName).replace(/[^\w .()-]/g, '_').slice(0, 200);
  const [{ id }] = await db('item_imports').insert({ file_name: fileName, file: req.body, uploaded_by: req.user.id, summary: JSON.stringify(summary) }).returning('id');
  await audit(req, 'item.upload', `Uploaded ${fileName} to check (${summary.changes} change${summary.changes === 1 ? '' : 's'}, ${summary.errors} mistake${summary.errors === 1 ? '' : 's'}). Waiting for approval.`, { detail: { importId: id } });
  publish({ topics: ['itemimport'] });
  res.status(201).json({ id });
});

// Uploads waiting for approval (and the last few decided ones).
router.get('/imports', requirePage('itemsupload'), async (req, res) => {
  const pending = await importQuery().where('m.status', 'pending').orderBy('m.created_at', 'desc').select(IMPORT_COLS);
  const recent = await importQuery().whereNot('m.status', 'pending').orderBy('m.decided_at', 'desc').limit(10).select(IMPORT_COLS);
  res.json({ pending: pending.map((m) => importOut(m, req.user)), recent: recent.map((m) => importOut(m, req.user)) });
});

// Review page: check the kept file again now, so it shows what would change today.
router.get('/imports/:id', requirePage('itemsupload'), async (req, res) => {
  const m = await getImport(req);
  const out = importOut(m, req.user);
  if (m.status !== 'pending') return res.json({ upload: out, rows: [], summary: m.summary });
  const file = (await db('item_imports').where({ id: m.id }).first('file')).file;
  const { rows, summary } = await checkFile(file);
  const schools = await db('schools').where({ active: true }).orderBy('id').select('id', 'code', 'short_name');
  res.json({ upload: out, rows, summary, schools: schools.map((s) => ({ id: s.id, code: s.code, shortName: s.short_name })) });
});

router.post('/imports/:id/approve', requirePage('itemsupload', 'f'), async (req, res) => {
  const m = await getImport(req);
  mayDecide(m, req.user);
  const file = (await db('item_imports').where({ id: m.id }).first('file')).file;
  const { plan, summary } = await checkFile(file);
  if (summary.errors) throw new HttpError(400, `The file has ${summary.errors} mistake${summary.errors === 1 ? '' : 's'}. Fix them in Excel and upload it again.`);
  if (!summary.changes) throw new HttpError(400, 'Nothing to change: every row is the same as today.');
  const done = await db.transaction(async (trx) => {
    const n = await trx('item_imports').where({ id: m.id, status: 'pending' })
      .update({ status: 'approved', decided_at: trx.fn.now(), decided_by: req.user.id, summary: JSON.stringify(summary) });
    if (!n) throw new HttpError(409, 'This upload was already approved or discarded.');
    const r = await applyPlan(trx, plan, req);
    await audit(req, 'item.import', `Approved ${m.file_name}: ${r.added} new item${r.added === 1 ? '' : 's'}, ${r.priced} price change${r.priced === 1 ? '' : 's'}`, { detail: { importId: m.id } }, trx);
    publish({ topics: ['item', 'itemimport'] }, trx);
    return r;
  });
  res.json({ ok: true, ...done, changes: summary.changes });
});

router.post('/imports/:id/discard', requirePage('itemsupload', 'f'), async (req, res) => {
  const m = await getImport(req);
  mayDecide(m, req.user);
  await db('item_imports').where({ id: m.id, status: 'pending' }).update({ status: 'discarded', decided_at: db.fn.now(), decided_by: req.user.id });
  await audit(req, 'item.discard', `Discarded the upload ${m.file_name} (nothing was changed)`, { detail: { importId: m.id } });
  publish({ topics: ['itemimport'] });
  res.json({ ok: true });
});

module.exports = router;
