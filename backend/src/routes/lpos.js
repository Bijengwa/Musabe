// LPO — Local Purchase Order (2026-11-21), as on the paper (book No. 0651):
//   To; Our Ref; Ship to; Date; SL No. | Description | Unit | Rate | Amount; Total; Prepared by, Certified by, Authorised by.
// Used only for ordering materials. Before it, the office has the supplier's price list or proforma invoice (routes/suppliers.js),
// so the Rate is known; the Rate may also be left empty for the supplier to fill.
//   1. Prepared by the procurement (Assistant Manager or store-keeper).                       status "certify"
//   2. Certified by the Head of Accounts (the Accountant): prices and sums checked.          status "authorise"
//   3. Authorised by the Manager; the Finance Manager when the Manager is away.               status "authorised"
//   4. The goods come: the buyer writes the purchase "from this LPO"; Mapokezi checks them, the accountant office confirms.
//      The LPO is then "delivered". The payment follows the terms agreed with the supplier (cash, weekly, monthly...).
// Every step is signed (PIN, sealed). A signed LPO is never changed; a reject needs a reason (database guard).
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES } = require('../auth/roles');
const { sendExcel } = require('../lib/excel');
const stock = require('../lib/stock');
const seal = require('../lib/seal');
const docs = require('../lib/docs');
const { TERMS } = require('./suppliers');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const STATUS = { certify: 'Waiting for the Head of Accounts to certify', authorise: 'Waiting for the Manager to authorise', authorised: 'Authorised: sent to the supplier',
  delivered: 'Goods received', rejected: 'Rejected', cancelled: 'Cancelled' };
const PREPARERS = ['amanager', 'storekeeper'];
const CERTIFIERS = ['acc'];
const AUTHORISERS = ['manager', 'fm'];
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const money = (n) => `TSh ${Number(n).toLocaleString('en-GB')}`;

const base = () => db('lpos as l').join('suppliers as s', 's.id', 'l.supplier_id').join('users as p', 'p.id', 'l.prepared_by')
  .leftJoin('users as c', 'c.id', 'l.certified_by').leftJoin('users as a', 'a.id', 'l.authorised_by').leftJoin('users as x', 'x.id', 'l.rejected_by')
  .leftJoin('schools as sc', 'sc.id', 'l.school_id').leftJoin('price_lists as pl', 'pl.id', 'l.price_list_id').leftJoin('requisitions as r', 'r.id', 'l.requisition_id')
  .select('l.*', db.raw('l.deliver_by::text as deliver_t'), 's.name as supplier_name', 's.phone as supplier_phone', 's.place as supplier_place',
    'p.full_name as prepared_name', 'p.role as prepared_role', 'c.full_name as certified_name', 'a.full_name as authorised_name', 'a.role as authorised_role',
    'x.full_name as rejected_name', 'sc.name as school_name', 'sc.short_name as school_short', 'pl.number as price_list_no', 'r.number as requisition_no');

function turn(user, l) {
  if (l.status === 'certify' && CERTIFIERS.includes(user.role) && l.prepared_by !== user.id) return 'certify';
  if (l.status === 'authorise' && AUTHORISERS.includes(user.role) && l.prepared_by !== user.id && l.certified_by !== user.id) return 'authorise';
  return null;
}
async function withLines(rows, user) {
  const ids = rows.map((r) => r.id);
  const [lines, sigs, buys] = await Promise.all([
    ids.length ? db('lpo_lines').whereIn('lpo_id', ids).orderBy('id') : [],
    seal.signaturesOf(db, 'lpo', ids),
    ids.length ? db('purchases').whereIn('lpo_id', ids).select('id', 'number', 'status', 'lpo_id') : [],
  ]);
  const sg = (id, step) => { const x = sigs.filter((q) => q.doc_id === id && q.step === step).pop(); return x ? { by: x.user_name, at: x.signed_at, image: x.image, role: x.role } : null; };
  return rows.map((l) => {
    const ls = lines.filter((x) => x.lpo_id === l.id).map((x) => ({ id: x.id, description: x.description, unit: x.unit, qty: x.qty, rate: x.rate == null ? null : Number(x.rate),
      amount: x.rate == null ? null : x.qty * Number(x.rate) }));
    return {
      id: l.id, number: l.number, status: l.status, statusLabel: STATUS[l.status], supplier: { id: l.supplier_id, name: l.supplier_name, phone: l.supplier_phone, place: l.supplier_place },
      shipTo: l.ship_to || l.school_name || 'Musabe Schools administration office', schoolId: l.school_id, school: l.school_short, ourRef: l.our_ref, terms: l.terms, termsLabel: TERMS[l.terms],
      deliverBy: l.deliver_t, note: l.note, total: l.total == null ? null : Number(l.total), complete: ls.every((x) => x.rate != null),
      priceList: l.price_list_id ? { id: l.price_list_id, number: l.price_list_no } : null, requisition: l.requisition_id ? { id: l.requisition_id, number: l.requisition_no } : null,
      preparedAt: l.prepared_at, lines: ls,
      signs: { prepared: sg(l.id, 'prepared') || { by: l.prepared_name, at: l.prepared_at }, certified: sg(l.id, 'certified'), authorised: sg(l.id, 'authorised') },
      authorisedAs: l.authorised_role ? ROLES[l.authorised_role]?.label : null,
      rejected: l.rejected_by ? { by: l.rejected_name, at: l.rejected_at, reason: l.reject_reason } : null,
      purchases: buys.filter((b) => b.lpo_id === l.id).map((b) => ({ id: b.id, number: b.number, status: b.status })),
      turn: turn(user, l),
      canCancel: l.prepared_by === user.id && ['certify', 'authorise', 'authorised'].includes(l.status) && !buys.some((b) => b.lpo_id === l.id && b.status !== 'rejected'),
    };
  });
}
async function one(user, id) {
  const l = await base().where('l.id', Number(id) || 0).first();
  if (!l) throw new HttpError(404, 'LPO not found.');
  const out = (await withLines([l], user))[0];
  out.seal = await seal.seal(db, 'lpo', l.id, await docs.lpo(db, l.id));
  return out;
}

