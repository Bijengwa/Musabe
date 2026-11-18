// Barcodes, orders and purchases for a school (no main store), QR labels, issuing by scanning, returns, selling while
// out of stock, parent notices, ID photos and the weekly check.
// Runs only when TEST_DATABASE_URL points to a TEST database that is migrated and seeded. Never point it at real data.
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;

const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const { listen, request } = require('./helpers');
const { codeFor, parseCode } = require('../src/lib/codes');

const tag = `b${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const people = {};
let server, port, em, boys, rice, scope, student, socks, delivery;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body, cookie: people[who].cookie });
const lib = async (itemId, schoolId = em.id) => (await db('stock_levels').where({ school_id: schoolId, item_id: itemId }).first())?.qty || 0;

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  em = await db('schools').where({ code: 'pre' }).first();
  boys = await db('schools').where({ code: 'boys' }).first();
  const make = [['keeper', 'storekeeper', null], ['mapokezi', 'mapokezi', null], ['acc', 'acc', null], ['aacc', 'aacc', null], ['fm', 'fm', null], ['librarian', 'librarian', em.id], ['boysLib', 'librarian', boys.id],
    ['teacher', 'teacher', em.id], ['sadmin', 'sadmin', em.id], ['bursar', 'bursar', em.id]];
  for (const [key, role, school] of make) {
    const username = `t_${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: school, password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    people[key] = { id: u.id, cookie: cookie(r) };
  }
  const [c] = await db('classes').insert({ school_id: em.id, name: `CLASS ${tag}`, short_name: `C ${tag.slice(-4)}` }).returning('id');
  const [s] = await db('students').insert({ school_id: em.id, class_id: c.id, admission_no: `A${tag}`, first_name: 'NEEMA', last_name: tag.toUpperCase(), full_name: `NEEMA ${tag.toUpperCase()}`, sex: 'F' }).returning('id');
  student = s.id;
  socks = await db('items').where({ name: 'SOCKS' }).first();
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });

test('Codes: every kind of barcode is told apart', () => {
  assert.deepEqual(parseCode(' ms000123 '), { type: 'student', id: 123 });
  assert.deepEqual(parseCode(codeFor('copy', 7)), { type: 'copy', id: 7 });
  assert.deepEqual(parseCode('6001234567890'), { type: 'barcode', code: '6001234567890' });
  assert.equal(parseCode("x' or 1=1"), null);
});

