// ID cards (issued / not issued) and school requisitions (Academic Master -> Head Master -> store-keeper -> Manager
// -> buy (two store-keepers + accountant) -> send -> librarian). Needs TEST_DATABASE_URL (a TEST database).
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;

const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const { listen, request } = require('./helpers');

const tag = `q${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const P = {};
let server, port, em, boys, student, chalk;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const PIN = '2468';
const PNG = `data:image/png;base64,${'A'.repeat(1200)}`;
// Signing needs the signing PIN (lib/seal.js): every POST carries it.
const as = (who, method, path, body) => request({ port, method, path, body: method === 'POST' && body && typeof body === 'object' ? { pin: PIN, ...body } : body, cookie: P[who].cookie });
const lib = async (itemId) => (await db('stock_levels').where({ school_id: em.id, item_id: itemId }).first())?.qty || 0;

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  em = await db('schools').where({ code: 'pre' }).first();
  boys = await db('schools').where({ code: 'boys' }).first();
  const make = [['super', 'super', null], ['sadmin', 'sadmin', em.id], ['bSadmin', 'sadmin', boys.id], ['acad', 'acad', em.id], ['head', 'head', em.id], ['bHead', 'head', boys.id],
    ['teacher', 'teacher', em.id], ['keeper', 'storekeeper', null], ['cashier', 'cashier', null], ['mapokezi', 'mapokezi', null], ['manager', 'manager', null], ['acc', 'acc', null], ['aacc', 'aacc', null],
    ['librarian', 'librarian', em.id], ['bursar', 'bursar', em.id]];
  for (const [key, role, school] of make) {
    const username = `r_${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: school, password_hash: await bcrypt.hash(password, 4), must_change_password: false, phone: '0712000000', signature_image: PNG, signing_pin_hash: await bcrypt.hash(PIN, 4) }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id, cookie: cookie(r) };
  }
  const [c] = await db('classes').insert({ school_id: em.id, name: `CLASS ${tag}`, short_name: `R ${tag.slice(-4)}` }).returning('id');
  [{ id: student }] = await db('students').insert({ school_id: em.id, class_id: c.id, admission_no: `R${tag}`, first_name: 'JOY', last_name: tag.toUpperCase(), full_name: `JOY ${tag.toUpperCase()}`, sex: 'F' }).returning('id');
  [chalk] = await db('items').insert({ name: `CHALK ${tag}`.toUpperCase(), category: 'stationery', unit: 'box', sellable: false }).returning('*');
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });

test('ID card: not issued, then the School Admin records it; others cannot; lost then card 2', { skip }, async () => {
  let r = await as('sadmin', 'GET', `/api/idcards/student/${student}`);
  assert.equal(r.status, 200); assert.equal(r.json.issued, false); assert.equal(r.json.canIssue, true); assert.match(r.json.holder.code, /^MS\d{6}$/);
  assert.equal((await as('bSadmin', 'GET', `/api/idcards/student/${student}`)).status, 404, 'another school cannot see it');
  assert.equal((await as('bSadmin', 'POST', '/api/idcards/issue', { kind: 'student', id: student })).status, 404);
  assert.equal((await as('head', 'POST', '/api/idcards/issue', { kind: 'student', id: student })).status, 403, 'the Head Master only views');
  assert.equal((await as('librarian', 'POST', '/api/idcards/issue', { kind: 'student', id: student })).status, 403);
  r = await as('sadmin', 'POST', '/api/idcards/issue', { kind: 'student', id: student });
  assert.equal(r.status, 200); assert.equal(r.json.issued, 1);
  assert.equal((await as('sadmin', 'POST', '/api/idcards/issue', { kind: 'student', id: student })).status, 409, 'one card at a time');
  r = await as('head', 'GET', `/api/idcards/student/${student}`);
  assert.equal(r.json.issued, true); assert.equal(r.json.current.no, 1); assert.match(r.json.current.issuedBy, /sadmin/); assert.equal(r.json.canIssue, false);
  assert.equal((await as('sadmin', 'POST', `/api/idcards/${r.json.current.id}/close`, { reason: 'lost' })).status, 400, 'lost needs a note');
  assert.equal((await as('sadmin', 'POST', `/api/idcards/${r.json.current.id}/close`, { reason: 'lost', note: 'lost on the bus' })).status, 200);
  r = await as('sadmin', 'GET', `/api/idcards/student/${student}`);
  assert.equal(r.json.issued, false); assert.equal(r.json.cards[0].endReason, 'lost');
  await as('sadmin', 'POST', '/api/idcards/issue', { kind: 'student', id: student });
  r = await as('sadmin', 'GET', `/api/idcards/student/${student}`);
  assert.equal(r.json.current.no, 2);
  await assert.rejects(db('id_cards').where({ student_id: student }).del(), /never deleted|permission denied/);
  await assert.rejects(db('id_cards').where({ student_id: student, card_no: 1 }).update({ end_reason: null, ended_at: null }), /already closed/);
  // Staff: own card visible to the person; issued by the School Admin of the school; administration staff by the Super Admin.
  r = await as('teacher', 'GET', '/api/idcards/me');
  assert.equal(r.json.issued, false); assert.equal(r.json.canIssue, false); assert.match(r.json.holder.code, /^MU/);
  assert.equal((await as('sadmin', 'POST', '/api/idcards/issue', { kind: 'staff', ids: [P.teacher.id, P.librarian.id] })).json.issued, 2);
  assert.equal((await as('teacher', 'GET', '/api/idcards/me')).json.issued, true);
  assert.equal((await as('sadmin', 'POST', '/api/idcards/issue', { kind: 'staff', id: P.keeper.id })).status, 404, 'administration staff are not the School Admin\'s');
  assert.equal((await as('super', 'POST', '/api/idcards/issue', { kind: 'staff', id: P.keeper.id })).status, 200);
  assert.equal((await as('sadmin', 'POST', '/api/idcards/issue', { kind: 'staff', id: P.sadmin.id })).status, 403, 'nobody records their own card');
  // The ID card list shows the state; scanning shows it too.
  r = await as('sadmin', 'GET', '/api/store/cards?kind=student');
  assert.ok(r.json.cards.find((c) => c.id === student).issued);
  r = await as('librarian', 'GET', `/api/store/scan?code=MU${String(P.teacher.id).padStart(6, '0')}`);
  assert.equal(r.json.found.card.no, 1);
  assert.ok(JSON.stringify((await as('teacher', 'GET', '/api/notifications')).json).includes('ID card'), 'the teacher is told');
});

