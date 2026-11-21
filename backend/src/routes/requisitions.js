// School requisitions (RQN.0001) = the paper "PAYMENT REQUISITION FORM":
//   Department requesting, Name of applicant, Details of request (free words), Qty, Amount@, Total.
//   Nothing has to be in a store or in the item list: the applicant writes it in his own words.
//
//   0. Any staff member of the school may ask (teacher, librarian, bursar...), in two kinds:                       status "acad"
//        academic = stationery for lessons: the Academic Master signs first (he works with the librarian: what is left, what was used).
//        general  = uniforms, bed sheets, brooms... (patron, cleaners): the School Store-keeper (role sstore) signs first.
//      The administration never sees it before BOTH school signatures are on it.
//   1. That first signer signs (the Head Master may, if he is away). Or the Head Master writes it: it starts signed.  "head"
//   2. Head Master of that school signs (or rejects).                                                                "store"
//   3. A store-keeper signs. He may fill an Amount@ that was left empty.                                             "manager"
//   4. The Manager signs (may give fewer than asked) or rejects. Every thing he approves must have an Amount@, so
//      the Cashier pays exactly the total and decides nothing. He may also stop a requisition that is still with the
//      school or the store-keeper (with a reason).                                                                   "approved"
//   5. The store-keeper buys or orders it for that school (Purchases). Only now he picks / creates the stock item.    "buying"
//   5b. When the Manager signs, the system makes a "float" for it: the Cashier gives the store-keeper the money to buy
//      (routes/payments.js). Mapokezi is told, and sees this requisition in his own list, so he knows what to check.
//   6. Mapokezi checks it against the receipts; the accountant confirms: it goes to the school's library at once.    "sent"
//   7. The librarian checks what arrived and signs (Incoming stock)                                                  "done"
//
// CHANGED 2026-11-20: only the people sent to buy write requisitions: the Assistant Manager and the store-keeper.
//   They write it for a school (often from an Order Book order, routes/orders.js); it starts at the money step:
//   the Manager OR the Finance Manager approves -> Cashier gives the money -> they buy -> Mapokezi -> confirm.
//   Old requisitions written by school staff before this date still move through the old steps below.
// WHO CHANGES WHAT: only the applicant changes the words (what, department, name, Amount@) and adds / removes lines.
// Every signer (Academic Master, Head Master, store-keeper) may change a QUANTITY, and the Manager approves a quantity.
// A signer who sees something wrong SENDS IT BACK to the applicant with a reason ("returned"): nobody can sign until the
// applicant corrects it; it stays at the same step. Every signature keeps the name and time. Nothing is deleted, and a
// step never goes back (database guard).
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES, REQUISITION_MAKERS, MONEY_APPROVERS } = require('../auth/roles');
const { sendExcel } = require('../lib/excel');
const stock = require('../lib/stock');
const seal = require('../lib/seal');
const docs = require('../lib/docs');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const STATUS = {
  acad: 'Waiting for the Academic Master', head: 'Waiting for the Head Master', store: 'Waiting for the store-keeper', check: 'Waiting for the Assistant Accountant', manager: 'Waiting for the Manager / Finance Manager',
  approved: 'Approved: to buy', buying: 'Being bought / ordered', arrived: 'Bought: to send to the school',
  sent: 'Sent: the librarian checks it', done: 'Received by the school', rejected: 'Rejected', withdrawn: 'Withdrawn', closed: 'Not bought: the money was given back to the Cashier',
};
const OPEN = ['acad', 'head', 'store', 'check', 'manager', 'approved', 'buying', 'arrived', 'sent'];
const SIGN_STEPS = ['acad', 'head', 'store', 'check', 'manager'];   // check = the Assistant Accountant (2026-11-21)
// Two kinds. academic = stationery used in lessons (from the library): first school signer is the Academic Master.
// general = everything else (uniforms, bed sheets, brooms...): first school signer is the school's store-keeper (the librarian).
// The Head Master may always sign the first step if that person is away. The status of that step is called "acad".
const FIRST = { academic: 'acad', general: 'sstore' };
const FIRST_NAME = { academic: 'Academic Master', general: 'School store-keeper' };
// Which kind a person's requisition is: every teacher asks through the Academic Master (it is about lessons); the staff who have no
// account (patron, cleaners...) ask through the School Store-keeper, who writes it for them. The Head Master chooses.
const kindFor = (role, asked) => (role === 'head' ? (asked === 'general' ? 'general' : 'academic') : ['sstore', 'bursar'].includes(role) ? 'general' : 'academic');
// Who may write what is left / already used on the lines (at the school, before the administration sees it).
const STOCK_INFO = ['acad', 'sstore', 'librarian', 'head'];
// What the label says once the Cashier is involved (the status itself does not change).
const BUY_LABEL = { pending: 'Bought: waiting for Mapokezi to check', checked: 'Checked by Mapokezi: waiting for the Cashier (money back)', confirmed: 'Confirmed', rejected: 'Rejected' };
const label = (r, money, buys = []) => {
  const last = buys[buys.length - 1];
  if (['approved', 'buying'].includes(r.status) && last && last.status !== 'confirmed') {
    if (last.status === 'rejected') return r.money_back_asked_at ? 'Not bought: the buyer brings the money back to the Cashier' : `${last.number} was rejected: buy again or return the money`;
    return `${last.number} ${BUY_LABEL[last.status].charAt(0).toLowerCase()}${BUY_LABEL[last.status].slice(1)}`;
  }
  if (r.status === 'acad' && !r.returned) return `Waiting for the ${FIRST_NAME[r.kind]}`;
  if (r.returned && SIGN_STEPS.includes(r.status)) return 'Sent back to the applicant to correct';
  if (r.status === 'approved') return !money ? STATUS.approved : money.status === 'paid' ? 'Money given: to buy / order' : money.status === 'rejected' ? 'Approved: the Cashier rejected the money' : 'Approved: waiting for the Cashier to give the money';
  if ((r.status === 'buying' || r.status === 'arrived') && money?.status === 'paid') return `${STATUS[r.status]} (money given)`;
  return STATUS[r.status];
};
const MONEY_OPEN = ['approved', 'buying', 'arrived'];
const ASKERS_OWN = ['teacher', 'bursar'];

// Whose turn it is, for the "To do" and the buttons.
function turn(user, r) {
  const mine = r.requested_by === user.id;
  const here = user.school_id === r.school_id;
  // Sent back: only the applicant can move it.
  if (r.returned && SIGN_STEPS.includes(r.status)) return mine ? 'correct' : null;
  if (r.status === 'acad') return (user.role === FIRST[r.kind] || user.role === 'head') && here ? 'acad' : (mine ? 'withdraw' : null);
  if (r.status === 'head') return user.role === 'head' && here ? 'head' : (mine ? 'withdraw' : null);
  if (r.status === 'store') return user.role === 'storekeeper' ? 'store' : null;
  // The Assistant Accountant checks the prices (and the supplier's price list) before the money step (2026-11-21).
  if (r.status === 'check') return user.role === 'aacc' && !mine ? 'check' : null;
  if (r.status === 'manager') return MONEY_APPROVERS.includes(user.role) && !mine ? 'manager' : null;
  if (r.status === 'approved') return user.role === 'storekeeper' || (user.role === 'amanager' && mine) ? 'fulfil' : null;
  return null;
}