test('Store-keeper adds things the school uses; never sees selling prices', { skip }, async () => {
  let r = await as('keeper', 'POST', '/api/store/items', { name: `rice ${tag}`, category: 'food', unit: 'kg' });
  assert.equal(r.status, 201); rice = r.json.item;
  assert.equal(rice.sellable, false); assert.equal(rice.code, codeFor('item', rice.id));
  r = await as('keeper', 'POST', '/api/store/items', { name: `microscope ${tag}`, category: 'laboratory', unit: 'pc', returnable: true });
  assert.equal(r.status, 201); scope = r.json.item; assert.equal(scope.returnable, true);
  assert.equal((await as('librarian', 'POST', '/api/store/items', { name: `x ${tag}`, category: 'food', unit: 'kg' })).status, 403);
  assert.equal((await as('keeper', 'POST', '/api/store/items', { name: `rice ${tag}`, category: 'food', unit: 'kg' })).status, 409);
  const items = await as('keeper', 'GET', '/api/items'); // he may pick an item, but the price is hidden (routes/items.js SEES_NO_PRICE)
  assert.equal(items.status, 200);
  assert.ok(!/"(price|boys|girls)":\s*\d/.test(JSON.stringify(items.json)), 'no selling prices for the store-keeper');
  assert.ok(!/"price/.test(JSON.stringify((await as('keeper', 'GET', '/api/store/items')).json)), 'no prices in the store list');
  assert.equal((await as('librarian', 'POST', '/api/stock/deliveries', { schoolId: em.id, lines: [{ itemId: rice.id, qty: 1 }] })).status, 403, 'only the administration store-keeper sends stock');
});

test('Order for a school: ordered → arrives and Mapokezi counts → accountant confirms → delivery to the library with QR labels', { skip }, async () => {
  const body = { schoolId: em.id, supplier: 'Mwanza Traders', invoiceNo: 'po-77', ordered: true, expectedOn: '2030-01-10',
    lines: [{ itemId: rice.id, qty: 500, unitCost: 2800 }, { itemId: scope.id, qty: 10, unitCost: 350000 }] };
  assert.equal((await as('acc', 'POST', '/api/purchases', body)).status, 403, 'the accountant does not write purchases');
  assert.equal((await as('keeper', 'POST', '/api/purchases', { ...body, schoolId: null })).status, 400, 'a purchase goes to one school');
  let r = await as('keeper', 'POST', '/api/purchases', body);
  assert.equal(r.status, 201); const p = r.json.purchase;
  assert.match(p.number, /^PUR\.\d{4}$/); assert.equal(p.ordered, true); assert.match(p.statusLabel, /Ordered/); assert.equal(p.school.id, em.id);
  assert.equal((await as('aacc', 'POST', `/api/purchases/${p.id}/decide`, { approve: true })).status, 409, 'the accountant waits for the count');
  assert.equal((await as('keeper', 'POST', `/api/purchases/${p.id}/check`, {})).status, 403, 'only Mapokezi counts');
  const micro = p.lines.find((l) => l.itemId === scope.id);
  assert.equal((await as('mapokezi', 'POST', `/api/purchases/${p.id}/check`, { lines: [{ lineId: micro.id, countedQty: 8 }] })).status, 400, 'fewer needs a note');
  r = await as('mapokezi', 'POST', `/api/purchases/${p.id}/check`, { lines: [{ lineId: micro.id, countedQty: 8, note: '2 not delivered' }] });
  assert.equal(r.status, 200); assert.equal(r.json.purchase.status, 'checked');
  assert.equal((await as('keeper', 'POST', `/api/purchases/${p.id}/decide`, { approve: true })).status, 403);
  r = await as('aacc', 'POST', `/api/purchases/${p.id}/decide`, { approve: true });
  assert.equal(r.status, 200); assert.equal(r.json.purchase.status, 'confirmed'); assert.match(r.json.purchase.delivery.number, /^DLV\./);
  delivery = r.json.purchase.delivery;
  assert.equal(await lib(rice.id), 0, 'stock goes up only when the librarian signs');
  // The store-keeper prints the QR labels: 8 pieces with their own code, the rice with the item code.
  r = await as('keeper', 'GET', `/api/store/delivery-labels/${delivery.id}`);
  assert.equal(r.status, 200);
  const sc = r.json.lines.find((l) => l.returnable); assert.equal(sc.labels.length, 8); assert.match(sc.labels[0].code, /^MC\d{6}$/); assert.equal(sc.labels[0].status, 'coming');
  assert.equal(r.json.lines.find((l) => !l.returnable).labels[0].count, 1, 'rice (kg): one label');
  assert.equal((await as('boysLib', 'GET', `/api/store/delivery-labels/${delivery.id}`)).status, 404);
  // The librarian checks and signs.
  r = await as('librarian', 'POST', `/api/stock/deliveries/${delivery.id}/confirm-all`, {});
  assert.equal(r.status, 200);
  assert.equal(await lib(rice.id), 500); assert.equal(await lib(scope.id), 8);
  assert.equal(Number((await db('item_copies').where({ item_id: scope.id, status: 'in', school_id: em.id }).count('* as n'))[0].n), 8);
  await assert.rejects(db('purchases').where({ id: p.id }).update({ total: 1 }), /already decided/);
  // An order that never comes: the one who wrote it cancels it.
  r = await as('keeper', 'POST', '/api/purchases', { ...body, lines: [{ itemId: rice.id, qty: 5, unitCost: 1 }] });
  assert.equal(r.json.purchase.canCancel, true);
  assert.equal((await as('keeper', 'POST', `/api/purchases/${r.json.purchase.id}/decide`, { approve: false, note: 'shop has none' })).json.purchase.status, 'rejected');
});

test('Issue in the library: food to the kitchen by quantity; pieces to a person by scanning; return', { skip }, async () => {
  assert.equal((await as('keeper', 'POST', '/api/store/issues', { toKind: 'dept', toName: 'Kitchen', lines: [{ itemId: rice.id, qty: 1 }] })).status, 403, 'only the librarian gives out');
  let r = await as('librarian', 'GET', `/api/store/scan?code=${rice.code}`);
  assert.equal(r.json.found.type, 'item'); assert.equal(r.json.found.qty, 500);
  r = await as('librarian', 'POST', '/api/store/issues', { toKind: 'dept', toName: 'Kitchen', lines: [{ itemId: rice.id, qty: 60 }], key: `iss1${tag}` });
  assert.equal(r.status, 201); assert.equal(await lib(rice.id), 440);
  assert.equal((await as('librarian', 'POST', '/api/store/issues', { toKind: 'dept', toName: 'Kitchen', lines: [{ itemId: rice.id, qty: 60 }], key: `iss1${tag}` })).json.repeated, true);
  assert.equal((await as('librarian', 'POST', '/api/store/issues', { toKind: 'dept', toName: 'Kitchen', lines: [{ itemId: rice.id, qty: 9999 }] })).status, 409, 'not more than the stock');
  const [c1, c2] = await db('item_copies').where({ item_id: scope.id, status: 'in' }).orderBy('id').limit(2);
  r = await as('librarian', 'POST', '/api/store/issues', { toKind: 'student', studentId: student, lines: [{ copyId: c1.id }, { copyId: c2.id }] });
  assert.equal(r.status, 201); assert.equal(await lib(scope.id), 6);
  assert.equal((await as('boysLib', 'POST', '/api/store/issues', { toKind: 'student', studentId: student, lines: [{ copyId: c1.id }] })).status, 404);
  r = await as('librarian', 'GET', `/api/store/scan?code=${codeFor('student', student)}`);
  assert.equal(r.json.found.holding.length, 2); assert.equal(r.json.found.card, null, 'ID card not issued yet');
  assert.equal((await as('librarian', 'POST', '/api/store/returns', { copyId: c1.id })).status, 200);
  assert.equal(await lib(scope.id), 7);
  r = await as('librarian', 'POST', '/api/store/returns', { copyId: c2.id, condition: 'lost', note: 'lost on the way home' });
  assert.equal(r.status, 200); assert.equal(await lib(scope.id), 7);
  // The parents' app gets a notice for each thing the child received or returned.
  const kinds = await db('parent_notices').where({ student_id: student }).pluck('kind');
  assert.ok(kinds.includes('issued') && kinds.includes('returned'));
});

test('Sell while the library has none: allowed with a notice; the librarian cannot give until it arrives', { skip }, async () => {
  const free = (await as('bursar', 'GET', '/api/receipts/availability')).json.free;
  assert.ok(Number.isInteger(free[socks.id]) && free[socks.id] <= await lib(socks.id), 'stock less what is paid and not collected');
  let r = await as('bursar', 'POST', '/api/receipts', { studentId: student, method: 'cash', lines: [{ itemId: socks.id, qty: Math.min(500, (await lib(socks.id)) + 2) }], key: `sell${tag}x1` });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const rec = r.json.receipt;
  assert.equal(rec.lines[0].outOfStock, true);
  const n = await db('parent_notices').where({ student_id: student, kind: 'receipt' }).first();
  assert.match(n.body, /when it arrives/);
  r = await as('librarian', 'POST', `/api/receipts/${rec.id}/give`, { lines: [{ lineId: rec.lines[0].id, qty: rec.lines[0].qty }] });
  assert.equal(r.status, 409, 'cannot give what is not in stock');
  // Give finds the student's waiting receipts by the scanned ID.
  r = await as('librarian', 'GET', `/api/receipts?student=${student}&status=open`);
  assert.ok(r.json.receipts.some((x) => x.id === rec.id));
});

test('Weekly check by the librarian; the accountant confirms; ledger of the school', { skip }, async () => {
  assert.equal((await as('keeper', 'POST', '/api/counts', { category: 'food', lines: [{ itemId: rice.id, counted: 1 }] })).status, 403, 'the store-keeper has no store to count');
  let r = await as('librarian', 'POST', '/api/counts', { category: 'food', lines: [{ itemId: rice.id, counted: 435, note: 'one bag torn' }] });
  assert.equal(r.status, 201); const c = r.json.count; assert.equal(c.lines[0].system, null);
  r = await as('acc', 'POST', `/api/counts/${c.id}/decide`, { approve: true, note: 'bag torn, 5 kg lost' });
  assert.equal(r.status, 200); assert.equal(await lib(rice.id), 435);
  assert.equal((await as('acc', 'GET', '/api/counts/ledger?category=food')).status, 400, 'administration chooses a school');
  r = await as('acc', 'GET', `/api/counts/ledger?school=${em.id}&category=food`);
  const row = r.json.rows.find((x) => x.itemId === rice.id);
  assert.deepEqual([row.received, row.issued, row.corrected, row.closing, row.counted], [500, 60, -5, 435, 435]);
});

test('Items to issue from Excel; ID photo', { skip }, async () => {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Items');
  ws.addRow(['S/N', 'Item', 'Category', 'Unit', 'Comes back']);
  ws.addRow([1, `KISWAHILI STD 5 ${tag}`, 'Book', 'pc', 'Yes']); ws.addRow([2, `CHALK ${tag}`, 'Stationery', 'boxes', 'No']); ws.addRow([3, `rice ${tag}`, 'Food', 'kg', 'No']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const up = (who, b) => fetch(`http://127.0.0.1:${port}/api/store/items/import`, { method: 'POST', headers: { Cookie: people[who].cookie, 'Content-Type': 'application/octet-stream' }, body: b })
    .then(async (x) => ({ status: x.status, json: await x.json() }));
  assert.equal((await up('librarian', buf)).status, 403);
  let r = await up('keeper', buf);
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.added, 2); assert.equal(r.json.already, 1);
  assert.equal((await db('items').whereRaw('lower(name) = ?', [`kiswahili std 5 ${tag}`]).first()).returnable, true);
  const bad = new ExcelJS.Workbook(); bad.addWorksheet('x').addRow(['Item', 'Category', 'Unit']); bad.worksheets[0].addRow([`X ${tag}`, 'Toys', 'pc']);
  r = await up('keeper', Buffer.from(await bad.xlsx.writeBuffer()));
  assert.equal(r.status, 400); assert.match(r.json.mistakes[0], /category/);
  // A tiny real JPEG as the photo.
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  const img = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  assert.equal((await as('librarian', 'POST', `/api/idcards/photo/student/${student}`, { image: img })).status, 403);
  assert.equal((await as('sadmin', 'POST', `/api/idcards/photo/student/${student}`, { image: 'data:image/jpeg;base64,AAAA' })).status, 400);
  assert.equal((await as('sadmin', 'POST', `/api/idcards/photo/student/${student}`, { image: img })).status, 200);
  r = await fetch(`http://127.0.0.1:${port}/api/idcards/photo/student/${student}`, { headers: { Cookie: people.sadmin.cookie } });
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/idcards/photo/student/${student}`, { headers: { Cookie: people.boysLib.cookie } })).status, 404);
  assert.ok((await as('sadmin', 'GET', `/api/idcards/student/${student}`)).json.holder.photo > 0);
});

test('Home and notifications work for the store-keeper', { skip }, async () => {
  assert.equal((await as('keeper', 'GET', '/api/dashboard')).status, 200);
  const r = await as('acc', 'GET', '/api/notifications');
  // The bell shows only the latest 30 and other test files add notices at the same time, so look at the record, not at the list.
  assert.equal(r.status, 200); assert.ok(Array.isArray(r.json.items));
  assert.ok(await db('audit_log').whereILike('summary', 'PUR.%').first(), 'purchases are written in the activity log that feeds the bell');
});
