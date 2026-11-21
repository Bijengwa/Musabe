// Office buying (2026-11-21): suppliers, price lists, LPO, credit and supplier debts, goods without a receipt,
// Summary of Daily Goods Received, work agreements (Makubaliano) and vehicles.
// Runs only when TEST_DATABASE_URL points to a TEST database that is migrated and seeded. Never point it at real data.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');

const URL = process.env.TEST_DATABASE_URL;
const skip = !URL && 'set TEST_DATABASE_URL to run database tests';
if (URL) process.env.DATABASE_URL = URL;

const app = URL ? require('../src/server') : null;
const db = URL ? require('../src/db') : null;
const { listen, request } = require('./helpers');

const tag = `o${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const PIN = '2468';
const PNG = `data:image/png;base64,${'A'.repeat(1200)}`;
const P = {};
let server, port, em, item, sup;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body: method === 'POST' && body && typeof body === 'object' ? { pin: PIN, ...body } : body, cookie: P[who].cookie });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
function raw(who, path, buf) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path, headers: { Cookie: P[who].cookie, 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(t || '{}') }));
    });
    req.on('error', reject); req.end(buf);
  });
}

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  em = await db('schools').where({ code: 'pre' }).first();
  const make = [['keeper', 'storekeeper', null], ['amanager', 'amanager', null], ['mapokezi', 'mapokezi', null], ['acc', 'acc', null], ['aacc', 'aacc', null], ['fm', 'fm', null],
    ['manager', 'manager', null], ['director', 'director', null], ['cashier', 'cashier', null], ['librarian', 'librarian', em.id], ['bursar', 'bursar', em.id]];
  for (const [key, role, school] of make) {
    const username = `of_${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: school, password_hash: await bcrypt.hash(password, 4), must_change_password: false,
      phone: '0712000000', signature_image: PNG, signing_pin_hash: await bcrypt.hash(PIN, 4) }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id, cookie: cookie(r) };
  }
  [item] = await db('items').insert({ name: `CEMENT ${tag}`.toUpperCase(), unit: 'bag', category: 'equipment', active: true, sellable: false }).returning('*');
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });

test('Suppliers and price lists: procurement keeps them, with the photo of the paper', { skip }, async () => {
  assert.equal((await as('bursar', 'GET', '/api/suppliers')).status, 403);
  assert.equal((await as('mapokezi', 'POST', '/api/suppliers', { name: 'X' })).status, 403);
  let r = await as('amanager', 'POST', '/api/suppliers', { name: `Mwanza Hardware ${tag}`, phone: '754123456', terms: 'monthly', termsNote: 'pay by the 5th' });
  assert.equal(r.status, 400, 'a 9-digit phone is refused');
  r = await as('amanager', 'POST', '/api/suppliers', { name: `Mwanza Hardware ${tag}`, phone: '0754123456', terms: 'monthly', termsNote: 'pay by the 5th' });
  assert.equal(r.status, 201, JSON.stringify(r.json)); sup = r.json.supplier;
  assert.equal(sup.termsLabel, 'Monthly');
  assert.equal((await as('keeper', 'POST', '/api/suppliers', { name: `mwanza hardware ${tag}` })).status, 409);
  r = await as('keeper', 'POST', '/api/suppliers/price-lists', { supplierId: sup.id, kind: 'proforma', refNo: 'PF-881', lines: [{ item: 'Cement 50kg', unit: 'bag', price: 18500 }, { item: 'Nails 3"', unit: 'kg', price: '4,000' }] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const pl = r.json.priceList; assert.match(pl.number, /^PRL\.\d{4}$/); assert.equal(pl.lines[1].price, 4000);
  assert.equal((await raw('keeper', `/api/suppliers/price-lists/${pl.id}/file`, Buffer.from('not a picture'))).status, 400);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
  assert.equal((await raw('amanager', `/api/suppliers/price-lists/${pl.id}/file`, jpg)).status, 403, 'only the one who entered it');
  assert.equal((await raw('keeper', `/api/suppliers/price-lists/${pl.id}/file`, jpg)).status, 200);
  assert.equal((await raw('keeper', `/api/suppliers/price-lists/${pl.id}/file`, jpg)).status, 409, 'never replaced');
  await assert.rejects(db('price_lists').where({ id: pl.id }).del(), 'never deleted');
});

test('Requisition: the Assistant Accountant checks against the price list before the Manager', { skip }, async () => {
  const pl = (await as('amanager', 'GET', `/api/suppliers/price-lists/pick?supplier=${sup.id}`)).json.priceLists[0];
  let r = await as('amanager', 'POST', '/api/requisitions', { schoolId: em.id, priceListId: pl.id, lines: [{ name: 'Cement 50kg', qty: 10, estCost: 18500 }] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const q = r.json.requisition;
  assert.equal(q.status, 'check'); assert.equal(q.priceList.number, pl.number); assert.equal(q.waiting.role, 'Assistant Accountant');
  assert.ok((await as('aacc', 'GET', '/api/dashboard')).json.todo.some((t) => /requisitions to check/.test(t.label)));
  r = await as('aacc', 'POST', `/api/requisitions/${q.id}/check`, { approve: true });
  assert.equal(r.json.requisition.status, 'manager');
  assert.ok(JSON.stringify((await as('manager', 'GET', '/api/notifications')).json).includes('checked by the Assistant Accountant'));
});

test('LPO: procurement prepares → Head of Accounts certifies (fills a rate) → Manager authorises; goods on credit make a debt', { skip }, async () => {
  const body = { supplierId: sup.id, schoolId: em.id, deliverBy: '2030-01-01', lines: [{ description: 'Cement 50kg', unit: 'bags', qty: 40, rate: 18500 }, { description: 'Nails 3"', unit: 'kg', qty: 5 }] };
  assert.equal((await as('acc', 'POST', '/api/lpos', body)).status, 403, 'the Head of Accounts does not prepare');
  let r = await as('keeper', 'POST', '/api/lpos', body);
  assert.equal(r.status, 201, JSON.stringify(r.json)); const l = r.json.lpo;
  assert.match(l.number, /^LPO\.\d{4}$/); assert.equal(l.status, 'certify'); assert.equal(l.total, null, 'a rate is still empty'); assert.equal(l.terms, 'monthly', 'the supplier terms');
  assert.equal((await as('manager', 'POST', `/api/lpos/${l.id}/authorise`, {})).status, 409, 'not certified yet');
  assert.equal((await as('acc', 'POST', `/api/lpos/${l.id}/certify`, { lines: [{ lineId: l.lines[0].id, rate: 19000 }] })).status, 409, 'a written rate is the preparer\'s');
  r = await as('acc', 'POST', `/api/lpos/${l.id}/certify`, { lines: [{ lineId: l.lines[1].id, rate: 4000 }] });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.lpo.status, 'authorise'); assert.equal(r.json.lpo.total, 40 * 18500 + 5 * 4000);
  assert.equal((await as('acc', 'POST', `/api/lpos/${l.id}/authorise`, {})).status, 403);
  r = await as('fm', 'POST', `/api/lpos/${l.id}/authorise`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.lpo.status, 'authorised'); assert.equal(r.json.lpo.seal.status, 'valid');
  assert.equal(r.json.lpo.authorisedAs, 'Finance Manager');
  await assert.rejects(db('lpos').where({ id: l.id }).update({ status: 'certify' }), /go back|signed/);
  // The goods come from this LPO, on credit.
  r = await as('keeper', 'POST', '/api/purchases', { supplierId: sup.id, lpoId: l.id, schoolId: em.id, invoiceNo: 'INV-19', lines: [{ itemId: item.id, qty: 40, unitCost: 18500 }] });
  assert.equal(r.status, 201, JSON.stringify(r.json)); const p = r.json.purchase;
  assert.equal(p.onCredit, true); assert.equal(p.lpo.number, l.number);
  // Mapokezi: no receipt with the goods. The reason is required; FM, Manager and Director are told.
  assert.equal((await as('mapokezi', 'POST', `/api/purchases/${p.id}/check`, { noReceipt: true })).status, 400);
  r = await as('mapokezi', 'POST', `/api/purchases/${p.id}/check`, { noReceipt: true, noReceiptReason: 'Supplier will bring the invoice on Monday' });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.purchase.noReceipt.reason, 'Supplier will bring the invoice on Monday');
  for (const who of ['fm', 'manager', 'director']) assert.ok(JSON.stringify((await as(who, 'GET', '/api/notifications')).json).includes('WITHOUT a receipt'), `${who} is told`);
  assert.ok(!JSON.stringify((await as('aacc', 'GET', '/api/notifications')).json).includes('WITHOUT a receipt'), 'not the assistants');
  r = await as('aacc', 'POST', `/api/purchases/${p.id}/decide`, { approve: true });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.purchase.toSend, true);
  assert.equal((await as('keeper', 'GET', `/api/lpos/${l.id}`)).json.lpo.status, 'delivered');
  assert.ok((await as('keeper', 'GET', '/api/dashboard')).json.todo.some((t) => /to send to the schools/.test(t.label)));
  // Debt and payment.
  r = await as('fm', 'GET', `/api/suppliers/${sup.id}`);
  assert.equal(r.json.supplier.owed, 40 * 18500); assert.equal(r.json.statement[0].balance, 40 * 18500);
  assert.equal((await as('keeper', 'POST', `/api/suppliers/${sup.id}/payments`, { amount: 1000, ref: 'X' })).status, 403, 'the buyer does not pay');
  assert.equal((await as('aacc', 'POST', `/api/suppliers/${sup.id}/payments`, { amount: 1000 })).status, 400, 'a reference is needed');
  assert.equal((await as('aacc', 'POST', `/api/suppliers/${sup.id}/payments`, { amount: 999999999, ref: 'PV.1' })).status, 400, 'not more than the debt');
  r = await as('aacc', 'POST', `/api/suppliers/${sup.id}/payments`, { amount: 300000, ref: 'PV.0012', note: 'first part' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal((await as('fm', 'GET', `/api/suppliers/${sup.id}`)).json.supplier.owed, 40 * 18500 - 300000);
  // Summary of Daily Goods Received.
  r = await as('cashier', 'GET', `/api/purchases/summary/received?from=${today()}`);
  assert.equal(r.status, 200);
  const line = r.json.lines.find((x) => x.purchaseId === p.id);
  assert.equal(line.terms, 'Credit'); assert.equal(line.total, 40 * 18500); assert.equal(line.noReceipt, true); assert.equal(line.destination, em.short_name);
  // The store-keeper sends to the school.
  r = await as('keeper', 'POST', `/api/purchases/${p.id}/send`, {});
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.ok(r.json.purchase.delivery);
});

test('Work agreement (Makubaliano): Assistant Accountant enters it and the instalments; never more than agreed', { skip }, async () => {
  assert.equal((await as('keeper', 'GET', '/api/contracts')).status, 403);
  let r = await as('aacc', 'POST', '/api/contracts', { contractor: 'Kikundi cha Mafundi Buhongwa', chairman: 'Juma Ally', work: 'Kujenga uzio wa shule', place: 'Boys Secondary', amount: '1,500,000',
    startOn: '2026-11-01', endOn: '2026-12-15', signedOn: '2026-10-30', directorName: 'Director' });
  assert.equal(r.status, 201, JSON.stringify(r.json)); const c = r.json.contract;
  assert.match(c.number, /^MKT\.\d{4}$/); assert.equal(c.balance, 1500000);
  assert.equal((await as('aacc', 'POST', `/api/contracts/${c.id}/payments`, { amount: 500000 })).status, 400, 'who received it');
  r = await as('aacc', 'POST', `/api/contracts/${c.id}/payments`, { amount: 500000, receivedBy: 'Juma Ally', ref: 'PV.0020' });
  assert.equal(r.status, 201); assert.equal(r.json.contract.payments[0].balance, 1000000);
  assert.equal((await as('aacc', 'PATCH', `/api/contracts/${c.id}`, { amount: 2000000 })).status, 409, 'money paid: the agreement is fixed');
  assert.equal((await as('aacc', 'POST', `/api/contracts/${c.id}/payments`, { amount: 1000001, receivedBy: 'Juma' })).status, 400, 'not more than agreed');
  assert.equal((await as('aacc', 'POST', `/api/contracts/${c.id}/check`, {})).status, 403);
  r = await as('acc', 'POST', `/api/contracts/${c.id}/check`, {});
  assert.equal(r.status, 200); assert.ok(r.json.contract.checkedBy);
  r = await as('aacc', 'POST', `/api/contracts/${c.id}/payments`, { amount: 1000000, receivedBy: 'Juma Ally' });
  assert.equal(r.json.contract.status, 'finished', 'fully paid');
});

test('Vehicles and their responsible driver; history kept', { skip }, async () => {
  assert.equal((await as('aacc', 'POST', '/api/vehicles', { plate: 'T 1 AAA' })).status, 403);
  const plate = `T ${tag.slice(-3).toUpperCase()} BUS`;
  let r = await as('manager', 'POST', '/api/vehicles', { plate, make: 'Toyota Coaster', use: 'School bus', schoolId: em.id });
  assert.equal(r.status, 201, JSON.stringify(r.json)); const id = r.json.id;
  assert.equal((await as('amanager', 'POST', '/api/vehicles', { plate: plate.toLowerCase() })).status, 409);
  assert.equal((await as('manager', 'POST', `/api/vehicles/${id}/driver`, { name: 'Peter Lema', phone: '0754111222', from: '2026-01-01' })).status, 200);
  assert.equal((await as('amanager', 'POST', `/api/vehicles/${id}/driver`, { name: 'Daudi Mosha', from: '2025-01-01' })).status, 400, 'before the current driver');
  assert.equal((await as('amanager', 'POST', `/api/vehicles/${id}/driver`, { name: 'Daudi Mosha', from: '2026-06-01' })).status, 200);
  r = await as('director', 'GET', `/api/vehicles/${id}`);
  assert.equal(r.json.vehicle.driver.name, 'DAUDI MOSHA'); assert.equal(r.json.drivers.length, 2); assert.equal(r.json.drivers[1].to, '2026-06-01');
  assert.equal((await as('director', 'POST', `/api/vehicles/${id}/driver`, { name: 'X Y Z' })).status, 403, 'the Director only looks');
});