function list(user, f = {}) {
  const q = db('requisitions as r').join('schools as s', 's.id', 'r.school_id').join('users as u', 'u.id', 'r.requested_by')
    .leftJoin('users as a', 'a.id', 'r.acad_by').leftJoin('users as h', 'h.id', 'r.head_by').leftJoin('users as k', 'k.id', 'r.store_by').leftJoin('users as m', 'm.id', 'r.manager_by').leftJoin('users as ck', 'ck.id', 'r.check_by')
    .leftJoin('price_lists as pl', 'pl.id', 'r.price_list_id').leftJoin('suppliers as plsup', 'plsup.id', 'pl.supplier_id')
    .leftJoin('users as x', 'x.id', 'r.rejected_by').leftJoin('users as rt', 'rt.id', 'r.returned_by').leftJoin('users as mb', 'mb.id', 'r.money_back_by').leftJoin('deliveries as d', 'd.id', 'r.delivery_id');
  if (!allSchools(user)) q.where('r.school_id', user.school_id);
  // A teacher, librarian or bursar sees only what they asked for themselves.
  if (ASKERS_OWN.includes(user.role)) q.where('r.requested_by', user.id);
  else {
    // The librarian helps the Academic Master (what is left, what was used): he sees the lessons requisitions of his school and his own.
    // The School Store-keeper sees the general ones and his own.
    if (user.role === 'librarian') q.where((w) => w.where('r.requested_by', user.id).orWhere('r.kind', 'academic'));
    if (user.role === 'sstore') q.where((w) => w.where('r.requested_by', user.id).orWhere('r.kind', 'general'));
    if (Number(f.school)) q.where('r.school_id', Number(f.school));
  }
  if (f.status === 'open') q.whereIn('r.status', OPEN);
  // What the administration has: school signatures are done.
  else if (f.status === 'admin') q.whereIn('r.status', ['store', 'check', 'manager', 'approved', 'buying', 'arrived', 'sent']);
  // Money given by the Cashier and the goods not yet sent on: what Mapokezi will be asked to check.
  else if (f.status === 'money') q.whereIn('r.status', MONEY_OPEN).whereExists(db('payment_requests as pr').whereRaw('pr.requisition_id = r.id').where('pr.kind', 'float').where('pr.status', 'paid').select(db.raw('1')));
  else if (STATUS[f.status]) q.where('r.status', f.status);
  if (f.q) { const w = `%${clean(f.q, 60)}%`; q.where((x) => x.whereILike('r.number', w).orWhereILike('r.purpose', w)); }
  return q.select('r.*', db.raw('r.needed_by::text as needed'), 's.short_name as school', 's.name as school_name', 's.code', 'u.full_name as requested_by_name', 'u.role as requested_by_role',
    'a.full_name as acad_name', 'h.full_name as head_name', 'k.full_name as store_name', 'm.full_name as manager_name', 'ck.full_name as check_name', 'pl.number as price_list_no', 'pl.kind as price_list_kind', 'plsup.name as price_list_supplier', 'x.full_name as rejected_name',
    'rt.full_name as returned_name', 'rt.role as returned_role', 'mb.full_name as money_back_name', 'd.number as delivery_no', 'd.status as delivery_status');
}

