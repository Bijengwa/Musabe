// Suppliers, their price lists / proforma invoices, and what we owe them (2026-11-21).
// - Procurement (Assistant Manager, store-keeper) keeps the supplier list and enters each price list or proforma invoice:
//   a photo (or PDF) of the hard copy the supplier gave, and the prices typed, so a requisition can show where its prices come from.
// - Payment terms are agreed with each supplier (cash, weekly, monthly...). Goods bought on credit make a debt; the accountant
//   office (or the Finance Manager) records each payment made to the supplier. Debt = credit goods received - payments.
// Nothing is deleted.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { sendExcel } = require('../lib/excel');
const { uploadLimit } = require('../lib/guard');
const stock = require('../lib/stock');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const TERMS = { cash: 'Cash', weekly: 'Weekly', monthly: 'Monthly', other: 'Other (see note)' };
const KIND = { pricelist: 'Price list', proforma: 'Proforma invoice' };
const PROCUREMENT = ['amanager', 'storekeeper'];
const PAYERS = ['acc', 'aacc', 'fm'];
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const money = (n) => `TSh ${Number(n).toLocaleString('en-GB')}`;
const whole = (v, what, max = 1000000000) => {
  const n = Number(String(v ?? '').replace(/[,\s]/g, ''));
  if (!Number.isInteger(n) || n < 0 || n > max) throw new HttpError(400, `${what} must be a whole number of shillings.`);
  return n;
};
function phoneOf(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (!/^0[67]\d{8}$/.test(d)) throw new HttpError(400, 'Phone must be 10 digits starting with 06 or 07.');
  return d;
}

// What each supplier is owed: credit goods received (counted by Mapokezi, not rejected) minus payments.
const owedSql = `
  coalesce((SELECT sum(coalesce(l.confirmed_qty, l.qty) * l.unit_cost) FROM purchases p JOIN purchase_lines l ON l.purchase_id = p.id
    WHERE p.supplier_id = s.id AND p.on_credit AND p.status IN ('checked','confirmed')), 0)::bigint AS credit,
  coalesce((SELECT sum(amount) FROM supplier_payments sp WHERE sp.supplier_id = s.id), 0)::bigint AS paid,
  (SELECT count(*) FROM price_lists pl WHERE pl.supplier_id = s.id)::int AS lists,
  (SELECT max(p.bought_on)::text FROM purchases p WHERE p.supplier_id = s.id) AS last_bought`;
const supOut = (s) => ({ id: s.id, name: s.name, phone: s.phone, tin: s.tin, place: s.place, terms: s.terms, termsLabel: TERMS[s.terms], termsNote: s.terms_note,
  active: s.active, credit: Number(s.credit || 0), paid: Number(s.paid || 0), owed: Number(s.credit || 0) - Number(s.paid || 0), priceLists: s.lists || 0, lastBought: s.last_bought || null });

router.get('/', requirePage('suppliers'), async (req, res) => {
  const q = db('suppliers as s').select('s.*', db.raw(owedSql)).orderBy('s.name');
  if (req.query.all !== '1') q.where('s.active', true);
  if (req.query.q) q.whereILike('s.name', `%${clean(req.query.q, 60)}%`);
  const rows = (await q).map(supOut);
  res.json({ suppliers: rows, owed: rows.reduce((t, s) => t + Math.max(s.owed, 0), 0), terms: TERMS,
    canEdit: PROCUREMENT.includes(req.user.role) || ['fm', 'manager'].includes(req.user.role), canPay: PAYERS.includes(req.user.role), canAddList: PROCUREMENT.includes(req.user.role) || req.user.role === 'aacc' });
});

