// Weekly stock check and the weekly ledger.
// - The librarian counts what is really in the school library (there is no main store), every week,
//   also for things that stay for months (rice, beans, oil). The screen does not show what the system expects.
// - The Accountant or the Assistant Accountant confirms the check. Differences then correct the stock ("count" move)
//   and stay in the history. Rejected = nothing changes (count again).
// - Ledger: for any week and store: opening, received, given out, corrections, closing, counted, difference.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES, ISSUERS, PURCHASE_CONFIRMERS } = require('../auth/roles');
const { sendExcel } = require('../lib/excel');
const stock = require('../lib/stock');
const { storeOf, inStore, storeName } = require('./store');
const { CATEGORIES, CATEGORY_LABEL } = require('./items');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const STATUS = { pending: 'Waiting for the accountant', confirmed: 'Confirmed', rejected: 'Rejected' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
// Monday of the week of a date (YYYY-MM-DD).
function monday(d) {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
// Administration chooses the school (there is no main store).
const viewStore = (user, wanted) => storeOf(user, wanted);

function list(user, f = {}) {
  const store = viewStore(user, f.school);
  const q = inStore(db('stock_counts as c').join('users as u', 'u.id', 'c.counted_by').leftJoin('users as d', 'd.id', 'c.decided_by').leftJoin('schools as s', 's.id', 'c.school_id'), 'c.school_id', store);
  if (f.status && STATUS[f.status]) q.where('c.status', f.status);
  return q.select('c.*', db.raw('c.week_start::text as week'), 'u.full_name as by_name', 'd.full_name as decided_by_name', 's.short_name as school', 's.code');
}
async function withLines(rows, user) {
  const lines = rows.length ? await db('stock_count_lines').whereIn('count_id', rows.map((r) => r.id)).orderBy('item_name') : [];
  return rows.map((c) => {
    const ls = lines.filter((l) => l.count_id === c.id).map((l) => ({ id: l.id, itemId: l.item_id, item: l.item_name, unit: l.unit, system: l.system_qty, counted: l.counted_qty,
      diff: l.counted_qty - l.system_qty, note: l.note }));
    // The keeper does not see what the system expected until the check is decided.
    const blind = c.status === 'pending' && c.counted_by === user.id;
    return { id: c.id, number: c.number, schoolId: c.school_id, store: c.school || 'Main store', code: c.code || null, category: c.category, categoryLabel: c.category ? CATEGORY_LABEL[c.category] : 'Everything',
      week: c.week, note: c.note, status: c.status, statusLabel: STATUS[c.status], by: c.by_name, countedAt: c.counted_at, decidedBy: c.decided_by_name, decidedAt: c.decided_at, decisionNote: c.decision_note,
      canDecide: c.status === 'pending' && PURCHASE_CONFIRMERS.includes(user.role) && c.counted_by !== user.id,
      items: ls.length, differences: blind ? null : ls.filter((l) => l.diff !== 0).length,
      lines: blind ? ls.map((l) => ({ ...l, system: null, diff: null })) : ls };
  });
}
const one = async (user, id) => {
  const c = await list(user, { school: undefined }).where('c.id', Number(id) || 0).first();
  if (!c) throw new HttpError(404, 'Stock check not found.');
  return (await withLines([c], user))[0];
};

router.get('/', requirePage('counts'), async (req, res) => {
  const rows = await list(req.user, req.query).orderByRaw("c.status = 'pending' desc").orderBy('c.id', 'desc').limit(200);
  const mine = ISSUERS.includes(req.user.role);
  let doneThisWeek = null;
  if (mine) doneThisWeek = !!(await inStore(db('stock_counts').where({ week_start: monday(today()) }).whereNot({ status: 'rejected' }), 'school_id', storeOf(req.user)).first());
  res.json({ counts: await withLines(rows, req.user), canCount: mine, canDecide: PURCHASE_CONFIRMERS.includes(req.user.role), doneThisWeek, week: monday(today()),
    categories: CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABEL[c] })) });
});

// What to count: every item this store holds or ever held (no expected numbers: the keeper counts first).
router.get('/sheet', requirePage('counts', 'f'), async (req, res) => {
  if (!ISSUERS.includes(req.user.role)) throw new HttpError(403, 'The keeper of the store counts.');
  const store = storeOf(req.user);
  const q = inStore(db('stock_levels as l').join('items as i', 'i.id', 'l.item_id'), 'l.school_id', store);
  if (CATEGORIES.includes(req.query.category)) q.where('i.category', req.query.category);
  const rows = await q.orderBy('i.category').orderBy('i.name').select('i.id', 'i.name', 'i.unit', 'i.category');
  res.json({ items: rows.map((i) => ({ id: i.id, name: i.name, unit: i.unit, category: i.category, categoryLabel: CATEGORY_LABEL[i.category] })), store: await storeName(store), week: monday(today()) });
});