async function withLines(rows, user) {
  const ids = rows.map((r) => r.id);
  const [lines, buys, floats, staff, sigs] = await Promise.all([
    ids.length ? db('requisition_lines').whereIn('requisition_id', ids).orderBy('id') : [],
    ids.length ? db('purchases as p').leftJoin('users as d', 'd.id', 'p.decided_by').leftJoin('users as k', 'k.id', 'p.checked_by').whereIn('p.requisition_id', ids).orderBy('p.id')
      .select('p.id', 'p.number', 'p.status', 'p.requisition_id', 'p.total', 'p.supplier', 'p.decision_note', 'p.decided_at', 'd.full_name as decided_name', 'd.role as decided_role', 'k.full_name as checked_name') : [],
    ids.length ? db('payment_requests as p').leftJoin('users as c', 'c.id', 'p.paid_by').whereIn('p.requisition_id', ids).where('p.kind', 'float')
      .select('p.id', 'p.number', 'p.requisition_id', 'p.status', 'p.amount', 'p.est_amount', 'p.paid_at', 'p.pay_note', 'c.full_name as paid_by_name') : [],
    // Who the requisition is waiting for, by name.
    ids.length ? (() => { const R = ['acad', 'sstore', 'head', 'storekeeper', 'amanager', 'aacc', 'manager', 'fm', 'cashier'];   // main roles and extra roles (one person, many roles)
      return db('users').where('active', true).whereIn('role', R).select('full_name', 'role', 'school_id')
        .union((u) => u.from('user_roles as x').join('users as y', 'y.id', 'x.user_id').where({ 'x.active': true, 'y.active': true }).whereIn('x.role', R).select('y.full_name', 'x.role', 'x.school_id')); })() : [],
    seal.signaturesOf(db, 'requisition', ids),
  ]);
  // The latest signature of each step (the applicant signs again after a correction).
  const sigOf = (rid, step) => sigs.filter((x) => x.doc_id === rid && x.step === step).pop();
  const sg = (rid, step, by, at, note) => { const x = sigOf(rid, step); return by || x ? { by: by || x.user_name, at: at || x.signed_at, note: note || null, image: x?.image || null, acting: !!x?.acting } : null; };
  const names = (role, schoolId) => staff.filter((u) => u.role === role && (schoolId === undefined || u.school_id === schoolId)).map((u) => u.full_name);
  const waitingFor = (r, money) => {
    if (r.returned && SIGN_STEPS.includes(r.status)) return { role: 'Applicant (to correct it)', names: [r.applicant_name || r.requested_by_name] };
    return ({
      acad: { role: FIRST_NAME[r.kind], names: names(FIRST[r.kind], r.school_id).length ? names(FIRST[r.kind], r.school_id) : names('head', r.school_id), orHead: true },
      head: { role: 'Head Master', names: names('head', r.school_id) },
      store: { role: 'Store-keeper', names: names('storekeeper') },
      check: { role: 'Assistant Accountant', names: names('aacc') },
      manager: { role: 'Manager or Finance Manager', names: [...names('manager'), ...names('fm')] },
      approved: money?.status === 'paid' ? (r.requested_by_role === 'amanager' ? { role: 'Assistant Manager (to buy)', names: [r.requested_by_name] } : { role: 'Store-keeper (to buy)', names: names('storekeeper') }) : { role: 'Cashier (to give the money)', names: names('cashier') },
    })[r.status] || null;
  };
  return rows.map((r) => {
    const all = lines.filter((l) => l.requisition_id === r.id);
    const ls = all.filter((l) => !l.removed).map((l) => {
      // The amount of the line: what the Manager approved, else what was written (qty x amount@, or the TOTAL AMOUNT written).
      const amount = l.approved_total ?? l.line_total;
      return { id: l.id, item: l.item_name, qty: l.qty, approvedQty: l.approved_qty, estCost: l.est_cost, total: l.line_total, approvedTotal: l.approved_total, amount,
        leftQty: l.left_qty, usedQty: l.used_qty, origQty: l.orig_qty };
    });
    const taken = all.filter((l) => l.removed).map((l) => ({ id: l.id, item: l.item_name, qty: l.orig_qty ?? l.qty }));
    const complete = ls.length > 0 && ls.every((l) => l.amount != null);
    const t = turn(user, r);
    const f = floats.find((x) => x.requisition_id === r.id);
    const money = f ? { id: f.id, number: f.number, status: f.status, amount: Number(f.amount), estAmount: f.est_amount == null ? null : Number(f.est_amount), paidBy: f.paid_by_name, paidAt: f.paid_at, note: f.pay_note } : null;
    return {
      id: r.id, number: r.number, schoolId: r.school_id, school: r.school, schoolName: r.school_name, code: r.code, purpose: r.purpose, neededBy: r.needed,
      kind: r.kind, firstName: FIRST_NAME[r.kind], department: r.department || r.school_name, applicantName: r.applicant_name || r.requested_by_name,
      status: r.status, statusLabel: label(r, money, buys.filter((p) => p.requisition_id === r.id)), money, requestedBy: r.requested_by_name, requestedByRole: r.requested_by_role, requestedAt: r.requested_at,
      returned: r.returned && SIGN_STEPS.includes(r.status) ? { by: r.returned_name, role: r.returned_role, at: r.returned_at, note: r.returned_note } : null,
      signs: {
        applicant: sg(r.id, 'applicant', null, null, null),
        acad: r.acad_by ? sg(r.id, 'acad', r.acad_name, r.acad_at, r.acad_note) : null,
        head: r.head_by ? sg(r.id, 'head', r.head_name, r.head_at, r.head_note) : null,
        store: r.store_by ? sg(r.id, 'store', r.store_name, r.store_at, r.store_note) : null,
        check: r.check_by ? sg(r.id, 'check', r.check_name, r.check_at, r.check_note) : null,
        manager: r.manager_by ? sg(r.id, 'manager', r.manager_name, r.manager_at, r.manager_note) : null,
      },
      priceList: r.price_list_id ? { id: r.price_list_id, number: r.price_list_no, kind: r.price_list_kind, supplier: r.price_list_supplier } : null,
      rejected: r.rejected_by ? { by: r.rejected_name, at: r.rejected_at, reason: r.reject_reason } : null,
      delivery: r.delivery_id ? { id: r.delivery_id, number: r.delivery_no, status: r.delivery_status } : null, doneAt: r.done_at,
      purchases: buys.filter((p) => p.requisition_id === r.id).map((p) => ({ id: p.id, number: p.number, status: p.status, statusLabel: BUY_LABEL[p.status], total: Number(p.total), supplier: p.supplier,
        checkedBy: p.checked_name, decidedBy: p.decided_name ? `${p.decided_name} (${ROLES[p.decided_role]?.label || ''})` : null, decidedAt: p.decided_at, note: p.decision_note })),
      ...moneyBack(user, r, money, buys.filter((p) => p.requisition_id === r.id)),
      lines: ls, removedLines: taken, waiting: waitingFor(r, money), canStop: MONEY_APPROVERS.includes(user.role) && ['acad', 'head', 'store', 'check'].includes(r.status),
      canWithdraw: r.requested_by === user.id && ['acad', 'head'].includes(r.status),
      // Can a signer send it back to the applicant now?
      canReturn: SIGN_STEPS.includes(t),
      // The TOTAL of the paper: what the Manager approved once he has signed, else what was written. Empty until every line has an amount.
      total: complete ? ls.reduce((s, l) => s + l.amount, 0) : null, askedTotal: ls.length && ls.every((l) => l.total != null) ? ls.reduce((s, l) => s + l.total, 0) : null,
      known: ls.reduce((s, l) => s + (l.amount || 0), 0),
      turn: t,
    };
  });
}
// Money back (2026-11-20): when nothing is being bought now and nothing was confirmed, the buyer may give the office money back.
// The buyer says so (askMoneyBack); the Cashier records what he received (receiveMoneyBack) and the requisition is closed.
function moneyBack(user, r, money, buys) {
  const open = buys.some((p) => ['pending', 'checked'].includes(p.status));
  const used = buys.some((p) => p.status === 'confirmed');
  const can = ['approved', 'buying'].includes(r.status) && money?.status === 'paid' && !open && !used;
  return {
    moneyBack: r.money_back_at ? { amount: Number(r.money_back_amount), by: r.money_back_name, at: r.money_back_at, note: r.money_back_note } : null,
    moneyBackAsked: r.money_back_asked_at || null,
    canAskMoneyBack: can && r.requested_by === user.id && !r.money_back_asked_at,
    canBuyAgain: can && r.requested_by === user.id,
    canReceiveMoneyBack: can && user.role === 'cashier',
  };
}
async function one(user, id) {
  const r = await list(user).where('r.id', Number(id) || 0).first();
  if (!r) throw new HttpError(404, 'Requisition not found.');
  const out = (await withLines([r], user))[0];
  out.seal = await seal.seal(db, 'requisition', r.id, await docs.requisition(db, r.id));
  return out;
}

router.get('/', requirePage('requisitions'), async (req, res) => {
  const rows = await list(req.user, req.query).orderByRaw(`r.status in (${OPEN.map(() => '?').join(',')}) desc`, OPEN).orderBy('r.id', 'desc').limit(300);
  const items = await withLines(rows, req.user);
  const [m] = await db('requisitions as r').whereIn('r.status', MONEY_OPEN)
    .whereExists(db('payment_requests as pr').whereRaw('pr.requisition_id = r.id').where('pr.kind', 'float').where('pr.status', 'paid').select(db.raw('1')))
    .count({ n: 'r.id' });
  const sch = req.user.school_id ? await db('schools').where({ id: req.user.school_id }).first('name') : null;
  res.json({ requisitions: items, mine: items.filter((r) => r.turn && r.turn !== 'withdraw').length, moneyGiven: Number(m.n),
    canWrite: REQUISITION_MAKERS.includes(req.user.role), statuses: STATUS,
    // The form starts filled like the paper: department and name of the applicant.
    me: { name: req.user.full_name, department: sch?.name || '' } });
});

router.get('/export.xlsx', requirePage('requisitions'), async (req, res) => {
  const rows = await withLines(await list(req.user, req.query).orderBy('r.id', 'desc').limit(5000), req.user);
  const flat = rows.flatMap((r) => r.lines.map((l) => ({ number: r.number, school: r.school, at: new Date(r.requestedAt), dept: r.department, by: r.applicantName, item: l.item,
    qty: l.qty, approved: l.approvedQty, cost: l.estCost, total: l.amount, left: l.leftQty, used: l.usedQty, status: r.statusLabel, acad: r.signs.acad?.by || '', head: r.signs.head?.by || '', store: r.signs.store?.by || '', manager: r.signs.manager?.by || '',
    purchases: r.purchases.map((p) => p.number).join(', '), delivery: r.delivery?.number || '' })));
  await sendExcel(res, 'musabe-requisitions', [{ name: 'Requisitions', title: 'Musabe Schools: payment requisition forms',
    columns: [{ header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'No.', key: 'number', width: 11 }, { header: 'School', key: 'school', width: 16 }, { header: 'Date', key: 'at', type: 'date', width: 18 },
      { header: 'Department requesting', key: 'dept', width: 24 }, { header: 'Name of applicant', key: 'by', width: 22 }, { header: 'Details of request', key: 'item', width: 36 },
      { header: 'Qty asked', key: 'qty', type: 'int', width: 9 }, { header: 'Qty approved', key: 'approved', type: 'int', width: 11 }, { header: 'Amount @', key: 'cost', type: 'money', width: 12 }, { header: 'Total amount', key: 'total', type: 'money', width: 14 }, { header: 'Left', key: 'left', type: 'int', width: 8 }, { header: 'Used', key: 'used', type: 'int', width: 8 },
      { header: 'Status', key: 'status', width: 28 }, { header: 'First school signer', key: 'acad', width: 22 }, { header: 'Head Master', key: 'head', width: 22 }, { header: 'Store-keeper', key: 'store', width: 22 }, { header: 'Manager', key: 'manager', width: 22 },
      { header: 'Purchases', key: 'purchases', width: 16 }, { header: 'Delivery', key: 'delivery', width: 11 }],
    rows: flat.map((r, i) => ({ sn: i + 1, ...r })) }]);
});