router.get('/', requirePage('lpo'), async (req, res) => {
  const q = base().orderByRaw("l.status in ('certify','authorise') desc").orderBy('l.id', 'desc').limit(300);
  if (req.query.status === 'open') q.whereIn('l.status', ['certify', 'authorise', 'authorised']);
  else if (STATUS[req.query.status]) q.where('l.status', req.query.status);
  if (Number(req.query.supplier)) q.where('l.supplier_id', Number(req.query.supplier));
  if (req.query.q) { const w = `%${clean(req.query.q, 60)}%`; q.where((x) => x.whereILike('l.number', w).orWhereILike('s.name', w)); }
  const rows = await withLines(await q, req.user);
  res.json({ lpos: rows, canWrite: PREPARERS.includes(req.user.role), statuses: STATUS });
});
// Authorised LPOs of a supplier, for the buying form ("goods came from this LPO").
router.get('/open', async (req, res) => {
  if (!['amanager', 'storekeeper'].includes(req.user.role)) throw new HttpError(403, 'Not your work.');
  const q = base().where('l.status', 'authorised').orderBy('l.id', 'desc').limit(100);
  if (Number(req.query.supplier)) q.where('l.supplier_id', Number(req.query.supplier));
  res.json({ lpos: await withLines(await q, req.user) });
});

router.get('/export.xlsx', requirePage('lpo'), async (req, res) => {
  const rows = await withLines(await base().orderBy('l.id', 'desc').limit(5000), req.user);
  await sendExcel(res, 'musabe-lpos', [{ name: 'LPOs', title: 'Musabe Schools: Local Purchase Orders', columns: [
    { header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'LPO No.', key: 'number', width: 11 }, { header: 'Date', key: 'day', width: 12 }, { header: 'To (supplier)', key: 'sup', width: 28 },
    { header: 'Ship to', key: 'shipTo', width: 24 }, { header: 'Terms', key: 'termsLabel', width: 11 }, { header: 'Total', key: 'total', type: 'money', width: 14 }, { header: 'Status', key: 'statusLabel', width: 28 },
    { header: 'Prepared by', key: 'prep', width: 20 }, { header: 'Certified by', key: 'cert', width: 20 }, { header: 'Authorised by', key: 'auth', width: 20 }],
  rows: rows.map((l, i) => ({ ...l, sn: i + 1, day: new Date(l.preparedAt).toLocaleDateString('en-CA', { timeZone: TZ }), sup: l.supplier.name,
    prep: l.signs.prepared?.by, cert: l.signs.certified?.by || '', auth: l.signs.authorised?.by || '' })) }]);
});

router.get('/:id', requirePage('lpo'), async (req, res) => res.json({ lpo: await one(req.user, req.params.id) }));

const signPre = async (req, id, amount) => seal.checkSigning(req.user, { pin: req.body?.pin, smsCode: req.body?.smsCode, type: 'lpo', id: Number(id) || 0, amount });
const signStamp = async (trx, req, id, step) => seal.stamp(trx, req, 'lpo', id, step, await docs.lpo(trx, id));

