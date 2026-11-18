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
    ['teacher', 'teacher', em.id], ['keeper', 'storekeeper', null], ['cashier', 'cashier', null], ['mapokezi', 'mapokezi', null], ['manager', 'manager', null], ['acc', 'acc', null],
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

test('Requisition: Academic Master → Head Master → store-keeper → Manager → Cashier float → bought → Mapokezi → accountant → librarian', { skip }, async () => {
  const body = { department: 'Academic', lines: [line('Chalk white boxes', 20, 3000), line('Marker pens blue', 10, 12000)] };
  assert.equal((await as('acad', 'POST', '/api/requisitions', { lines: [] })).status, 400, 'an empty form is refused');
  assert.equal((await as('keeper', 'POST', '/api/requisitions', body)).status, 403, 'only the school staff write requisitions');
  // A teacher may ask: it goes to the Academic Master first.
  let r = await as('teacher', 'POST', '/api/requisitions', body);
  assert.equal(r.status, 201, JSON.stringify(r.json)); assert.equal(r.json.requisition.status, 'acad');
  assert.equal((await as('teacher', 'POST', `/api/requisitions/${r.json.requisition.id}/withdraw`, {})).json.requisition.status, 'withdrawn');
  r = await as('acad', 'POST', '/api/requisitions', body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const q = r.json.requisition; assert.match(q.number, /^RQN\.\d{4}$/);
  assert.equal(q.status, 'head', 'the Academic Master wrote it, so his signature is already on it');
  assert.equal(q.total, 20 * 3000 + 10 * 12000);
  // Order of signatures is enforced.
  assert.equal((await as('manager', 'POST', `/api/requisitions/${q.id}/manager`, { approve: true })).status, 409);
  assert.equal((await as('keeper', 'POST', `/api/requisitions/${q.id}/store`, { approve: true })).status, 409);
  assert.equal((await as('bHead', 'POST', `/api/requisitions/${q.id}/head`, { approve: true })).status, 404, "another school's Head Master");
  assert.equal((await as('head', 'POST', `/api/requisitions/${q.id}/head`, { approve: false })).status, 400, 'rejecting needs a reason');
  assert.equal((await as('head', 'POST', `/api/requisitions/${q.id}/head`, { approve: true, pin: '0000' })).status, 403, 'a wrong PIN signs nothing');
  r = await as('head', 'POST', `/api/requisitions/${q.id}/head`, { approve: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.requisition.status, 'store'); assert.match(r.json.requisition.signs.head.by, /head/); assert.ok(r.json.requisition.signs.head.image, 'the drawn signature is on the paper');
  assert.equal(r.json.requisition.seal.status, 'valid');
  assert.equal((await as('acad', 'POST', `/api/requisitions/${q.id}/withdraw`, {})).status, 409, 'too late to withdraw');
  r = await as('keeper', 'POST', `/api/requisitions/${q.id}/store`, { approve: true });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.requisition.status, 'manager');
  // The Manager gives fewer markers: a note is needed.
  const marker = r.json.requisition.lines.find((l) => /Marker/.test(l.item));
  assert.equal((await as('manager', 'POST', `/api/requisitions/${q.id}/manager`, { approve: true, lines: [{ lineId: marker.id, approvedQty: 6 }] })).status, 400, 'fewer needs a note');
  r = await as('manager', 'POST', `/api/requisitions/${q.id}/manager`, { approve: true, note: 'six are enough', lines: [{ lineId: marker.id, approvedQty: 6 }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.requisition.status, 'approved'); assert.equal(r.json.requisition.total, 20 * 3000 + 6 * 12000);
  const money = r.json.requisition.money;
  assert.equal(money.amount, 20 * 3000 + 6 * 12000, 'the system made the money for the Cashier');
  // The Cashier gives exactly that amount; the buyer signs for it.
  const PNG = `data:image/png;base64,${'A'.repeat(1200)}`;
  r = await as('cashier', 'POST', `/api/payments/${money.id}/decide`, { approve: true, payeeName: 'STORE KEEPER', payeeImage: PNG });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.payment.status, 'paid');
  // Buy it for the requisition: the store-keeper buys, Mapokezi counts, the accountant confirms.
  const [pen] = await db('items').insert({ name: `MARKER PEN ${tag}`.toUpperCase(), category: 'stationery', unit: 'box', sellable: false }).returning('*');
  r = await as('keeper', 'POST', '/api/purchases', { supplier: 'Nyanza Stationery', requisitionId: q.id, lines: [{ itemId: chalk.id, qty: 20, unitCost: 3000 }, { itemId: pen.id, qty: 6, unitCost: 12000 }] });
  assert.equal(r.status, 201, JSON.stringify(r.json)); const pid = r.json.purchase.id;
  assert.equal((await as('acad', 'GET', `/api/requisitions/${q.id}`)).json.requisition.status, 'buying');
  assert.equal((await as('mapokezi', 'POST', `/api/purchases/${pid}/check`, {})).status, 200);
  assert.equal((await as('acc', 'POST', `/api/purchases/${pid}/decide`, { approve: true })).status, 200);
  // Confirmed: it goes straight to the school's library.
  r = await as('acad', 'GET', `/api/requisitions/${q.id}`);
  assert.equal(r.json.requisition.status, 'sent'); assert.match(r.json.requisition.delivery.number, /^DLV\./);
  const dlv = r.json.requisition.delivery;
  await as('librarian', 'POST', `/api/stock/deliveries/${dlv.id}/confirm-all`, {});
  assert.equal(await lib(chalk.id), 20);
  r = await as('acad', 'GET', `/api/requisitions/${q.id}`);
  assert.equal(r.json.requisition.status, 'done');
  assert.equal(r.json.requisition.seal.status, 'valid', 'the seal still holds after the whole life of the paper');
  await assert.rejects(db('requisitions').where({ id: q.id }).update({ status: 'head' }), /finished/);
  assert.ok(JSON.stringify((await as('acad', 'GET', '/api/notifications')).json).includes(q.number), 'the Academic Master follows the requisition');
  // Lists: other schools do not see it.
  assert.ok(!(await as('bHead', 'GET', '/api/requisitions')).json.requisitions.some((x) => x.id === q.id));
});

test('Requisition written by the Head Master starts signed by him', { skip }, async () => {
  const r = await as('head', 'POST', '/api/requisitions', { lines: [line('Staff room supplies', 3, 1000)] });
  assert.equal(r.status, 201, JSON.stringify(r.json)); assert.equal(r.json.requisition.status, 'store'); assert.match(r.json.requisition.signs.head.by, /head/);
});

test('Requisition: sent back to the applicant, corrected, rejected by the Manager', { skip }, async () => {
  let r = await as('acad', 'POST', '/api/requisitions', { lines: [line('Reams for exams', 2, 20000)] });
  const a = r.json.requisition;
  assert.equal((await as('head', 'POST', `/api/requisitions/${a.id}/return`, {})).status, 400, 'sending back needs a reason');
  r = await as('head', 'POST', `/api/requisitions/${a.id}/return`, { note: 'We need 3 reams, not 2' });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.ok(r.json.requisition.returned);
  assert.equal((await as('head', 'POST', `/api/requisitions/${a.id}/head`, { approve: true })).status, 409, 'nobody signs until it is corrected');
  r = await as('acad', 'POST', `/api/requisitions/${a.id}/correct`, { lines: [{ ...line('Reams for exams', 3, 20000), lineId: a.lines[0].id }] });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.requisition.returned, null);
  assert.equal(r.json.requisition.total, 60000);
  r = await as('head', 'POST', `/api/requisitions/${a.id}/head`, { approve: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await as('keeper', 'POST', `/api/requisitions/${a.id}/store`, { approve: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await as('manager', 'POST', `/api/requisitions/${a.id}/manager`, { approve: false, note: 'Use what the library has' });
  assert.equal(r.json.requisition.status, 'rejected'); assert.match(r.json.requisition.rejected.reason, /library/);
  // The home "To do" shows the work of each signer.
  await as('acad', 'POST', '/api/requisitions', { lines: [line('Pencils', 10, 200)] });
  assert.ok((await as('head', 'GET', '/api/dashboard')).json.todo.some((t) => /requisitions to sign/.test(t.label)));
  assert.ok((await as('sadmin', 'GET', '/api/dashboard')).json.todo.some((t) => /ID card/.test(t.label)));
});
