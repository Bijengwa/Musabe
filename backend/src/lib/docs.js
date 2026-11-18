// What each paper document says, as plain data: the thing that is hashed when somebody signs (lib/seal.js).
// Only the words, the quantities and the money. Things written for information only (what is left / used) are not sealed.
const db = require('../db');

async function requisition(k, id) {
  const r = await k('requisitions').where({ id }).first();
  if (!r) return null;
  const lines = await k('requisition_lines').where({ requisition_id: id }).orderBy('id');
  return { no: r.number, school: r.school_id, kind: r.kind, dept: r.department, who: r.applicant_name, by: r.requested_by,
    lines: lines.map((l) => [l.id, l.item_name, l.qty, l.est_cost, l.line_total, l.removed ? 1 : 0, l.approved_qty, l.approved_total]) };
}
async function voucher(k, id) {
  const p = await k('payment_requests').where({ id }).first();
  if (!p) return null;
  const lines = await k('payment_lines').where({ payment_id: id }).orderBy('sn');
  return { no: p.number, payee: p.payee_name, cheque: p.cheque_no, purpose: p.purpose, amount: Number(p.amount), by: p.requested_by, lines: lines.map((l) => [l.sn, l.detail, Number(l.amount)]) };
}
async function purchase(k, id) {
  const p = await k('purchases').where({ id }).first();
  if (!p) return null;
  const lines = await k('purchase_lines').where({ purchase_id: id }).orderBy('id');
  return { no: p.number, school: p.school_id, req: p.requisition_id, by: p.created_by, lines: lines.map((l) => [l.id, l.item_name, l.qty, Number(l.unit_cost)]) };
}
const CONTENT = { requisition, voucher, purchase };
const contentOf = (type, id, k = db) => (CONTENT[type] ? CONTENT[type](k, Number(id)) : null);

// The money of a document, for the "big amount needs an SMS code" rule.
async function amountOf(type, id, k = db) {
  if (type === 'requisition') {
    const [r] = await k('requisition_lines').where({ requisition_id: id, removed: false }).select(k.raw('coalesce(sum(coalesce(approved_total, line_total)), 0)::bigint as n'));
    return Number(r.n);
  }
  if (type === 'voucher') return Number((await k('payment_requests').where({ id }).first('amount'))?.amount || 0);
  if (type === 'purchase') return Number((await k('purchases').where({ id }).first('total'))?.total || 0);
  return 0;
}

const STEP = { applicant: 'Applicant', acad: 'First school signer', head: 'Head Master', store: 'Store-keeper', manager: 'Manager',
  prepared: 'Prepared by', authorized: 'Authorized by', payee: 'Payee', paid: 'Cashier', bought: 'Buyer', checked: 'Mapokezi', settled: 'Cashier (money back)', confirmed: 'Accountant office' };
module.exports = { contentOf, amountOf, STEP, requisition, voucher, purchase };