function readLines(raw) {
  const lines = (Array.isArray(raw) ? raw : []).filter((l) => clean(l?.description, 200) || l?.qty || l?.rate).map((l) => {
    const description = clean(l.description, 200);
    if (description.length < 2) throw new HttpError(400, 'Each line needs its description.');
    const qty = Number(String(l.qty ?? '').replace(/[,\s]/g, ''));
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000000) throw new HttpError(400, `${description}: the quantity must be a whole number (1 or more).`);
    const r = String(l.rate ?? '').replace(/[,\s]/g, '');
    const rate = r === '' ? null : Number(r);
    if (rate !== null && (!Number.isInteger(rate) || rate < 0 || rate > 100000000)) throw new HttpError(400, `${description}: the rate must be whole shillings.`);
    return { id: Number(l.lineId) || null, description, unit: clean(l.unit, 20) || null, qty, rate };
  });
  if (!lines.length) throw new HttpError(400, 'Write at least one line (description, unit, quantity).');
  if (lines.length > 40) throw new HttpError(400, 'At most 40 lines on one LPO.');
  return lines;
}
const totalOf = (lines) => (lines.every((l) => l.rate != null) ? lines.reduce((s, l) => s + l.qty * l.rate, 0) : null);

// 1. Prepared by the procurement.
router.post('/', requirePage('lpo', 'f'), async (req, res) => {
  if (!PREPARERS.includes(req.user.role)) throw new HttpError(403, 'The procurement (Assistant Manager or store-keeper) prepares the LPO.');
  const b = req.body || {};
  const sup = await db('suppliers').where({ id: Number(b.supplierId) || 0, active: true }).first();
  if (!sup) throw new HttpError(400, 'Choose the supplier (To).');
  const school = b.schoolId ? await db('schools').where({ id: Number(b.schoolId) || 0 }).first('id', 'name') : null;
  if (b.schoolId && !school) throw new HttpError(400, 'Choose the school (Ship to).');
  const pl = b.priceListId ? await db('price_lists').where({ id: Number(b.priceListId) || 0, supplier_id: sup.id }).first('id', 'number') : null;
  if (b.priceListId && !pl) throw new HttpError(400, 'That price list is not from this supplier.');
  const rqn = b.requisitionId ? await db('requisitions').where({ id: Number(b.requisitionId) || 0 }).first('id', 'number', 'status') : null;
  if (b.requisitionId && !rqn) throw new HttpError(400, 'That requisition was not found.');
  const deliverBy = isDate(b.deliverBy) ? b.deliverBy : null;
  if (deliverBy && deliverBy < today()) throw new HttpError(400, 'The delivery date is already past.');
  const terms = TERMS[b.terms] ? b.terms : sup.terms;
  const lines = readLines(b.lines);
  const total = totalOf(lines);
  await signPre(req, 0, total || 0);
  const id = await db.transaction(async (trx) => {
    const { rows: [{ id: lid }] } = await trx.raw(`SELECT nextval(pg_get_serial_sequence('lpos', 'id'))::int AS id`);
    const number = stock.paperNo('LPO', lid);
    await trx('lpos').insert({ id: lid, number, supplier_id: sup.id, school_id: school?.id ?? null, ship_to: clean(b.shipTo, 120) || null, our_ref: clean(b.ourRef, 40) || rqn?.number || null,
      price_list_id: pl?.id ?? null, requisition_id: rqn?.id ?? null, terms, deliver_by: deliverBy, note: clean(b.note, 300) || null, total, prepared_by: req.user.id });
    await trx('lpo_lines').insert(lines.map((l) => ({ lpo_id: lid, description: l.description, unit: l.unit, qty: l.qty, rate: l.rate })));
    await signStamp(trx, req, lid, 'prepared');
    await audit(req, 'lpo.create', `${number} to ${sup.name}: ${lines.map((l) => `${l.qty}${l.unit ? ` ${l.unit}` : ''} ${l.description}`).join(', ')}${total != null ? `, ${money(total)}` : ' (rates to be filled)'}. Terms: ${TERMS[terms]}. Waiting for the Head of Accounts to certify`,
      { detail: { lpoId: lid, supplierId: sup.id } }, trx);
    return lid;
  });
  res.status(201).json({ lpo: await one(req.user, id) });
});

// 2. Certified by the Head of Accounts. He may fill a Rate left empty (from the proforma); a written rate is the preparer's.
router.post('/:id/certify', requirePage('lpo', 'f'), async (req, res) => step(req, res, 'certify'));
// 3. Authorised by the Manager (the Finance Manager when the Manager is away).
router.post('/:id/authorise', requirePage('lpo', 'f'), async (req, res) => step(req, res, 'authorise'));