router.get('/:id', requirePage('requisitions'), async (req, res) => res.json({ requisition: await one(req.user, req.params.id) }));

// What the applicant writes (new, or when he corrects it): the paper's lines. Details in his own words. Qty and Amount @ may be empty;
// the TOTAL AMOUNT of a line is qty x amount@ when both are written, otherwise the total he wrote (may be empty too).
const intOrNull = (v, max, what) => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  if (!Number.isInteger(n) || n < 0 || n > max) throw new HttpError(400, `${what} must be a whole number.`);
  return n;
};
function readForm(user, b, school, allowPast = false) {
  const department = clean(b?.department, 80) || school;
  const applicant = clean(b?.applicantName, 100) || user.full_name;
  const neededBy = isDate(b?.neededBy) ? b.neededBy : null;
  if (neededBy && !allowPast && neededBy < today()) throw new HttpError(400, 'The "needed by" date is already past.');
  const raw = (Array.isArray(b?.lines) ? b.lines : []).filter((l) => clean(l?.name, 200) || l?.qty || l?.estCost || l?.total);
  if (!raw.length) throw new HttpError(400, 'Write at least one line in "Details of request".');
  if (raw.length > 50) throw new HttpError(400, 'At most 50 lines on one requisition.');
  const lines = raw.map((l) => {
    const name = clean(l?.name, 200);
    if (name.length < 2) throw new HttpError(400, 'Each line needs its details written (what is requested).');
    const qty = intOrNull(l?.qty, 100000, `${name}: Qty`);
    if (qty === 0) throw new HttpError(400, `${name}: Qty must be 1 or more, or left empty.`);
    const est = intOrNull(l?.estCost, 100000000, `${name}: Amount @`);
    let total = intOrNull(l?.total, 1000000000, `${name}: Total amount`);
    if (qty !== null && est !== null) total = qty * est;
    return { id: Number(l?.lineId) || null, item_name: name, qty, est_cost: est, line_total: total };
  });
  // "For": built from the details, so the lists and the bell have something to show.
  const purpose = clean(`${department}: ${lines.map((l) => l.item_name).join(', ')}`, 300);
  return { department, applicant, neededBy, lines, purpose, kind: kindFor(user.role, b?.kind) };
}
const sum = (lines) => lines.map((l) => `${l.qty ? `${l.qty} × ` : ''}${l.item_name}${l.est_cost != null ? ` @ ${l.est_cost.toLocaleString('en-GB')}` : ''}${l.line_total != null ? ` = ${l.line_total.toLocaleString('en-GB')}` : ''}`).join(', ');
const when = (n) => (n == null ? 'none' : n.toLocaleString('en-GB'));

// 1. Anyone on the school staff asks (teacher, librarian, bursar, School Store-keeper, Academic Master, Head Master).
router.post('/', requirePage('requisitions', 'f'), async (req, res) => {
  if (!REQUISITION_MAKERS.includes(req.user.role)) throw new HttpError(403, 'Only the Assistant Manager or the store-keeper writes a payment requisition. Staff of a school ask with the Order Book.');
  return writeByBuyer(req, res);
});
// Old way (before 2026-11-20): written by school staff. Kept so the old papers still read the same; no route uses it now.
async function writeBySchool(req, res) {
  const byHead = req.user.role === 'head';
  const school = (await db('schools').where({ id: req.user.school_id }).first('name'))?.name || '';
  const f = readForm(req.user, req.body, school);
  await signPre(req, 0);   // the applicant signs it by typing his PIN
  // The first school signer (Academic Master for lessons, the School Store-keeper for the rest) writing it himself has already signed that step.
  const byFirst = !byHead && req.user.role === FIRST[f.kind];
  const action = byHead ? 'requisition.head' : byFirst ? 'requisition.acad' : f.kind === 'general' ? 'requisition.create_gen' : 'requisition.create';
  const id = await db.transaction(async (trx) => {
    const { rows: [{ id: rid }] } = await trx.raw(`SELECT nextval(pg_get_serial_sequence('requisitions', 'id'))::int AS id`);
    const number = stock.paperNo('RQN', rid);
    // Written by the Head Master: it starts signed by him and goes straight to the store-keeper.
    await trx('requisitions').insert({ id: rid, number, school_id: req.user.school_id, purpose: f.purpose, kind: f.kind, department: f.department, applicant_name: f.applicant, needed_by: f.neededBy, requested_by: req.user.id,
      ...(byHead ? { status: 'store', head_by: req.user.id, head_at: trx.fn.now() } : byFirst ? { status: 'head', acad_by: req.user.id, acad_at: trx.fn.now() } : { status: 'acad' }) });
    await trx('requisition_lines').insert(f.lines.map((l) => ({ requisition_id: rid, item_name: l.item_name, qty: l.qty, est_cost: l.est_cost, line_total: l.line_total })));
    await signStamp(trx, req, rid, 'applicant');
    if (byHead) await signStamp(trx, req, rid, 'head', { allowSame: true });
    else if (byFirst) await signStamp(trx, req, rid, 'acad', { allowSame: true });
    await audit(req, action, `${number}: ${f.applicant} (${f.department}) asks for ${sum(f.lines)} (${f.kind === 'academic' ? 'for lessons' : 'general'}). ${byHead ? 'Signed by the Head Master; waiting for the store-keeper' : byFirst ? 'Waiting for the Head Master' : `Waiting for the ${FIRST_NAME[f.kind]}`}`,
      { schoolId: req.user.school_id, detail: { requisitionId: rid } }, trx);
    return rid;
  });
  res.status(201).json({ requisition: await one(req.user, id) });
}
void writeBySchool;