router.post('/', requirePage('counts', 'f'), async (req, res) => {
  if (!ISSUERS.includes(req.user.role)) throw new HttpError(403, 'The keeper of the store counts. The accountant office confirms.');
  const b = req.body || {};
  const store = storeOf(req.user);
  const category = CATEGORIES.includes(b.category) ? b.category : null;
  const got = new Map();
  for (const l of Array.isArray(b.lines) ? b.lines : []) {
    const id = Number(l?.itemId), n = Number(l?.counted);
    if (!Number.isInteger(id) || !Number.isInteger(n) || n < 0 || n > 10000000) throw new HttpError(400, 'Type what you counted for every item (a whole number, 0 if there is none).');
    got.set(id, { n, note: clean(l?.note, 200) || null });
  }
  if (!got.size) throw new HttpError(400, 'Count at least one item.');
  if (got.size > 1000) throw new HttpError(400, 'Too many items on one check. Count one category at a time.');
  const id = await db.transaction(async (trx) => {
    // One check at a time for the same things: two waiting checks would correct the stock twice.
    const open = await inStore(trx('stock_counts').where({ status: 'pending' }), 'school_id', store)
      .modify((q) => { if (category) q.where((w) => w.whereNull('category').orWhere('category', category)); }).first();
    if (open) throw new HttpError(409, `${open.number} is still waiting for the accountant office. It must be confirmed or rejected before a new check.`);
    const items = await trx('items').whereIn('id', [...got.keys()]).modify((q) => { if (category) q.where({ category }); });
    if (items.length !== got.size) throw new HttpError(400, 'One of the items is not in this list. Reload the page.');
    const levels = await inStore(trx('stock_levels').whereIn('item_id', [...got.keys()]), 'school_id', store).forUpdate();
    const L = Object.fromEntries(levels.map((l) => [l.item_id, l.qty]));
    const { rows: [{ id: cid }] } = await trx.raw(`SELECT nextval(pg_get_serial_sequence('stock_counts', 'id'))::int AS id`);
    const number = stock.paperNo('CNT', cid);
    await trx('stock_counts').insert({ id: cid, number, school_id: store, category, week_start: monday(today()), note: clean(b.note, 300) || null, counted_by: req.user.id });
    await trx('stock_count_lines').insert(items.map((i) => ({ count_id: cid, item_id: i.id, item_name: i.name, unit: i.unit, system_qty: L[i.id] || 0, counted_qty: got.get(i.id).n, note: got.get(i.id).note })));
    await audit(req, 'count.create', `${number}: weekly check of ${category ? CATEGORY_LABEL[category].toLowerCase() : 'everything'} at ${await storeName(store)} (${items.length} items). Waiting for the accountant office`,
      { schoolId: store, detail: { countId: cid } }, trx);
    return cid;
  });
  res.status(201).json({ count: await one(req.user, id) });
});

router.post('/:id/decide', requirePage('counts', 'f'), async (req, res) => {
  if (!PURCHASE_CONFIRMERS.includes(req.user.role)) throw new HttpError(403, 'Only the Accountant or the Assistant Accountant confirms a stock check.');
  const approve = req.body?.approve === true;
  const note = clean(req.body?.note, 300) || null;
  if (!approve && !note) throw new HttpError(400, 'Write why it is rejected, so the keeper counts again.');
  await db.transaction(async (trx) => {
    const c = await trx('stock_counts').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!c) throw new HttpError(404, 'Stock check not found.');
    if (c.status !== 'pending') throw new HttpError(409, `${c.number} was already ${c.status}.`);
    if (c.counted_by === req.user.id) throw new HttpError(403, 'Nobody confirms their own check.');
    const diffs = [];
    if (approve) {
      for (const l of await trx('stock_count_lines').where({ count_id: c.id }).orderBy('id')) {
        const d = l.counted_qty - l.system_qty;
        if (!d) continue;
        if (d !== 0 && !note) throw new HttpError(400, 'The count is different from the system. Write a note about the difference before confirming.');
        await stock.move(trx, { schoolId: c.school_id, itemId: l.item_id, itemName: l.item_name, change: d, kind: 'count', ref: c.number, refId: c.id, note: l.note || note, by: req.user.id });
        diffs.push(`${l.item_name} ${d > 0 ? '+' : ''}${d} ${l.unit}`);
      }
    }
    await trx('stock_counts').where({ id: c.id }).update({ status: approve ? 'confirmed' : 'rejected', decided_by: req.user.id, decided_at: trx.fn.now(), decision_note: note });
    await audit(req, approve ? 'count.confirm' : 'count.reject',
      `${c.number} ${approve ? 'confirmed' : 'rejected'}${approve ? (diffs.length ? `. Stock corrected: ${diffs.join(', ')}` : '. Everything agrees with the system') : ''}${note ? ` (${note})` : ''}`,
      { schoolId: c.school_id, detail: { countId: c.id, userId: c.counted_by } }, trx);
  });
  res.json({ count: await one(req.user, req.params.id) });
});