async function step(req, res, which) {
  const b = req.body || {};
  const approve = b.approve !== false;
  const note = clean(b.note, 300);
  if (!approve && note.length < 5) throw new HttpError(400, 'Write why it is rejected.');
  if (approve) await signPre(req, req.params.id, Number((await db('lpos').where({ id: Number(req.params.id) || 0 }).first('total'))?.total || 0));
  await db.transaction(async (trx) => {
    const l = await trx('lpos').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!l) throw new HttpError(404, 'LPO not found.');
    if (turn(req.user, l) !== which) throw new HttpError(l.status === which ? 403 : 409, l.status === which ? 'It is not your turn for this LPO (the one who prepared or certified it cannot sign again).' : `${l.number}: ${STATUS[l.status].toLowerCase()}.`);
    if (!approve) {
      await trx('lpos').where({ id: l.id }).update({ status: 'rejected', rejected_by: req.user.id, rejected_at: trx.fn.now(), reject_reason: note });
      await audit(req, 'lpo.reject', `${l.number} rejected by the ${ROLES[req.user.role].label} (${req.user.full_name}): ${note}`, { detail: { lpoId: l.id, userId: l.prepared_by } }, trx);
      return;
    }
    if (which === 'certify') {
      const given = new Map((Array.isArray(b.lines) ? b.lines : []).map((x) => [Number(x?.lineId), x]));
      for (const x of await trx('lpo_lines').where({ lpo_id: l.id })) {
        const g = given.get(x.id);
        const r = String(g?.rate ?? '').replace(/[,\s]/g, '');
        if (r === '') continue;
        const rate = Number(r);
        if (!Number.isInteger(rate) || rate < 0 || rate > 100000000) throw new HttpError(400, `${x.description}: the rate must be whole shillings.`);
        if (x.rate != null && Number(x.rate) !== rate) throw new HttpError(409, `${x.description}: the rate ${Number(x.rate).toLocaleString('en-GB')} was written by the preparer. Reject with a reason if it is wrong.`);
        if (x.rate == null) await trx('lpo_lines').where({ id: x.id }).update({ rate });
      }
      const lines = await trx('lpo_lines').where({ lpo_id: l.id });
      const total = lines.every((x) => x.rate != null) ? lines.reduce((s, x) => s + x.qty * Number(x.rate), 0) : null;
      await trx('lpos').where({ id: l.id }).update({ status: 'authorise', certified_by: req.user.id, certified_at: trx.fn.now(), total });
      await signStamp(trx, req, l.id, 'certified');
      await audit(req, 'lpo.certify', `${l.number} certified by the Head of Accounts (${req.user.full_name})${total != null ? `, ${money(total)}` : ', rates still to be filled by the supplier'}${note ? `: ${note}` : ''}. Waiting for the Manager to authorise`,
        { detail: { lpoId: l.id, userId: l.prepared_by } }, trx);
    } else {
      await trx('lpos').where({ id: l.id }).update({ status: 'authorised', authorised_by: req.user.id, authorised_at: trx.fn.now() });
      await signStamp(trx, req, l.id, 'authorised');
      await audit(req, 'lpo.authorise', `${l.number} authorised by the ${ROLES[req.user.role].label} (${req.user.full_name})${req.user.role === 'fm' ? ', for the Manager' : ''}${note ? `: ${note}` : ''}. It can be sent to the supplier`,
        { detail: { lpoId: l.id, userId: l.prepared_by } }, trx);
    }
  });
  res.json({ lpo: await one(req.user, req.params.id) });
}

// The one who prepared it cancels it (the supplier cannot supply...), before any goods are bought on it.
router.post('/:id/cancel', requirePage('lpo', 'f'), async (req, res) => {
  const note = clean(req.body?.note, 300);
  if (note.length < 5) throw new HttpError(400, 'Write why it is cancelled.');
  await db.transaction(async (trx) => {
    const l = await trx('lpos').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!l || l.prepared_by !== req.user.id) throw new HttpError(404, 'LPO not found.');
    if (!['certify', 'authorise', 'authorised'].includes(l.status)) throw new HttpError(409, `${l.number}: ${STATUS[l.status].toLowerCase()}.`);
    if (await trx('purchases').where({ lpo_id: l.id }).whereNot('status', 'rejected').first()) throw new HttpError(409, `Goods were already bought on ${l.number}.`);
    await trx('lpos').where({ id: l.id }).update({ status: 'cancelled', rejected_by: req.user.id, rejected_at: trx.fn.now(), reject_reason: note });
    await audit(req, 'lpo.cancel', `${l.number} cancelled by ${req.user.full_name}: ${note}`, { detail: { lpoId: l.id } }, trx);
  });
  res.json({ lpo: await one(req.user, req.params.id) });
});

module.exports = router;