// The buyer (Assistant Manager or store-keeper) writes it for one school. His signature covers the store-keeper step,
// so it goes straight to the money step: the Manager or the Finance Manager. orderId: the Order Book order it answers.
async function writeByBuyer(req, res) {
  const b = req.body || {};
  const schoolRow = await db('schools').where({ id: Number(b.schoolId) || 0 }).first('id', 'name');
  if (!schoolRow) throw new HttpError(400, 'Choose the school this requisition is for.');
  const f = readForm(req.user, b, schoolRow.name);
  f.kind = b.kind === 'academic' ? 'academic' : 'general';
  const missing = f.lines.filter((l) => l.line_total === null).map((l) => l.item_name);
  if (missing.length) throw new HttpError(400, `Write the amount on: ${missing.join(', ')}. You are the one who knows the price (ask the shop for a price list first).`);
  const orderId = Number(b.orderId) || null;
  // The supplier's price list or proforma invoice the prices come from (not required, but the Assistant Accountant checks against it).
  const priceList = b.priceListId ? await db('price_lists').where({ id: Number(b.priceListId) || 0 }).first('id', 'number') : null;
  if (b.priceListId && !priceList) throw new HttpError(400, 'That price list was not found. Reload the page.');
  await signPre(req, 0);
  const id = await db.transaction(async (trx) => {
    let order = null;
    if (orderId) {
      order = await trx('orders').where({ id: orderId }).forUpdate().first();
      if (!order || order.status !== 'keeper') throw new HttpError(409, 'That order is not waiting for the store-keeper any more. Reload the page.');
      if (order.school_id !== schoolRow.id) throw new HttpError(400, 'The order is for another school.');
    }
    const { rows: [{ id: rid }] } = await trx.raw(`SELECT nextval(pg_get_serial_sequence('requisitions', 'id'))::int AS id`);
    const number = stock.paperNo('RQN', rid);
    await trx('requisitions').insert({ id: rid, number, school_id: schoolRow.id, purpose: f.purpose, kind: f.kind, department: f.department, applicant_name: f.applicant,
      needed_by: f.neededBy, requested_by: req.user.id, status: 'check', store_by: req.user.id, store_at: trx.fn.now(), price_list_id: priceList?.id ?? null });
    await trx('requisition_lines').insert(f.lines.map((l) => ({ requisition_id: rid, item_name: l.item_name, qty: l.qty, est_cost: l.est_cost, line_total: l.line_total })));
    await signStamp(trx, req, rid, 'applicant');
    await signStamp(trx, req, rid, 'store', { allowSame: true });
    if (order) {
      await trx('orders').where({ id: order.id }).update({ status: 'requisition', requisition_id: rid, keeper_by: req.user.id, keeper_at: trx.fn.now() });
      await audit(req, 'order.requisition', `${order.number}: ${req.user.full_name} wrote ${number} for it`, { schoolId: order.school_id, detail: { orderId: order.id, requisitionId: rid, userId: order.written_by } }, trx);
    }
    await audit(req, 'requisition.create', `${number}: ${f.applicant} (${ROLES[req.user.role].label}) asks for ${sum(f.lines)} for ${schoolRow.name}${order ? ` (order ${order.number})` : ''}${priceList ? `, prices from ${priceList.number}` : ''}. Waiting for the Assistant Accountant to check it`,
      { schoolId: schoolRow.id, detail: { requisitionId: rid } }, trx);
    return rid;
  });
  res.status(201).json({ requisition: await one(req.user, id) });
}

// Load for a step, locked, and check it is this person's turn.
async function forStep(trx, user, id, steps) {
  steps = [].concat(steps);
  const r = await trx('requisitions').where({ id: Number(id) || 0 }).forUpdate().first();
  if (!r || (!allSchools(user) && r.school_id !== user.school_id)) throw new HttpError(404, 'Requisition not found.');
  if (!steps.includes(turn(user, r))) {
    if (r.returned && SIGN_STEPS.includes(r.status)) throw new HttpError(409, `${r.number} was sent back to the applicant. It waits for the correction.`);
    if (!steps.includes(r.status)) throw new HttpError(409, `${r.number} is ${STATUS[r.status].toLowerCase()}.`);
    throw new HttpError(403, 'It is not your turn for this requisition.');
  }
  return r;
}

router.post('/:id/withdraw', requirePage('requisitions', 'f'), async (req, res) => {
  await db.transaction(async (trx) => {
    const r = await trx('requisitions').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!r || r.requested_by !== req.user.id) throw new HttpError(404, 'Requisition not found.');
    if (!['acad', 'head'].includes(r.status)) throw new HttpError(409, `${r.number} is ${STATUS[r.status].toLowerCase()}. It can be withdrawn only before the Head Master signs.`);
    await trx('requisitions').where({ id: r.id }).update({ status: 'withdrawn' });
    await audit(req, 'requisition.withdraw', `${r.number} withdrawn by ${req.user.full_name}`, { schoolId: r.school_id, detail: { requisitionId: r.id } }, trx);
  });
  res.json({ requisition: await one(req.user, req.params.id) });
});

function decision(b) {
  const approve = b?.approve === true;
  const note = clean(b?.note, 300) || null;
  if (!approve && !note) throw new HttpError(400, 'Write why it is rejected, so the applicant knows.');
  return { approve, note };
}
// Signing (lib/seal.js): the signer types his signing PIN (and an SMS code for a big amount). Checked BEFORE the transaction, so wrong tries are counted.
const signPre = async (req, id) => seal.checkSigning(req.user, { pin: req.body?.pin, smsCode: req.body?.smsCode, type: 'requisition', id: Number(id) || 0, amount: id ? await docs.amountOf('requisition', Number(id)) : 0 });
const signStamp = async (trx, req, id, step, o) => seal.stamp(trx, req, 'requisition', id, step, await docs.requisition(trx, id), o);
async function reject(trx, req, r, note, who) {
  await trx('requisitions').where({ id: r.id }).update({ status: 'rejected', rejected_by: req.user.id, rejected_at: trx.fn.now(), reject_reason: note });
  await audit(req, 'requisition.reject', `${r.number} rejected by the ${who} (${req.user.full_name}): ${note}`,
    { schoolId: r.school_id, detail: { requisitionId: r.id, userId: r.requested_by } }, trx);
}
// Amount @ and TOTAL AMOUNT are the applicant's. A signer may only fill one that was left EMPTY, never change one that is written.
// Returns the line's { est_cost, line_total } after filling.
function fillAmount(l, g) {
  let est = l.est_cost;
  let tot = l.line_total;
  const c = intOrNull(g?.estCost, 100000000, `${l.item_name}: Amount @`);
  const t = intOrNull(g?.total, 1000000000, `${l.item_name}: Total amount`);
  const fix = (what, old) => new HttpError(409, `${l.item_name}: the applicant wrote ${what} ${old.toLocaleString('en-GB')}. Only the applicant can change it: send the requisition back with a reason.`);
  if (c !== null) { if (est !== null && c !== est) throw fix('Amount @', est); est = c; }
  if (t !== null) { if (tot !== null && t !== tot) throw fix('the total', tot); tot = t; }
  if (l.qty !== null && est !== null) {
    const exact = l.qty * est;
    if (tot !== null && tot !== exact) throw new HttpError(409, `${l.item_name}: ${l.qty} × ${est.toLocaleString('en-GB')} is ${exact.toLocaleString('en-GB')}, not the total ${tot.toLocaleString('en-GB')} written by the applicant. Send it back to the applicant.`);
    tot = exact;
  }
  return { est_cost: est, line_total: tot };
}
const saveAmount = async (trx, l, a) => { if (a.est_cost !== l.est_cost || a.line_total !== l.line_total) await trx('requisition_lines').where({ id: l.id }).update(a); };

// 1b. The Academic Master (or the Head Master, if the Academic Master is away) signs what a staff member asked.
router.post('/:id/acad', requirePage('requisitions', 'f'), async (req, res) => {
  const { approve, note } = decision(req.body);
  if (approve) await signPre(req, req.params.id);
  await db.transaction(async (trx) => {
    const r = await forStep(trx, req.user, req.params.id, 'acad');
    if (!approve) return reject(trx, req, r, note, req.user.role === 'head' ? 'Head Master' : FIRST_NAME[r.kind]);
    await trx('requisitions').where({ id: r.id }).update({ status: 'head', acad_by: req.user.id, acad_at: trx.fn.now(), acad_note: note });
    await signStamp(trx, req, r.id, 'acad', { acting: req.user.role === 'head' });
    await audit(req, 'requisition.acad', `${r.number} signed by the ${req.user.role === 'head' ? `Head Master, for the ${FIRST_NAME[r.kind]}` : FIRST_NAME[r.kind]} (${req.user.full_name})${note ? `: ${note}` : ''}. Waiting for the Head Master`,
      { schoolId: r.school_id, detail: { requisitionId: r.id, userId: r.requested_by } }, trx);
  });
  res.json({ requisition: await one(req.user, req.params.id) });
});

