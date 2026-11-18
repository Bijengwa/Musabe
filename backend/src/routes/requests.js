// Stock requests: the librarian asks for stock, the finance office answers.
// - Librarian (own school): makes a request, can withdraw it while it waits.
// - Finance Manager, Assistant FM, Accountant: send the stock (Send stock with the request), or decline with a reason.
// - Others with the page (Manager, Director, Assistant Accountant): view.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES, pageAccess } = require('../auth/roles');
const stock = require('../lib/stock');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const STATUS = { pending: 'Waiting', sent: 'Stock sent', declined: 'Declined', withdrawn: 'Withdrawn' };
const COLS = ['q.*', 's.short_name as school', 's.code', 'u.full_name as requested_by_name', 'a.full_name as answered_by_name'];

function list(user, f = {}) {
  const school = allSchools(user) ? Number(f.school) || null : user.school_id;
  const q = db('stock_requests as q').join('schools as s', 's.id', 'q.school_id').join('users as u', 'u.id', 'q.requested_by')
    .leftJoin('users as a', 'a.id', 'q.answered_by');
  if (school) q.where('q.school_id', school);
  if (f.status && STATUS[f.status]) q.where('q.status', f.status);
  if (isDate(f.from)) q.whereRaw(`(q.requested_at AT TIME ZONE '${TZ}')::date >= ?`, [f.from]);
  if (isDate(f.to)) q.whereRaw(`(q.requested_at AT TIME ZONE '${TZ}')::date <= ?`, [f.to]);
  return q;
}

// Finance also sees what the library holds now, to decide how much to send. The librarian does not see stock levels.
async function withLines(rows, user) {
  const lines = rows.length ? await db('stock_request_lines').whereIn('request_id', rows.map((r) => r.id)).orderBy('id') : [];
  let levels = {};
  if (pageAccess(user.role, 'stock') && lines.length) {
    const ls = await db('stock_levels').whereIn('item_id', [...new Set(lines.map((l) => l.item_id))]).whereIn('school_id', [...new Set(rows.map((r) => r.school_id))]);
    levels = Object.fromEntries(ls.map((l) => [`${l.school_id}:${l.item_id}`, l.qty]));
  }
  return rows.map((r) => ({
    id: r.id, number: r.number, schoolId: r.school_id, school: r.school, code: r.code, status: r.status, statusLabel: STATUS[r.status],
    note: r.note, requestedBy: r.requested_by_name, requestedAt: r.requested_at, answeredBy: r.answered_by_name, answeredAt: r.answered_at,
    answerNote: r.answer_note, mine: r.requested_by === user.id,
    lines: lines.filter((l) => l.request_id === r.id).map((l) => ({ id: l.id, itemId: l.item_id, name: l.item_name, qty: l.qty, sent: l.sent_qty,
      inStock: levels[`${r.school_id}:${l.item_id}`] ?? (pageAccess(user.role, 'stock') ? 0 : undefined) })),
  }));
}

router.get('/', requirePage('requests'), async (req, res) => {
  const rows = await list(req.user, req.query).orderByRaw("q.status = 'pending' desc").orderBy('q.id', 'desc').limit(200).select(COLS);
  const [{ n }] = await list(req.user, { school: req.query.school }).where('q.status', 'pending').count('* as n');
  res.json({
    requests: await withLines(rows, req.user), pending: Number(n),
    canAsk: req.user.role === 'librarian', canAnswer: pageAccess(req.user.role, 'requests') === 'f' && allSchools(req.user),
  });
});

async function one(user, id) {
  const r = await list(user).where('q.id', Number(id) || 0).first(COLS);
  if (!r) throw new HttpError(404, 'Request not found.');
  return (await withLines([r], user))[0];
}
router.get('/:id', requirePage('requests'), async (req, res) => res.json({ request: await one(req.user, req.params.id) }));

router.post('/', requirePage('requests', 'f'), async (req, res) => {
  if (req.user.role !== 'librarian') throw new HttpError(403, 'Only the librarian asks for stock. The finance office sends it on "Send stock".');
  const b = req.body || {};
  const want = new Map();
  for (const l of Array.isArray(b.lines) ? b.lines : []) {
    const id = Number(l?.itemId), qty = Number(l?.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 100000) throw new HttpError(400, 'Each item needs a whole quantity above 0.');
    want.set(id, (want.get(id) || 0) + qty);
  }
  if (!want.size) throw new HttpError(400, 'Add at least one item.');
  const items = await db('items as i').join('item_prices as p', 'p.item_id', 'i.id').where('p.school_id', req.user.school_id)
    .whereIn('i.id', [...want.keys()]).select('i.id', 'i.name');
  if (items.length !== want.size) throw new HttpError(400, 'One of the items is not sold in your school. Reload the page.');
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const note = clean(b.note, 300) || null;
  const id = await db.transaction(async (trx) => {
    const [{ id: rid }] = await trx('stock_requests').insert({ school_id: req.user.school_id, note, requested_by: req.user.id }).returning('id');
    const number = stock.paperNo('REQ', rid);
    await trx('stock_requests').where({ id: rid }).update({ number });
    const lines = [...want].map(([itemId, qty]) => ({ request_id: rid, item_id: itemId, item_name: byId[itemId].name, qty }));
    await trx('stock_request_lines').insert(lines);
    await audit(req, 'request.create', `${number} from ${req.user.school_short}: ${lines.map((l) => `${l.qty} × ${l.item_name}`).join(', ')}${note ? ` (${note})` : ''}`,
      { schoolId: req.user.school_id, detail: { requestId: rid } }, trx);
    return rid;
  });
  res.status(201).json({ request: await one(req.user, id) });
});

async function answer(req, to, check) {
  const reason = clean(req.body?.reason, 300);
  await db.transaction(async (trx) => {
    const r = await trx('stock_requests').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!r || (!allSchools(req.user) && r.school_id !== req.user.school_id)) throw new HttpError(404, 'Request not found.');
    if (r.status !== 'pending') throw new HttpError(409, `${r.number} is already ${STATUS[r.status].toLowerCase()}.`);
    check(r, reason);
    await trx('stock_requests').where({ id: r.id }).update({ status: to, answered_by: req.user.id, answered_at: trx.fn.now(), answer_note: reason || null });
    await audit(req, `request.${to === 'declined' ? 'decline' : 'withdraw'}`,
      `${r.number} ${to === 'declined' ? 'declined' : 'withdrawn'}${reason ? `: ${reason}` : ''}`, { schoolId: r.school_id, detail: { requestId: r.id } }, trx);
  });
}

router.post('/:id/decline', requirePage('requests', 'f'), async (req, res) => {
  if (!allSchools(req.user)) throw new HttpError(403, 'Only the finance office answers requests.');
  await answer(req, 'declined', (_r, reason) => { if (!reason) throw new HttpError(400, 'Write why, so the librarian knows (e.g. "no stock at the store until March").'); });
  res.json({ request: await one(req.user, req.params.id) });
});

router.post('/:id/withdraw', requirePage('requests', 'f'), async (req, res) => {
  await answer(req, 'withdrawn', (r) => { if (r.requested_by !== req.user.id) throw new HttpError(403, 'Only the person who asked can withdraw it.'); });
  res.json({ request: await one(req.user, req.params.id) });
});

module.exports = router;
module.exports.list = list;
module.exports.withLines = withLines;
module.exports.COLS = COLS;
module.exports.STATUS = STATUS;