// ---------- Weekly ledger ----------
async function ledger(user, f = {}) {
  const store = viewStore(user, f.school);
  if (store == null) throw new HttpError(400, 'Choose a school.');
  const week = monday(isDate(f.week) ? f.week : today());
  const end = addDays(week, 7);
  const DAY = `(m.at AT TIME ZONE '${TZ}')::date`;
  const sn = store === null ? 'l.school_id IS NULL' : 'l.school_id = :store';
  const sm = store === null ? 'm.school_id IS NULL' : 'm.school_id = :store';
  const { rows } = await db.raw(`
    SELECT i.id, i.name, i.unit, i.category, coalesce(max(l.qty), 0)::int AS now,
      coalesce(sum(m.change) FILTER (WHERE ${DAY} >= :end), 0)::int AS after,
      coalesce(sum(m.change) FILTER (WHERE ${DAY} >= :week AND ${DAY} < :end AND m.kind <> 'count' AND m.change > 0), 0)::int AS received,
      coalesce(-sum(m.change) FILTER (WHERE ${DAY} >= :week AND ${DAY} < :end AND m.kind <> 'count' AND m.change < 0), 0)::int AS issued,
      coalesce(sum(m.change) FILTER (WHERE ${DAY} >= :week AND ${DAY} < :end AND m.kind = 'count'), 0)::int AS corrected,
      count(m.id)::int AS moves
    FROM items i
    LEFT JOIN stock_levels l ON l.item_id = i.id AND ${sn}
    LEFT JOIN stock_moves m ON m.item_id = i.id AND ${sm}
    ${CATEGORIES.includes(f.category) ? 'WHERE i.category = :category' : ''}
    GROUP BY i.id HAVING max(l.qty) IS NOT NULL OR count(m.id) > 0
    ORDER BY i.category, i.name`, { store, week, end, category: f.category || null });
  // What the keeper counted in that week (the last check that was not rejected).
  const counted = await inStore(db('stock_count_lines as cl').join('stock_counts as c', 'c.id', 'cl.count_id').where('c.week_start', week).whereNot('c.status', 'rejected'), 'c.school_id', store)
    .orderBy('c.id').select('cl.item_id', 'cl.counted_qty', 'cl.system_qty', 'c.number', 'c.status');
  const C = Object.fromEntries(counted.map((c) => [c.item_id, c]));
  const out = rows.map((r) => {
    const closing = r.now - r.after;
    const c = C[r.id];
    return { itemId: r.id, item: r.name, unit: r.unit, category: r.category, categoryLabel: CATEGORY_LABEL[r.category], opening: closing - r.received + r.issued - r.corrected,
      received: r.received, issued: r.issued, corrected: r.corrected, closing, counted: c ? c.counted_qty : null, difference: c ? c.counted_qty - c.system_qty : null,
      check: c ? c.number : null, checkStatus: c ? STATUS[c.status] : 'Not counted' };
  });
  return { rows: out, week, to: addDays(week, 6), store: await storeName(store), notCounted: out.filter((r) => r.counted == null && (r.closing > 0 || r.opening > 0)).length };
}

router.get('/ledger', requirePage('counts'), async (req, res) => res.json(await ledger(req.user, req.query)));

router.get('/ledger.xlsx', requirePage('counts'), async (req, res) => {
  const d = await ledger(req.user, req.query);
  await sendExcel(res, `musabe-weekly-ledger-${d.week}`, [{ name: 'Weekly ledger', title: `Musabe Schools: stock ledger of ${d.store}, week ${d.week} to ${d.to}`,
    columns: [{ header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'Item', key: 'item', width: 30 }, { header: 'Category', key: 'categoryLabel', width: 14 }, { header: 'Unit', key: 'unit', width: 8 },
      { header: 'Opening', key: 'opening', type: 'int', width: 10 }, { header: 'Received', key: 'received', type: 'int', width: 10 }, { header: 'Given out', key: 'issued', type: 'int', width: 10 },
      { header: 'Corrections', key: 'corrected', type: 'int', width: 12 }, { header: 'Closing', key: 'closing', type: 'int', width: 10 }, { header: 'Counted', key: 'counted', type: 'int', width: 10 },
      { header: 'Difference', key: 'difference', type: 'int', width: 11 }, { header: 'Check', key: 'check', width: 11 }, { header: 'Check status', key: 'checkStatus', width: 26 }],
    rows: d.rows.map((r, i) => ({ sn: i + 1, ...r })) }]);
});

router.get('/:id', requirePage('counts'), async (req, res) => res.json({ count: await one(req.user, req.params.id) }));

module.exports = router;