// The paper PAYMENT REQUISITION FORM: free words (Details, Qty, Amount @, Total), signed in order with the signing PIN.
const line = (name, qty, estCost, total) => ({ name, qty, estCost, total });

test('Requisition (2026-11-20): store-keeper writes → Manager → Cashier float → bought → Mapokezi → Cashier money back → librarian', { skip }, async () => {
  const body = { schoolId: em.id, department: 'Academic', lines: [line('Chalk white boxes', 20, 3000), line('Marker pens blue', 10, 12000)] };
  assert.equal((await as('keeper', 'POST', '/api/requisitions', { schoolId: em.id, lines: [] })).status, 400, 'an empty form is refused');
  for (const who of ['acad', 'teacher', 'head', 'librarian', 'bursar']) assert.equal((await as(who, 'POST', '/api/requisitions', body)).status, 403, `${who} uses the Order Book`);
  let r = await as('keeper', 'POST', '/api/requisitions', body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const q = r.json.requisition; assert.match(q.number, /^RQN\.\d{4}$/);
  assert.equal(q.status, 'check', 'the buyer signs the store-keeper step himself; the Assistant Accountant checks next (2026-11-21)');
  assert.equal(q.total, 20 * 3000 + 10 * 12000);
  assert.equal((await as('manager', 'POST', `/api/requisitions/${q.id}/manager`, { approve: true })).status, 409, 'the Manager waits for the Assistant Accountant');
  assert.equal((await as('keeper', 'POST', `/api/requisitions/${q.id}/check`, { approve: true })).status, 403);
  r = await as('aacc', 'POST', `/api/requisitions/${q.id}/check`, { approve: true, note: 'prices as on the proforma' });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.requisition.status, 'manager'); assert.equal(r.json.requisition.signs.check.by, `Test aacc ${tag}`);
  assert.equal((await as('manager', 'POST', `/api/requisitions/${q.id}/manager`, { approve: true, pin: '0000' })).status, 403, 'a wrong PIN signs nothing');
  // The Manager gives fewer markers: a note is needed.
  const marker = q.lines.find((l) => /Marker/.test(l.item));
  assert.equal((await as('manager', 'POST', `/api/requisitions/${q.id}/manager`, { approve: true, lines: [{ lineId: marker.id, approvedQty: 6 }] })).status, 400, 'fewer needs a note');
  r = await as('manager', 'POST', `/api/requisitions/${q.id}/manager`, { approve: true, note: 'six are enough', lines: [{ lineId: marker.id, approvedQty: 6 }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.requisition.status, 'approved'); assert.equal(r.json.requisition.total, 20 * 3000 + 6 * 12000);
  assert.equal(r.json.requisition.seal.status, 'valid');
  const money = r.json.requisition.money;
  assert.equal(money.amount, 20 * 3000 + 6 * 12000, 'the system made the money for the Cashier');
  r = await as('cashier', 'POST', `/api/payments/${money.id}/decide`, { approve: true, payeeName: 'STORE KEEPER', payeeImage: PNG });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.payment.status, 'paid');
  const [pen] = await db('items').insert({ name: `MARKER PEN ${tag}`.toUpperCase(), category: 'stationery', unit: 'box', sellable: false }).returning('*');
  r = await as('keeper', 'POST', '/api/purchases', { supplier: 'Nyanza Stationery', requisitionId: q.id, lines: [{ itemId: chalk.id, qty: 20, unitCost: 3000 }, { itemId: pen.id, qty: 6, unitCost: 11000 }] });
  assert.equal(r.status, 201, JSON.stringify(r.json)); const pid = r.json.purchase.id;
  assert.equal((await as('manager', 'GET', `/api/requisitions/${q.id}`)).json.requisition.status, 'buying');
  assert.equal((await as('mapokezi', 'POST', `/api/purchases/${pid}/check`, {})).status, 200);
  assert.equal((await as('acc', 'POST', `/api/purchases/${pid}/decide`, { approve: true, returnedAmount: 6000 })).status, 403, 'the Head Accountant only audits');
  assert.equal((await as('cashier', 'POST', `/api/purchases/${pid}/decide`, { approve: true, method: 'cash', returnedAmount: 6000 })).status, 409, 'the Assistant Accountant and the Manager approve first (2026-11-25)');
  assert.equal((await as('aacc', 'POST', `/api/purchases/${pid}/acheck`, { approve: true })).status, 200);
  assert.equal((await as('manager', 'POST', `/api/purchases/${pid}/approve`, { approve: true })).status, 200);
  assert.equal((await as('cashier', 'POST', `/api/purchases/${pid}/decide`, { approve: true, returnedAmount: 6000 })).status, 400, 'the voucher says cash or cheque');
  r = await as('cashier', 'POST', `/api/purchases/${pid}/decide`, { approve: true, method: 'cash', returnedAmount: 6000 });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.purchase.toSend, true, 'confirming does not send (2026-11-21)');
  assert.equal((await as('manager', 'GET', `/api/requisitions/${q.id}`)).json.requisition.status, 'arrived');
  assert.equal((await as('cashier', 'POST', `/api/purchases/${pid}/send`, {})).status, 403, 'only the store-keeper sends');
  r = await as('keeper', 'POST', `/api/purchases/${pid}/send`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.match(r.json.purchase.delivery.number, /^DLV\./);
  assert.equal((await as('keeper', 'POST', `/api/purchases/${pid}/send`, {})).status, 409, 'sent once');
  r = await as('manager', 'GET', `/api/requisitions/${q.id}`);
  assert.equal(r.json.requisition.status, 'sent'); assert.match(r.json.requisition.delivery.number, /^DLV\./);
  await as('librarian', 'POST', `/api/stock/deliveries/${r.json.requisition.delivery.id}/confirm-all`, {});
  assert.equal(await lib(chalk.id), 20);
  r = await as('manager', 'GET', `/api/requisitions/${q.id}`);
  assert.equal(r.json.requisition.status, 'done');
  await assert.rejects(db('requisitions').where({ id: q.id }).update({ status: 'manager' }), /finished/);
  assert.equal((await as('bHead', 'GET', '/api/requisitions')).status, 403, 'school staff do not see requisitions (they use the Order Book)');
});

test('Requisition: sent back to the buyer, corrected, rejected by the Manager', { skip }, async () => {
  let r = await as('keeper', 'POST', '/api/requisitions', { schoolId: em.id, lines: [line('Reams for exams', 2, 20000)] });
  const a = r.json.requisition;
  assert.equal((await as('aacc', 'POST', `/api/requisitions/${a.id}/return`, {})).status, 400, 'sending back needs a reason');
  r = await as('aacc', 'POST', `/api/requisitions/${a.id}/return`, { note: 'We need 3 reams, not 2' });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.ok(r.json.requisition.returned);
  assert.equal((await as('aacc', 'POST', `/api/requisitions/${a.id}/check`, { approve: true })).status, 409, 'nobody signs until it is corrected');
  r = await as('keeper', 'POST', `/api/requisitions/${a.id}/correct`, { lines: [{ ...line('Reams for exams', 3, 20000), lineId: a.lines[0].id }] });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.requisition.returned, null);
  assert.equal(r.json.requisition.total, 60000);
  assert.equal((await as('aacc', 'POST', `/api/requisitions/${a.id}/check`, { approve: true })).status, 200);
  r = await as('manager', 'POST', `/api/requisitions/${a.id}/manager`, { approve: false, note: 'Use what the library has' });
  assert.equal(r.json.requisition.status, 'rejected'); assert.match(r.json.requisition.rejected.reason, /library/);
  await as('keeper', 'POST', '/api/requisitions', { schoolId: em.id, lines: [line('Pencils', 10, 200)] });
  assert.ok((await as('aacc', 'GET', '/api/dashboard')).json.todo.some((t) => /requisitions to check/.test(t.label)));
  assert.ok((await as('sadmin', 'GET', '/api/dashboard')).json.todo.some((t) => /ID card/.test(t.label)));
});