router.get('/export.xlsx', requirePage('suppliers'), async (req, res) => {
  const rows = (await db('suppliers as s').select('s.*', db.raw(owedSql)).orderBy('s.name')).map(supOut);
  await sendExcel(res, 'musabe-suppliers', [{ name: 'Suppliers', title: 'Musabe Schools: suppliers and what we owe them', columns: [
    { header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'Supplier', key: 'name', width: 30 }, { header: 'Phone', key: 'phone', width: 13 }, { header: 'TIN', key: 'tin', width: 14 },
    { header: 'Place', key: 'place', width: 20 }, { header: 'Terms', key: 'termsLabel', width: 12 }, { header: 'Bought on credit', key: 'credit', type: 'money', width: 15 },
    { header: 'Paid', key: 'paid', type: 'money', width: 14 }, { header: 'Owed now', key: 'owed', type: 'money', width: 14 }, { header: 'Last bought', key: 'lastBought', width: 12 }],
  rows: rows.map((r, i) => ({ ...r, sn: i + 1 })) }]);
});

function readSupplier(b) {
  const name = clean(b.name, 120).toUpperCase();
  if (name.length < 3) throw new HttpError(400, 'Type the supplier name.');
  const terms = TERMS[b.terms] ? b.terms : 'cash';
  return { name, phone: phoneOf(b.phone), tin: clean(b.tin, 20) || null, place: clean(b.place, 120) || null, terms, terms_note: clean(b.termsNote, 200) || null };
}
const canEdit = (u) => PROCUREMENT.includes(u.role) || ['fm', 'manager'].includes(u.role);

router.post('/', requirePage('suppliers', 'f'), async (req, res) => {
  if (!canEdit(req.user)) throw new HttpError(403, 'The Assistant Manager or the store-keeper adds suppliers.');
  const s = readSupplier(req.body || {});
  if (await db('suppliers').whereRaw('lower(name) = lower(?)', [s.name]).first()) throw new HttpError(409, `${s.name} is already in the list.`);
  const [row] = await db('suppliers').insert({ ...s, created_by: req.user.id }).returning('*');
  await audit(req, 'supplier.create', `New supplier ${s.name} (${TERMS[s.terms]}${s.terms_note ? `: ${s.terms_note}` : ''})`, { detail: { supplierId: row.id } });
  res.status(201).json({ supplier: supOut(row) });
});

router.patch('/:id', requirePage('suppliers', 'f'), async (req, res) => {
  if (!canEdit(req.user)) throw new HttpError(403, 'The Assistant Manager or the store-keeper changes suppliers.');
  const old = await db('suppliers').where({ id: Number(req.params.id) || 0 }).first();
  if (!old) throw new HttpError(404, 'Supplier not found.');
  const b = req.body || {};
  const s = readSupplier({ name: old.name, phone: old.phone, tin: old.tin, place: old.place, terms: old.terms, termsNote: old.terms_note, ...b });
  if (await db('suppliers').whereRaw('lower(name) = lower(?)', [s.name]).whereNot('id', old.id).first()) throw new HttpError(409, `${s.name} is already in the list.`);
  const active = b.active === undefined ? old.active : !!b.active;
  await db('suppliers').where({ id: old.id }).update({ ...s, active, updated_at: db.fn.now() });
  const what = [old.terms !== s.terms && `terms ${TERMS[old.terms]} → ${TERMS[s.terms]}`, old.active !== active && (active ? 'switched on' : 'switched off'), old.name !== s.name && `renamed to ${s.name}`].filter(Boolean);
  await audit(req, 'supplier.update', `Supplier ${old.name}: ${what.join(', ') || 'details changed'}`, { detail: { supplierId: old.id } });
  res.json({ supplier: supOut(await db('suppliers as s').where('s.id', old.id).select('s.*', db.raw(owedSql)).first()) });
});

// ---------- Price lists / proforma invoices ----------
const plOut = (p) => ({ id: p.id, number: p.number, supplierId: p.supplier_id, supplier: p.supplier_name, kind: p.kind, kindLabel: KIND[p.kind], refNo: p.ref_no,
  docDate: p.doc_date_t, validUntil: p.valid_until_t, expired: !!p.valid_until_t && p.valid_until_t < today(), hasFile: !!p.has_file, fileType: p.photo_mime, note: p.note,
  by: p.by_name, at: p.created_at, lines: p.lines || [] });