// 2. The Head Master of the school signs.
router.post('/:id/head', requirePage('requisitions', 'f'), async (req, res) => {
  const { approve, note } = decision(req.body);
  if (approve) await signPre(req, req.params.id);
  await db.transaction(async (trx) => {
    const r = await forStep(trx, req.user, req.params.id, 'head');
    if (!approve) return reject(trx, req, r, note, 'Head Master');
    await trx('requisitions').where({ id: r.id }).update({ status: 'store', head_by: req.user.id, head_at: trx.fn.now(), head_note: note });
    await signStamp(trx, req, r.id, 'head', { sameOkIfActing: true });
    await audit(req, 'requisition.head', `${r.number} signed by the Head Master (${req.user.full_name})${note ? `: ${note}` : ''}. Waiting for the store-keeper`,
      { schoolId: r.school_id, detail: { requisitionId: r.id, userId: r.requested_by } }, trx);
  });
  res.json({ requisition: await one(req.user, req.params.id) });
});

// 3. A store-keeper signs. He changes no words. He may fill an Amount @ or a total that is empty.
router.post('/:id/store', requirePage('requisitions', 'f'), async (req, res) => {
  const { approve, note } = decision(req.body);
  const given = new Map((Array.isArray(req.body?.lines) ? req.body.lines : []).map((l) => [Number(l?.lineId), l]));
  if (approve) await signPre(req, req.params.id);
  await db.transaction(async (trx) => {
    const r = await forStep(trx, req.user, req.params.id, 'store');
    if (!approve) return reject(trx, req, r, note, 'store-keeper');
    const lines = await trx('requisition_lines').where({ requisition_id: r.id, removed: false }).orderBy('id');
    let total = 0;
    for (const l of lines) {
      const a = fillAmount(l, given.get(l.id));
      await saveAmount(trx, l, a);
      total += a.line_total || 0;
    }
    await trx('requisitions').where({ id: r.id }).update({ status: 'check', store_by: req.user.id, store_at: trx.fn.now(), store_note: note });
    await signStamp(trx, req, r.id, 'store');
    await audit(req, 'requisition.store', `${r.number} signed by the store-keeper (${req.user.full_name})${total ? `, about TSh ${total.toLocaleString('en-GB')}` : ''}${note ? `: ${note}` : ''}. Waiting for the Assistant Accountant`,
      { schoolId: r.school_id, detail: { requisitionId: r.id, userId: r.requested_by } }, trx);
  });
  res.json({ requisition: await one(req.user, req.params.id) });
});

// 3b. The Assistant Accountant checks it (2026-11-21): the prices against the supplier's price list / proforma, the sums.
// He may fill an Amount @ or a total that is empty; a written one is the applicant's (send it back to change it).
router.post('/:id/check', requirePage('requisitions', 'f'), async (req, res) => {
  const { approve, note } = decision(req.body);
  const given = new Map((Array.isArray(req.body?.lines) ? req.body.lines : []).map((l) => [Number(l?.lineId), l]));
  if (approve) await signPre(req, req.params.id);
  await db.transaction(async (trx) => {
    const r = await forStep(trx, req.user, req.params.id, 'check');
    if (!approve) return reject(trx, req, r, note, 'Assistant Accountant');
    const lines = await trx('requisition_lines').where({ requisition_id: r.id, removed: false }).orderBy('id');
    let total = 0;
    for (const l of lines) {
      const a = fillAmount(l, given.get(l.id));
      await saveAmount(trx, l, a);
      total += a.line_total || 0;
    }
    await trx('requisitions').where({ id: r.id }).update({ status: 'manager', check_by: req.user.id, check_at: trx.fn.now(), check_note: note });
    await signStamp(trx, req, r.id, 'check');
    await audit(req, 'requisition.check', `${r.number} checked by the Assistant Accountant (${req.user.full_name})${total ? `, TSh ${total.toLocaleString('en-GB')}` : ''}${note ? `: ${note}` : ''}. Waiting for the Manager or the Finance Manager`,
      { schoolId: r.school_id, detail: { requisitionId: r.id, userId: r.requested_by } }, trx);
  });
  res.json({ requisition: await one(req.user, req.params.id) });
});

// 4. The Manager signs. For a line with a Qty he approves a quantity (0 = not this line); for a line with only a TOTAL AMOUNT he approves
// an amount (0 = not this line, or less than written). Every approved line must end with an amount: that sum is what the Cashier pays.
router.post('/:id/manager', requirePage('requisitions', 'f'), async (req, res) => {
  const { approve, note } = decision(req.body);
  const given = new Map((Array.isArray(req.body?.lines) ? req.body.lines : []).map((l) => [Number(l?.lineId), l]));
  if (approve) await signPre(req, req.params.id);
  await db.transaction(async (trx) => {
    const r = await forStep(trx, req.user, req.params.id, 'manager');
    if (!approve) return reject(trx, req, r, note, ROLES[req.user.role].label);
    const lines = await trx('requisition_lines').where({ requisition_id: r.id, removed: false }).orderBy('id');
    const cut = [];
    const noCost = [];
    let est = 0;
    for (const l of lines) {
      const g = given.get(l.id);
      const a = fillAmount(l, g);
      await saveAmount(trx, l, a);
      let aq = null;
      if (l.qty !== null) {
        aq = intOrNull(g?.approvedQty, l.qty, `${l.item_name}: approved`) ?? l.qty;
        if (aq > l.qty) throw new HttpError(400, `${l.item_name}: approve 0 to ${l.qty}.`);
      }
      let at;
      if (l.qty !== null && a.est_cost !== null) at = aq * a.est_cost;
      else {
        const asked = intOrNull(g?.approvedTotal, 1000000000, `${l.item_name}: approved amount`);
        at = asked !== null ? asked : aq === 0 ? 0 : aq !== null && aq < l.qty && a.line_total !== null ? Math.round((a.line_total * aq) / l.qty) : a.line_total;
        if (at !== null && a.line_total !== null && at > a.line_total) throw new HttpError(400, `${l.item_name}: you cannot approve more (${at.toLocaleString('en-GB')}) than was written (${a.line_total.toLocaleString('en-GB')}).`);
      }
      if (at === null || (aq !== null && aq > 0 && at <= 0)) noCost.push(l.item_name);
      est += at || 0;
      if ((aq !== null && aq < l.qty) || (a.line_total !== null && at !== null && at < a.line_total)) cut.push(`${l.item_name} ${at === 0 ? 'not approved' : aq !== null && aq < l.qty ? `${aq} of ${l.qty}` : `TSh ${at.toLocaleString('en-GB')} of ${a.line_total.toLocaleString('en-GB')}`}`);
      await trx('requisition_lines').where({ id: l.id }).update({ approved_qty: aq, approved_total: at });
    }
    if (noCost.length) throw new HttpError(400, `No amount on: ${noCost.join(', ')}. Ask the store-keeper to fill it, write it yourself, or send the requisition back to the applicant. The Cashier pays exactly the total and decides nothing.`);
    if (!(est > 0)) throw new HttpError(400, 'Nothing is approved. Use "Reject" instead, with a reason.');
    if (cut.length && !note) throw new HttpError(400, 'You gave less than asked. Write a short note why.');
    await trx('requisitions').where({ id: r.id }).update({ status: 'approved', manager_by: req.user.id, manager_at: trx.fn.now(), manager_note: note });
    await signStamp(trx, req, r.id, 'manager');
    await audit(req, 'requisition.manager', `${r.number} approved by the ${ROLES[req.user.role].label} (${req.user.full_name}), TSh ${est.toLocaleString('en-GB')}${cut.length ? `, less: ${cut.join(', ')}` : ''}${note ? ` (${note})` : ''}. The Cashier gives the money, then the store-keeper buys or sends it`,
      { schoolId: r.school_id, detail: { requisitionId: r.id, userId: r.requested_by } }, trx);
    // The money to buy it: the Cashier is told at once.
    const { rows: [{ id: pid }] } = await trx.raw(`SELECT nextval(pg_get_serial_sequence('payment_requests', 'id'))::int AS id`);
    const pno = stock.paperNo('PRQ', pid);
    await trx('payment_requests').insert({ id: pid, number: pno, kind: 'float', requisition_id: r.id, amount: est, est_amount: est,
      purpose: `Money to buy for ${r.number}: ${r.purpose}`.slice(0, 300), approved_by_name: `${ROLES[req.user.role].label} ${req.user.full_name}`.slice(0, 120), requested_by: req.user.id, authorized_by: req.user.id, authorized_at: trx.fn.now() });
    await trx('payment_lines').insert({ payment_id: pid, sn: 1, detail: `Money to buy: ${r.number}`.slice(0, 200), amount: est });
    await seal.stamp(trx, req, 'voucher', pid, 'authorized', await docs.voucher(trx, pid), { allowSame: true });
    await audit(req, 'payment.float', `${pno}: money to give for ${r.number}, TSh ${est.toLocaleString('en-GB')}. Waiting for the Cashier`,
      { schoolId: r.school_id, detail: { paymentId: pid, requisitionId: r.id } }, trx);
  });
  res.json({ requisition: await one(req.user, req.params.id) });
});

