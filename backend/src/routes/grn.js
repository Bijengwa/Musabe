// GRN: Goods Received Note at the school (2026-11-24).
// When the keepers have confirmed every line of a delivery, the system writes one GRN for each place that received goods
// (BS/LIB/GRN.0001 for the library, BS/ST/GRN.0001 for the school store). The receiving place wrote it (by confirming the lines),
// the Bursar checks it, the Head Master approves it. A GRN can be sent back with a reason; the place sends it again.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES } = require('../auth/roles');
const { publish } = require('../realtime');
const P = require('../lib/places');
const { sendExcel } = require('../lib/excel');

const router = express.Router();
router.use(requireAuth);

const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const STATUS = { waiting: 'Waiting for the Bursar', checked: 'Waiting for the Head Master', approved: 'Approved', sent_back: 'Sent back' };

function listQuery(user, f = {}) {
  const q = db('grns as g').join('schools as s', 's.id', 'g.school_id').leftJoin('users as p', 'p.id', 'g.prepared_by')
    .leftJoin('users as c', 'c.id', 'g.checked_by').leftJoin('users as a', 'a.id', 'g.approved_by');
  if (!allSchools(user)) q.where('g.school_id', user.school_id);
  else if (f.school) q.where('g.school_id', Number(f.school));
  if (f.place && P.PLACES[f.place]) q.where('g.place', f.place);
  if (f.status === 'todo') q.whereIn('g.status', ['waiting', 'checked', 'sent_back']);
  else if (STATUS[f.status]) q.where('g.status', f.status);
  return q;
}
const cols = ['g.*', 's.short_name as school', 'p.full_name as prepared_name', 'c.full_name as checked_name', 'a.full_name as approved_name'];
const shape = (g) => ({ id: g.id, number: g.number, place: g.place, placeLabel: P.PLACES[g.place].label, schoolId: g.school_id, school: g.school, deliveryId: g.delivery_id, delivery: g.delivery_number,
  status: g.status, statusLabel: STATUS[g.status], preparedBy: g.prepared_name, preparedAt: g.prepared_at, checkedBy: g.checked_name, checkedAt: g.checked_at,
  approvedBy: g.approved_name, approvedAt: g.approved_at, backReason: g.back_reason });

async function one(user, id) {
  const g = await listQuery(user).where('g.id', Number(id) || 0).select(cols).first();
  if (!g) throw new HttpError(404, 'GRN not found.');
  const lines = await db('grn_lines').where({ grn_id: g.id }).orderBy('id');
  const own = g.school_id === user.school_id;
  return { ...shape(g), lines: lines.map((l) => ({ id: l.id, name: l.item_name, unit: l.unit, sent: l.sent_qty, received: l.received_qty, note: l.note })),
    canCheck: own && user.role === 'bursar' && g.status === 'waiting', canApprove: own && user.role === 'head' && g.status === 'checked',
    canBack: own && ((user.role === 'bursar' && g.status === 'waiting') || (user.role === 'head' && g.status === 'checked')),
    canResend: own && g.status === 'sent_back' && ((g.place === 'library' && user.role === 'librarian') || (g.place === 'school_store' && ['sstore', 'librarian'].includes(user.role))) };
}

router.get('/', requirePage('grn'), async (req, res) => {
  const rows = await listQuery(req.user, req.query).orderBy('g.prepared_at', 'desc').orderBy('g.id', 'desc').limit(300).select(cols);
  const todo = await listQuery(req.user, {}).whereIn('g.status', ['waiting', 'checked', 'sent_back']).count('* as n').first();
  res.json({ grns: rows.map(shape), todo: Number(todo.n) });
});

router.get('/export.xlsx', requirePage('grn'), async (req, res) => {
  const rows = await listQuery(req.user, req.query).orderBy('g.prepared_at', 'desc').select(cols);
  await sendExcel(res, 'musabe-grn', [{ name: 'GRN', title: 'Musabe Schools: Goods Received Notes', columns: [
    { header: 'GRN', key: 'number', width: 18 }, { header: 'School', key: 'school', width: 16 }, { header: 'Place', key: 'place', width: 12 }, { header: 'Delivery', key: 'delivery', width: 12 },
    { header: 'Status', key: 'status', width: 26 }, { header: 'Checked by (Bursar)', key: 'checked', width: 22 }, { header: 'Approved by (Head Master)', key: 'approved', width: 24 }],
  rows: rows.map((g) => ({ number: g.number, school: g.school, place: P.PLACES[g.place].label, delivery: g.delivery_number, status: STATUS[g.status], checked: g.checked_name || '', approved: g.approved_name || '' })) }]);
});

router.get('/:id', requirePage('grn'), async (req, res) => res.json({ grn: await one(req.user, req.params.id) }));

async function step(req, res, { role, from, to, action, text, needReason = false }) {
  if (req.user.role !== role) throw new HttpError(403, `Only the ${ROLES[role].label} does this step.`);
  const reason = clean(req.body?.reason, 200);
  if (needReason && reason.length < 3) throw new HttpError(400, 'Write why you send it back.');
  await db.transaction(async (trx) => {
    const g = await trx('grns').where({ id: Number(req.params.id) || 0, school_id: req.user.school_id }).forUpdate().first();
    if (!g) throw new HttpError(404, 'GRN not found in your school.');
    if (!from.includes(g.status)) throw new HttpError(409, `${g.number} is "${STATUS[g.status].toLowerCase()}".`);
    await trx('grns').where({ id: g.id }).update(to(g, req));
    await audit(req, action, `${g.number} ${text}${reason ? `: ${reason}` : ''}`, { schoolId: g.school_id, detail: { grnId: g.id } }, trx);
  });
  publish({ topics: ['grn'], schoolId: req.user.school_id }, db);
  res.json({ grn: await one(req.user, req.params.id) });
}
router.post('/:id/check', requirePage('grn', 'f'), (req, res) => step(req, res, { role: 'bursar', from: ['waiting'], action: 'grn.check', text: 'checked by the Bursar',
  to: (g, r) => ({ status: 'checked', checked_by: r.user.id, checked_at: db.fn.now(), back_reason: null }) }));
router.post('/:id/approve', requirePage('grn', 'f'), (req, res) => step(req, res, { role: 'head', from: ['checked'], action: 'grn.approve', text: 'approved by the Head Master',
  to: (g, r) => ({ status: 'approved', approved_by: r.user.id, approved_at: db.fn.now() }) }));
router.post('/:id/back', requirePage('grn', 'f'), async (req, res) => {
  const role = req.user.role;
  if (!['bursar', 'head'].includes(role)) throw new HttpError(403, 'Only the Bursar or the Head Master sends a GRN back.');
  return step(req, res, { role, from: role === 'bursar' ? ['waiting'] : ['checked'], action: 'grn.back', text: `sent back by the ${ROLES[role].label}`, needReason: true,
    to: (g, r) => ({ status: 'sent_back', back_reason: clean(r.body?.reason, 200) }) });
});
router.post('/:id/resend', requirePage('grn', 'f'), async (req, res) => {
  if (!['librarian', 'sstore'].includes(req.user.role)) throw new HttpError(403, 'The keeper of the place sends it again.');
  return step(req, res, { role: req.user.role, from: ['sent_back'], action: 'grn.resend', text: 'sent again by the keeper',
    to: (g, r) => ({ status: 'waiting', prepared_by: r.user.id, prepared_at: db.fn.now(), checked_by: null, checked_at: null }) });
});

module.exports = router;