const plBase = () => db('price_lists as p').join('suppliers as s', 's.id', 'p.supplier_id').join('users as u', 'u.id', 'p.created_by')
  .select('p.id', 'p.number', 'p.supplier_id', 'p.kind', 'p.ref_no', 'p.photo_mime', 'p.note', 'p.created_at', 's.name as supplier_name', 'u.full_name as by_name',
    db.raw('p.doc_date::text as doc_date_t'), db.raw('p.valid_until::text as valid_until_t'), db.raw('(p.photo IS NOT NULL) as has_file'));
async function withPlLines(rows) {
  const lines = rows.length ? await db('price_list_lines').whereIn('price_list_id', rows.map((r) => r.id)).orderBy('id') : [];
  return rows.map((r) => plOut({ ...r, lines: lines.filter((l) => l.price_list_id === r.id).map((l) => ({ id: l.id, item: l.item_name, unit: l.unit, price: Number(l.unit_price) })) }));
}

router.get('/price-lists', requirePage('suppliers'), async (req, res) => {
  const q = plBase().orderBy('p.id', 'desc').limit(300);
  if (Number(req.query.supplier)) q.where('p.supplier_id', Number(req.query.supplier));
  if (req.query.valid === '1') q.where((w) => w.whereNull('p.valid_until').orWhereRaw('p.valid_until >= ?::date', [today()]));
  res.json({ priceLists: await withPlLines(await q) });
});
// The requisition writers (and the Assistant Accountant who checks) need the price lists even without the Suppliers page.
router.get('/price-lists/pick', async (req, res) => {
  if (!['amanager', 'storekeeper', 'aacc', 'acc', 'manager', 'fm'].includes(req.user.role)) throw new HttpError(403, 'Not your work.');
  const q = plBase().orderBy('p.id', 'desc').limit(100);
  if (Number(req.query.supplier)) q.where('p.supplier_id', Number(req.query.supplier));
  res.json({ priceLists: await withPlLines(await q) });
});
router.get('/price-lists/:id', async (req, res) => {
  if (!['amanager', 'storekeeper', 'aacc', 'acc', 'manager', 'fm', 'afm', 'super', 'director', 'cashier'].includes(req.user.role)) throw new HttpError(403, 'Not your work.');
  const r = await plBase().where('p.id', Number(req.params.id) || 0).first();
  if (!r) throw new HttpError(404, 'Price list not found.');
  res.json({ priceList: (await withPlLines([r]))[0] });
});
router.get('/price-lists/:id/file', async (req, res) => {
  if (!['amanager', 'storekeeper', 'aacc', 'acc', 'manager', 'fm', 'afm', 'super', 'director', 'cashier'].includes(req.user.role)) throw new HttpError(403, 'Not your work.');
  const r = await db('price_lists').where({ id: Number(req.params.id) || 0 }).first('photo', 'photo_mime', 'number');
  if (!r?.photo) throw new HttpError(404, 'No photo of the paper.');
  res.set({ 'Content-Type': r.photo_mime, 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': `inline; filename="${r.number}"`, 'X-Content-Type-Options': 'nosniff' });
  res.send(r.photo);
});

router.post('/price-lists', requirePage('suppliers', 'f'), async (req, res) => {
  if (![...PROCUREMENT, 'aacc'].includes(req.user.role)) throw new HttpError(403, 'Procurement (Assistant Manager, store-keeper) enters the price lists.');
  const b = req.body || {};
  const sup = await db('suppliers').where({ id: Number(b.supplierId) || 0, active: true }).first();
  if (!sup) throw new HttpError(400, 'Choose the supplier.');
  const kind = KIND[b.kind] ? b.kind : 'pricelist';
  const docDate = isDate(b.docDate) ? b.docDate : today();
  const validUntil = isDate(b.validUntil) ? b.validUntil : null;
  if (validUntil && validUntil < docDate) throw new HttpError(400, '"Valid until" is before the date of the paper.');
  const lines = (Array.isArray(b.lines) ? b.lines : []).filter((l) => clean(l?.item, 200) || String(l?.price ?? '').trim()).map((l) => {
    const item = clean(l.item, 200);
    if (item.length < 2) throw new HttpError(400, 'Each price needs the item written.');
    return { item_name: item, unit: clean(l.unit, 20) || null, unit_price: whole(l.price, `${item}: price`) };
  });
  if (!lines.length) throw new HttpError(400, 'Type at least one item with its price, as on the paper.');
  if (lines.length > 300) throw new HttpError(400, 'Too many lines (more than 300).');
  const id = await db.transaction(async (trx) => {
    const { rows: [{ id: pid }] } = await trx.raw(`SELECT nextval(pg_get_serial_sequence('price_lists', 'id'))::int AS id`);
    const number = stock.paperNo('PRL', pid);
    await trx('price_lists').insert({ id: pid, number, supplier_id: sup.id, kind, ref_no: clean(b.refNo, 40) || null, doc_date: docDate, valid_until: validUntil, note: clean(b.note, 300) || null, created_by: req.user.id });
    await trx('price_list_lines').insert(lines.map((l) => ({ ...l, price_list_id: pid })));
    await audit(req, 'pricelist.create', `${number}: ${KIND[kind].toLowerCase()} from ${sup.name}${b.refNo ? ` (their no. ${clean(b.refNo, 40)})` : ''}, ${lines.length} prices`, { detail: { priceListId: pid, supplierId: sup.id } }, trx);
    return pid;
  });
  res.status(201).json({ priceList: (await withPlLines([await plBase().where('p.id', id).first()]))[0] });
});

// The photo / PDF of the hard copy: sent as the file itself. Once saved it is never replaced.
router.post('/price-lists/:id/file', requirePage('suppliers', 'f'), uploadLimit, express.raw({ type: () => true, limit: '3mb' }), async (req, res) => {
  const p = await db('price_lists').where({ id: Number(req.params.id) || 0 }).first('id', 'number', 'created_by', db.raw('(photo IS NOT NULL) as has'));
  if (!p) throw new HttpError(404, 'Price list not found.');
  if (p.created_by !== req.user.id) throw new HttpError(403, 'Only the one who entered it adds the photo.');
  if (p.has) throw new HttpError(409, `${p.number} already has its photo. It is never replaced.`);
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) throw new HttpError(400, 'Choose the photo or PDF.');
  const mime = buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'image/jpeg'
    : buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png'
      : buf.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf' : null;
  if (!mime) throw new HttpError(400, 'Only a photo (JPEG, PNG) or a PDF.');
  if (buf.length > 3000000) throw new HttpError(400, 'The file is too big (more than 3 MB).');
  await db('price_lists').where({ id: p.id }).update({ photo: buf, photo_mime: mime });
  await audit(req, 'pricelist.file', `${p.number}: photo of the paper added`, { detail: { priceListId: p.id } });
  res.json({ ok: true });
});

// ---------- One supplier: statement ----------
router.get('/:id', requirePage('suppliers'), async (req, res) => {
  const s = await db('suppliers as s').where('s.id', Number(req.params.id) || 0).select('s.*', db.raw(owedSql)).first();
  if (!s) throw new HttpError(404, 'Supplier not found.');
  const [buys, pays, lists, lpos] = await Promise.all([
    db('purchases as p').leftJoin('schools as sc', 'sc.id', 'p.school_id').where('p.supplier_id', s.id).orderBy('p.id', 'desc').limit(200)
      .select('p.id', 'p.number', 'p.status', 'p.on_credit', 'p.invoice_no', db.raw('p.bought_on::text as day'), 'sc.short_name as school',
        db.raw('(SELECT sum(coalesce(l.confirmed_qty, l.qty) * l.unit_cost) FROM purchase_lines l WHERE l.purchase_id = p.id)::bigint as worth')),
    db('supplier_payments as x').join('users as u', 'u.id', 'x.recorded_by').where('x.supplier_id', s.id).orderBy('x.paid_on', 'desc').orderBy('x.id', 'desc')
      .select('x.id', 'x.amount', db.raw('x.paid_on::text as day'), 'x.ref', 'x.note', 'u.full_name as by'),
    withPlLines(await plBase().where('p.supplier_id', s.id).orderBy('p.id', 'desc').limit(50)),
    db('lpos').where('supplier_id', s.id).orderBy('id', 'desc').limit(50).select('id', 'number', 'status', 'total', db.raw('prepared_at::date::text as day')),
  ]);
  // A statement like the account book: credit goods add to what we owe, payments take it off.
  const moves = [
    ...buys.filter((b) => b.on_credit && ['checked', 'confirmed'].includes(b.status)).map((b) => ({ day: b.day, what: `${b.number}${b.invoice_no ? ` (inv. ${b.invoice_no})` : ''}${b.school ? ` · ${b.school}` : ''}`, credit: Number(b.worth), paid: 0 })),
    ...pays.map((p) => ({ day: p.day, what: `Paid${p.ref ? ` · ${p.ref}` : ''}${p.note ? ` · ${p.note}` : ''} (${p.by})`, credit: 0, paid: Number(p.amount) })),
  ].sort((a, b) => a.day.localeCompare(b.day));
  let bal = 0;
  for (const m of moves) { bal += m.credit - m.paid; m.balance = bal; }
  res.json({ supplier: supOut(s), statement: moves.reverse(), purchases: buys.map((b) => ({ id: b.id, number: b.number, status: b.status, onCredit: b.on_credit, day: b.day, school: b.school, worth: Number(b.worth || 0) })),
    payments: pays.map((p) => ({ ...p, amount: Number(p.amount) })), priceLists: lists, lpos: lpos.map((l) => ({ ...l, total: l.total == null ? null : Number(l.total) })),
    canPay: PAYERS.includes(req.user.role), canEdit: canEdit(req.user) });
});

// A payment to the supplier (part of the debt, or all of it).
router.post('/:id/payments', requirePage('suppliers', 'f'), async (req, res) => {
  if (!PAYERS.includes(req.user.role)) throw new HttpError(403, 'The accountant office or the Finance Manager records payments to suppliers.');
  const b = req.body || {};
  const amount = whole(b.amount, 'The amount');
  if (!amount) throw new HttpError(400, 'Write the amount paid.');
  const paidOn = isDate(b.paidOn) ? b.paidOn : today();
  if (paidOn > today()) throw new HttpError(400, 'The payment date cannot be in the future.');
  const ref = clean(b.ref, 60) || null;
  if (!ref) throw new HttpError(400, 'Write the reference: voucher number, cheque number or bank reference.');
  await db.transaction(async (trx) => {
    const s = await trx('suppliers as s').where('s.id', Number(req.params.id) || 0).select('s.*', trx.raw(owedSql)).forUpdate('s').first();
    if (!s) throw new HttpError(404, 'Supplier not found.');
    const owed = Number(s.credit) - Number(s.paid);
    if (amount > owed) throw new HttpError(400, `We owe ${s.name} only ${money(Math.max(owed, 0))}. A payment cannot be more than the debt.`);
    await trx('supplier_payments').insert({ supplier_id: s.id, amount, paid_on: paidOn, ref, note: clean(b.note, 300) || null, recorded_by: req.user.id });
    await audit(req, 'supplier.paid', `Paid ${s.name} ${money(amount)} on ${paidOn} (${ref}). Still owed: ${money(owed - amount)}`, { detail: { supplierId: s.id } }, trx);
  });
  res.status(201).json({ ok: true });
});

module.exports = router;
module.exports.TERMS = TERMS;
