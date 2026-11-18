// Damaged / lost items.
// - Librarian (own school) reports: item, how many, damaged or lost, why. Stock does not change yet.
// - Only the Finance Manager or the Accountant approves (agreed 2026-11-11). Approved = taken out of stock.
//   Rejected = nothing changes. Nobody approves their own report.
// - Others with the page (Assistant FM, Assistant Accountant, Manager, Director, Head Master) view.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES, DAMAGE_APPROVERS } = require('../auth/roles');
const stock = require('../lib/stock');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const STATUS = { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected' };
const KINDS = { damaged: 'Damaged', lost: 'Lost' };
const COLS = ['d.*', 's.short_name as school', 's.code', 'u.full_name as reported_by_name', 'a.full_name as decided_by_name'];

function list(user, f = {}) {
  const school = allSchools(user) ? Number(f.school) || null : user.school_id;
  const q = db('damages as d').join('schools as s', 's.id', 'd.school_id').join('users as u', 'u.id', 'd.reported_by')
    .leftJoin('users as a', 'a.id', 'd.decided_by');
  if (school) q.where('d.school_id', school);
  if (f.status && STATUS[f.status]) q.where('d.status', f.status);
  if (isDate(f.from)) q.whereRaw(`(d.reported_at AT TIME ZONE '${TZ}')::date >= ?`, [f.from]);
  if (isDate(f.to)) q.whereRaw(`(d.reported_at AT TIME ZONE '${TZ}')::date <= ?`, [f.to]);
  return q;
}
const out = (d, user) => ({
  id: d.id, number: d.number, schoolId: d.school_id, school: d.school, code: d.code, itemId: d.item_id, item: d.item_name, qty: d.qty,
  kind: d.kind, kindLabel: KINDS[d.kind], reason: d.reason, status: d.status, statusLabel: STATUS[d.status],
  reportedBy: d.reported_by_name, reportedAt: d.reported_at, decidedBy: d.decided_by_name, decidedAt: d.decided_at, decisionNote: d.decision_note,
  canDecide: d.status === 'pending' && DAMAGE_APPROVERS.includes(user.role) && d.reported_by !== user.id,
});

router.get('/', requirePage('damage'), async (req, res) => {
  const rows = await list(req.user, req.query).orderByRaw("d.status = 'pending' desc").orderBy('d.id', 'desc').limit(300).select(COLS);
  const [c] = await list(req.user, { school: req.query.school }).select(db.raw(`
    (count(*) filter (where d.status = 'pending'))::int as pending,
    coalesce(sum(d.qty) filter (where d.status = 'approved' and date_trunc('month', d.decided_at AT TIME ZONE '${TZ}') = date_trunc('month', now() AT TIME ZONE '${TZ}')), 0)::int as month`));
  res.json({ damages: rows.map((d) => out(d, req.user)), pending: c.pending, approvedThisMonth: c.month,
    canReport: req.user.role === 'librarian', canDecide: DAMAGE_APPROVERS.includes(req.user.role) });
});

router.post('/', requirePage('damage', 'f'), async (req, res) => {
  if (req.user.role !== 'librarian') throw new HttpError(403, 'The librarian reports damaged or lost items. You approve them.');
  const b = req.body || {};
  const qty = Number(b.qty);
  const kind = String(b.kind || '');
  const reason = clean(b.reason, 300);
  if (!KINDS[kind]) throw new HttpError(400, 'Choose damaged or lost.');
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw new HttpError(400, 'Type how many (a whole number above 0).');
  if (reason.length < 5) throw new HttpError(400, 'Write what happened (e.g. "torn by rats in the store", "missing after the count").');
  const item = await db('items as i').join('item_prices as p', 'p.item_id', 'i.id').where({ 'i.id': Number(b.itemId) || 0, 'p.school_id': req.user.school_id }).first('i.id', 'i.name');
  if (!item) throw new HttpError(400, 'Choose an item sold in your school.');
  const level = await db('stock_levels').where({ school_id: req.user.school_id, item_id: item.id }).first();
  const pending = Number((await db('damages').where({ school_id: req.user.school_id, item_id: item.id, status: 'pending' }).sum('qty as n'))[0].n || 0);
  if ((level?.qty || 0) < qty + pending)
    throw new HttpError(409, `${item.name}: the stock record does not have ${qty + pending} to write off${pending ? ` (${pending} already reported and waiting)` : ''}. Check the number, or confirm incoming stock first.`);
  const id = await db.transaction(async (trx) => {
    const [{ id: did }] = await trx('damages').insert({ school_id: req.user.school_id, item_id: item.id, item_name: item.name, qty, kind, reason, reported_by: req.user.id }).returning('id');
    const number = stock.paperNo('DMG', did);
    await trx('damages').where({ id: did }).update({ number });
    await audit(req, 'damage.report', `${number}: ${qty} × ${item.name} ${kind} at ${req.user.school_short} (${reason}). Waiting for the Finance Manager or Accountant`,
      { schoolId: req.user.school_id, detail: { damageId: did } }, trx);
    return did;
  });
  const d = await list(req.user).where('d.id', id).first(COLS);
  res.status(201).json({ damage: out(d, req.user) });
});

router.post('/:id/decide', requirePage('damage', 'f'), async (req, res) => {
  if (!DAMAGE_APPROVERS.includes(req.user.role)) throw new HttpError(403, 'Only the Finance Manager or the Accountant approves damaged or lost items.');
  const approve = req.body?.approve === true;
  const note = clean(req.body?.note, 300) || null;
  if (!approve && !note) throw new HttpError(400, 'Write why it is rejected, so the librarian knows.');
  await db.transaction(async (trx) => {
    const d = await trx('damages').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!d) throw new HttpError(404, 'Report not found.');
    if (d.status !== 'pending') throw new HttpError(409, `${d.number} was already ${d.status}.`);
    if (d.reported_by === req.user.id) throw new HttpError(403, 'Nobody approves their own report.');
    if (approve) {
      await stock.move(trx, { schoolId: d.school_id, itemId: d.item_id, itemName: d.item_name, change: -d.qty, kind: 'damage', ref: d.number, refId: d.id,
        note: `${KINDS[d.kind]}: ${d.reason}`, by: req.user.id });
    }
    await trx('damages').where({ id: d.id }).update({ status: approve ? 'approved' : 'rejected', decided_by: req.user.id, decided_at: trx.fn.now(), decision_note: note });
    await audit(req, approve ? 'damage.approve' : 'damage.reject',
      `${d.number} ${approve ? 'approved' : 'rejected'}: ${d.qty} × ${d.item_name} ${d.kind}${approve ? ', taken out of stock' : ''}${note ? ` (${note})` : ''}`,
      { schoolId: d.school_id, detail: { damageId: d.id } }, trx);
  });
  const d = await list(req.user).where('d.id', Number(req.params.id)).first(COLS);
  res.json({ damage: out(d, req.user) });
});

module.exports = router;
module.exports.list = list;
module.exports.out = out;
module.exports.COLS = COLS;
module.exports.KINDS = KINDS;
module.exports.STATUS = STATUS;