// A signer (first school signer, Head Master, store-keeper) may change a QUANTITY before signing. Nothing else.
// The total follows the new quantity: qty x Amount @, or (no Amount @, only a written total) the same price per piece.
router.post('/:id/amend', requirePage('requisitions', 'f'), async (req, res) => {
  const changes = Array.isArray(req.body?.lines) ? req.body.lines : [];
  const note = clean(req.body?.note, 300) || null;
  await db.transaction(async (trx) => {
    const r = await forStep(trx, req.user, req.params.id, ['acad', 'head', 'store']);
    const lines = await trx('requisition_lines').where({ requisition_id: r.id, removed: false });
    const by = new Map(lines.map((l) => [l.id, l]));
    const said = [];
    for (const c of changes) {
      const l = by.get(Number(c?.lineId));
      if (!l) throw new HttpError(400, 'One of the lines is not on this requisition. Reload the page.');
      if (l.qty === null) throw new HttpError(400, `${l.item_name} has no quantity written, so there is no quantity to change.`);
      const qty = Number(c.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw new HttpError(400, `${l.item_name}: a whole quantity from 1 to 100,000.`);
      if (qty !== l.qty) {
        await trx('requisition_lines').where({ id: l.id }).update({ qty, orig_qty: l.orig_qty ?? l.qty, ...(l.est_cost !== null ? { line_total: qty * l.est_cost } : l.line_total !== null ? { line_total: Math.round((l.line_total * qty) / l.qty) } : {}) });
        said.push(`${l.item_name}: ${l.qty} → ${qty}`);
      }
    }
    if (!said.length) throw new HttpError(400, 'Nothing was changed.');
    const who = { acad: FIRST_NAME[r.kind], head: 'Head Master', store: 'store-keeper' }[r.status];
    await audit(req, 'requisition.amend', `${r.number}: quantity changed by the ${who} (${req.user.full_name}): ${said.join('; ')}${note ? ` (${note})` : ''}`,
      { schoolId: r.school_id, detail: { requisitionId: r.id, userId: r.requested_by } }, trx);
  });
  res.json({ requisition: await one(req.user, req.params.id) });
});

// What is still LEFT and what was already USED, line by line: written at the school (the Academic Master with the librarian, or the School
// Store-keeper), so that the administration gets the requisition with all the data it needs. Allowed while it is at the school.
router.post('/:id/stockinfo', requirePage('requisitions', 'f'), async (req, res) => {
  const changes = Array.isArray(req.body?.lines) ? req.body.lines : [];
  await db.transaction(async (trx) => {
    const r = await trx('requisitions').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!r || r.school_id !== req.user.school_id) throw new HttpError(404, 'Requisition not found.');
    if (!STOCK_INFO.includes(req.user.role)) throw new HttpError(403, 'Only the people at the school who keep the stock write what is left and what was used.');
    if (!['acad', 'head'].includes(r.status)) throw new HttpError(409, `${r.number} has left the school. What is left and used can no longer be changed.`);
    const lines = await trx('requisition_lines').where({ requisition_id: r.id, removed: false });
    const by = new Map(lines.map((l) => [l.id, l]));
    const said = [];
    for (const c of changes) {
      const l = by.get(Number(c?.lineId));
      if (!l) throw new HttpError(400, 'One of the lines is not on this requisition. Reload the page.');
      const left = intOrNull(c.left, 1000000, `${l.item_name}: left`);
      const used = intOrNull(c.used, 1000000, `${l.item_name}: used`);
      if (left !== l.left_qty || used !== l.used_qty) {
        await trx('requisition_lines').where({ id: l.id }).update({ left_qty: left, used_qty: used });
        said.push(`${l.item_name}: left ${when(left)}, used ${when(used)}`);
      }
    }
    if (!said.length) throw new HttpError(400, 'Nothing was changed.');
    await audit(req, 'requisition.stockinfo', `${r.number}: ${req.user.full_name} wrote what is left and what was used: ${said.join('; ')}`, { schoolId: r.school_id, detail: { requisitionId: r.id } }, trx);
  });
  res.json({ requisition: await one(req.user, req.params.id) });
});

// A signer sends it BACK to the applicant to correct the words (name of the item, Amount @, department...). A reason is required.
// It stays at the same step; nobody can sign until the applicant corrects it.
router.post('/:id/return', requirePage('requisitions', 'f'), async (req, res) => {
  const note = clean(req.body?.note, 300);
  if (note.length < 5) throw new HttpError(400, 'Write what the applicant must correct.');
  await db.transaction(async (trx) => {
    const r = await forStep(trx, req.user, req.params.id, SIGN_STEPS);
    await trx('requisitions').where({ id: r.id }).update({ returned: true, returned_by: req.user.id, returned_at: trx.fn.now(), returned_note: note });
    await audit(req, 'requisition.return', `${r.number} sent back to ${r.applicant_name || 'the applicant'} by ${req.user.full_name}: ${note}`,
      { schoolId: r.school_id, detail: { requisitionId: r.id, userId: r.requested_by, step: r.status } }, trx);
  });
  res.json({ requisition: await one(req.user, req.params.id) });
});

// The applicant corrects it (words, quantity, Amount @, total, add or remove a line). It goes on from the same step.
router.post('/:id/correct', requirePage('requisitions', 'f'), async (req, res) => {
  await signPre(req, 0);
  await db.transaction(async (trx) => {
    const r = await trx('requisitions').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!r || r.requested_by !== req.user.id) throw new HttpError(404, 'Requisition not found.');
    if (!r.returned || !SIGN_STEPS.includes(r.status)) throw new HttpError(409, `${r.number} was not sent back to you.`);
    const school = (await trx('schools').where({ id: r.school_id }).first('name'))?.name || '';
    const f = readForm(req.user, req.body, school, true);
    const old = await trx('requisition_lines').where({ requisition_id: r.id, removed: false }).orderBy('id');
    const by = new Map(old.map((l) => [l.id, l]));
    const said = [];
    const kept = new Set();
    for (const l of f.lines) {
      const o = l.id ? by.get(l.id) : null;
      if (l.id && !o) throw new HttpError(400, 'One of the lines is not on this requisition. Reload the page.');
      if (!o) { await trx('requisition_lines').insert({ requisition_id: r.id, item_name: l.item_name, qty: l.qty, est_cost: l.est_cost, line_total: l.line_total, added_by: req.user.id }); said.push(`added "${l.item_name}"`); continue; }
      kept.add(o.id);
      const edit = {};
      if (l.item_name !== o.item_name) { edit.item_name = l.item_name; said.push(`"${o.item_name}" → "${l.item_name}"`); }
      if (l.qty !== o.qty) { edit.qty = l.qty; edit.orig_qty = o.orig_qty ?? o.qty; said.push(`${l.item_name}: qty ${when(o.qty)} → ${when(l.qty)}`); }
      if (l.est_cost !== o.est_cost) { edit.est_cost = l.est_cost; said.push(`${l.item_name}: Amount @ ${when(o.est_cost)} → ${when(l.est_cost)}`); }
      if (l.line_total !== o.line_total) { edit.line_total = l.line_total; said.push(`${l.item_name}: total ${when(o.line_total)} → ${when(l.line_total)}`); }
      if (Object.keys(edit).length) await trx('requisition_lines').where({ id: o.id }).update(edit);
    }
    for (const o of old) if (!kept.has(o.id)) { await trx('requisition_lines').where({ id: o.id }).update({ removed: true, orig_qty: o.orig_qty ?? o.qty }); said.push(`took off "${o.item_name}"`); }
    if (f.department !== (r.department || school)) said.push(`department: ${f.department}`);
    if (f.applicant !== (r.applicant_name || req.user.full_name)) said.push(`applicant: ${f.applicant}`);
    await trx('requisitions').where({ id: r.id }).update({ purpose: f.purpose, department: f.department, applicant_name: f.applicant, needed_by: f.neededBy,
      returned: false, returned_by: null, returned_at: null, returned_note: null });
    await signStamp(trx, req, r.id, 'applicant', { allowSame: true, note: 'corrected' });
    const who = { acad: FIRST_NAME[r.kind], head: 'Head Master', store: 'store-keeper', check: 'Assistant Accountant', manager: 'Manager' }[r.status];
    await audit(req, `requisition.fixed_${r.status === 'acad' && r.kind === 'general' ? 'school' : r.status}`, `${r.number} corrected by ${req.user.full_name}${said.length ? `: ${said.join('; ')}` : ' (nothing changed)'}. Waiting for the ${who} again`,
      { schoolId: r.school_id, detail: { requisitionId: r.id } }, trx);
  });
  res.json({ requisition: await one(req.user, req.params.id) });
});

// The Manager may stop a requisition that is still with the school or the store-keeper (with a reason).
router.post('/:id/stop', requirePage('requisitions', 'f'), async (req, res) => {
  const note = clean(req.body?.note, 300);
  if (!MONEY_APPROVERS.includes(req.user.role)) throw new HttpError(403, 'Only the Manager or the Finance Manager can stop a requisition.');
  if (!note) throw new HttpError(400, 'Write why it is stopped, so the school knows.');
  await db.transaction(async (trx) => {
    const r = await trx('requisitions').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!r) throw new HttpError(404, 'Requisition not found.');
    if (!['acad', 'head', 'store', 'check'].includes(r.status)) throw new HttpError(409, `${r.number} is ${STATUS[r.status].toLowerCase()}.`);
    await reject(trx, req, r, note, 'Manager (stopped it)');
  });
  res.json({ requisition: await one(req.user, req.params.id) });
});

module.exports = router;
// The buyer says he will bring the money back (instead of going back to the market). The Cashier is told.
router.post('/:id/money-back/ask', requirePage('requisitions'), async (req, res) => {
  await db.transaction(async (trx) => {
    const r = await trx('requisitions').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!r) throw new HttpError(404, 'Requisition not found.');
    const view = (await one(req.user, r.id));
    if (!view.canAskMoneyBack) throw new HttpError(409, `${r.number}: the money cannot be given back now (only by the buyer, when nothing is being bought or was received).`);
    await trx('requisitions').where({ id: r.id }).update({ money_back_asked_at: trx.fn.now() });
    await audit(req, 'requisition.moneyback_ask', `${r.number}: ${req.user.full_name} will give the money back to the Cashier (TSh ${view.money.amount.toLocaleString('en-GB')}) instead of buying again`,
      { schoolId: r.school_id, detail: { requisitionId: r.id } }, trx);
  });
  res.json({ requisition: await one(req.user, req.params.id) });
});

// The Cashier records the money he received back and signs. The requisition is closed (nothing was bought).
router.post('/:id/money-back', requirePage('requisitions'), async (req, res) => {
  if (req.user.role !== 'cashier') throw new HttpError(403, 'The Cashier receives the money back.');
  const b = req.body || {};
  const amount = Number(String(b.amount ?? '').replace(/[,\s]/g, ''));
  const note = clean(b.note, 300) || null;
  if (!Number.isInteger(amount) || amount < 0) throw new HttpError(400, 'Write how much money you received back.');
  await signPre(req, Number(req.params.id) || 0, amount);
  await db.transaction(async (trx) => {
    const r = await trx('requisitions').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!r) throw new HttpError(404, 'Requisition not found.');
    const view = await one(req.user, r.id);
    if (!view.canReceiveMoneyBack) throw new HttpError(409, `${r.number}: there is no office money to receive back now.`);
    if (amount !== view.money.amount && !note) throw new HttpError(400, `The buyer was given TSh ${view.money.amount.toLocaleString('en-GB')}. Write a note why you received a different amount.`);
    await trx('requisitions').where({ id: r.id }).update({ status: 'closed', money_back_amount: amount, money_back_by: req.user.id, money_back_at: trx.fn.now(), money_back_note: note });
    await signStamp(trx, req, r.id, 'moneyback', { allowSame: true });
    await audit(req, 'requisition.moneyback', `${r.number}: the Cashier (${req.user.full_name}) received TSh ${amount.toLocaleString('en-GB')} back. Nothing was bought; the requisition is closed${note ? ` (${note})` : ''}`,
      { schoolId: r.school_id, detail: { requisitionId: r.id, userId: r.requested_by } }, trx);
  });
  res.json({ requisition: await one(req.user, req.params.id) });
});

module.exports.STATUS = STATUS;
