// School places, Issue Notes and GRN (2026-11-24).
// Uses its own school, so switching "strict places" on does not disturb the other test files.
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

const tag = `p${Date.now().toString(36)}`;
const password = `Test-${tag}-9x`;
const P = {};
let server, port, school, shirt, book, other;
const cookie = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const as = (who, method, path, body) => request({ port, method, path, body, cookie: P[who].cookie });
const level = async (itemId) => (await db('stock_levels').where({ school_id: school.id, item_id: itemId }).first())?.qty || 0;

test.before(async () => {
  if (!URL) return;
  ({ server, port } = await listen(app));
  [school] = await db('schools').insert({ code: `tp${tag}`.slice(0, 20), name: `Test School ${tag}`, short_name: `TS ${tag}`.slice(0, 60), receipt_prefix: `T${tag.slice(-3)}`.toUpperCase().slice(0, 4), active: true }).returning('*');
  [other] = await db('schools').insert({ code: `to${tag}`.slice(0, 20), name: `Other School ${tag}`, short_name: `OS ${tag}`.slice(0, 60), receipt_prefix: `O${tag.slice(-3)}`.toUpperCase().slice(0, 4), active: true }).returning('*');
  [shirt] = await db('items').insert({ name: `TEST SHIRT ${tag}`.toUpperCase(), category: 'uniform', unit: 'pc', active: true, sellable: true }).returning('*');
  [book] = await db('items').insert({ name: `TEST BOOK ${tag}`.toUpperCase(), category: 'book', unit: 'pc', active: true, sellable: true }).returning('*');
  for (const s of [school, other]) for (const it of [shirt, book]) await db('item_prices').insert({ item_id: it.id, school_id: s.id, price: 10000 });
  const make = [['bursar', 'bursar', school.id], ['head', 'head', school.id], ['second', 'second', school.id], ['lib', 'librarian', school.id], ['store', 'sstore', school.id],
    ['sadmin', 'sadmin', school.id], ['otherSecond', 'second', other.id], ['acc', 'acc', null]];
  for (const [key, role, sid] of make) {
    const username = `pl_${key}_${tag}`.toLowerCase();
    const [u] = await db('users').insert({ full_name: `Test ${key} ${tag}`, username, role, school_id: sid, password_hash: await bcrypt.hash(password, 4), must_change_password: false }).returning('id');
    const r = await request({ port, method: 'POST', path: '/api/auth/login', body: { username, password } });
    P[key] = { id: u.id, cookie: cookie(r) };
  }
  for (const it of [shirt, book]) await db('stock_levels').insert({ school_id: school.id, item_id: it.id, qty: 20 });
});
test.after(async () => { if (URL) { server.close(); await db.destroy(); } });

let receipt, noteIds = [];
test('Second Master writes Issue Notes from a receipt: one per place', { skip }, async () => {
  const s = await as('bursar', 'POST', '/api/receipts', { studentName: 'Neema John', studentClass: 'Std 4', method: 'cash', lines: [{ itemId: shirt.id, qty: 2 }, { itemId: book.id, qty: 3 }] });
  assert.equal(s.status, 201, JSON.stringify(s.json)); receipt = s.json.receipt;
  assert.equal((await as('bursar', 'POST', '/api/notes', { kind: 'receipt', receiptId: receipt.id })).status, 403, 'the Bursar does not write notes');
  assert.equal((await as('otherSecond', 'POST', '/api/notes', { kind: 'receipt', receiptId: receipt.id })).status, 404, 'another school cannot');
  const todo = await as('second', 'GET', '/api/notes/to-write');
  assert.ok(todo.json.receipts.find((r) => r.id === receipt.id), 'the receipt is on the to-write list');
  const w = await as('second', 'POST', '/api/notes', { kind: 'receipt', receiptId: receipt.id });
  assert.equal(w.status, 201, JSON.stringify(w.json));
  assert.equal(w.json.notes.length, 2);
  noteIds = w.json.notes;
  assert.match(w.json.notes.find((n) => /\/ST\//.test(n.number)).number, /^T..?.?\/ST\/ISN\.0001$/);
  assert.match(w.json.notes.find((n) => /\/LIB\//.test(n.number)).number, /\/LIB\/ISN\.0001$/);
  assert.equal((await as('second', 'POST', '/api/notes', { kind: 'receipt', receiptId: receipt.id })).status, 409, 'a second note for the same things is refused');
});

test('Until places are strict the Librarian may give both; then each keeper gives only his own place', { skip }, async () => {
  const st = noteIds.find((n) => /\/ST\//.test(n.number)), lib = noteIds.find((n) => /\/LIB\//.test(n.number));
  const stNote = (await as('store', 'GET', `/api/notes/${st.id}`)).json.note;
  assert.equal(stNote.canGive, true);
  assert.equal((await as('sadmin', 'POST', '/api/notes/strict', { strict: true })).status, 200);
  const no = await as('lib', 'POST', `/api/notes/${st.id}/give`, { lines: [{ lineId: stNote.lines[0].id, qty: 1 }] });
  assert.equal(no.status, 403, 'the Librarian cannot give school store things when places are strict');
  const ok = await as('store', 'POST', `/api/notes/${st.id}/give`, { lines: [{ lineId: stNote.lines[0].id, qty: 1 }], collectedBy: 'mama neema' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.note.status, 'part');
  assert.equal(await level(shirt.id), 19);
  assert.equal((await as('store', 'POST', `/api/notes/${st.id}/give`, { lines: [{ lineId: stNote.lines[0].id, qty: 5 }] })).status, 409, 'cannot give more than the note says');
  assert.equal((await as('store', 'POST', `/api/notes/${st.id}/cancel`, { reason: 'mistake' })).status, 403, 'only the Second Master cancels');
  assert.equal((await as('second', 'POST', `/api/notes/${st.id}/cancel`, { reason: 'mistake' })).status, 409, 'a note already part given cannot be cancelled');
  const rest = await as('store', 'POST', `/api/notes/${st.id}/give`, { lines: [{ lineId: stNote.lines[0].id, qty: 1 }] });
  assert.equal(rest.json.note.status, 'given');
  const libNote = (await as('lib', 'GET', `/api/notes/${lib.id}`)).json.note;
  assert.equal((await as('store', 'POST', `/api/notes/${lib.id}/give`, { lines: [{ lineId: libNote.lines[0].id, qty: 3 }] })).status, 403, 'the School Store-keeper cannot give books');
  const l = await as('lib', 'POST', `/api/notes/${lib.id}/give`, { lines: [{ lineId: libNote.lines[0].id, qty: 3 }] });
  assert.equal(l.status, 200, JSON.stringify(l.json));
  assert.equal(await level(book.id), 17);
  const r = (await as('lib', 'GET', `/api/receipts/${receipt.id}`)).json.receipt;
  assert.equal(r.status, 'given', 'the receipt shows everything was given');
});

test('Notes for a staff member or a place; the wrong place is refused; a note can be cancelled before anything is given', { skip }, async () => {
  const bad = await as('second', 'POST', '/api/notes', { kind: 'place', place: 'school_store', recipient: 'Kitchen', lines: [{ itemId: book.id, qty: 1 }] });
  assert.equal(bad.status, 400, 'a book is not kept in the school store');
  const w = await as('second', 'POST', '/api/notes', { kind: 'staff', place: 'school_store', recipient: 'mwl. juma', lines: [{ itemId: shirt.id, qty: 2 }] });
  assert.equal(w.status, 201, JSON.stringify(w.json));
  const id = w.json.notes[0].id;
  assert.match(w.json.notes[0].number, /\/ST\/ISN\.0002$/, 'numbers run on per place');
  const c = await as('second', 'POST', `/api/notes/${id}/cancel`, { reason: 'wrong person' });
  assert.equal(c.status, 200); assert.equal(c.json.note.status, 'cancelled');
  assert.equal((await as('store', 'POST', `/api/notes/${id}/give`, { lines: [{ lineId: 1, qty: 1 }] })).status, 409);
  const w2 = await as('second', 'POST', '/api/notes', { kind: 'place', place: 'school_store', recipient: 'Kitchen', lines: [{ itemId: shirt.id, qty: 4 }] });
  const n2 = (await as('store', 'GET', `/api/notes/${w2.json.notes[0].id}`)).json.note;
  const g = await as('store', 'POST', `/api/notes/${n2.id}/give`, { lines: [{ lineId: n2.lines[0].id, qty: 4 }], collectedBy: 'cook' });
  assert.equal(g.status, 200);
  assert.equal(await level(shirt.id), 14);
  const mv = await db('stock_moves').where({ school_id: school.id, item_id: shirt.id, kind: 'issue' }).first();
  assert.equal(mv.change, -4);
  const stock = await as('store', 'GET', '/api/notes/stock');
  assert.ok(stock.json.items.find((i) => i.itemId === shirt.id) && !stock.json.items.find((i) => i.itemId === book.id), 'the School Store-keeper sees only school store stock');
});

test('Deliveries: each keeper receives his own lines; then a GRN per place; Bursar checks, Head Master approves', { skip }, async () => {
  const [{ id: did }] = await db('deliveries').insert({ school_id: school.id, status: 'sent', sent_by: P.acc.id, number: `DLV.T${tag}` }).returning('id');
  const lines = await db('delivery_lines').insert([{ delivery_id: did, item_id: shirt.id, item_name: shirt.name, qty: 10 }, { delivery_id: did, item_id: book.id, item_name: book.name, qty: 5 }]).returning('*');
  const shirtLine = lines.find((l) => l.item_id === shirt.id), bookLine = lines.find((l) => l.item_id === book.id);
  assert.equal((await as('lib', 'POST', `/api/stock/deliveries/${did}/lines/${shirtLine.id}/confirm`, {})).status, 403, 'the Librarian cannot receive uniforms in strict mode');
  assert.equal((await as('lib', 'POST', `/api/stock/deliveries/${did}/confirm-all`, {})).status, 200);
  assert.equal((await db('deliveries').where({ id: did }).first()).status, 'sent', 'the school store line is still waiting');
  assert.equal((await db('grns').where({ delivery_id: did })).length, 0);
  assert.equal((await as('store', 'POST', `/api/stock/deliveries/${did}/lines/${shirtLine.id}/confirm`, { receivedQty: 9, note: '1 torn' })).status, 200);
  assert.equal((await db('deliveries').where({ id: did }).first()).status, 'received');
  const g = await as('bursar', 'GET', '/api/grns');
  assert.equal(g.json.grns.filter((x) => x.deliveryId === did).length, 2, 'one GRN per place');
  const st = g.json.grns.find((x) => x.deliveryId === did && x.place === 'school_store');
  assert.match(st.number, /\/ST\/GRN\.0001$/);
  const full = (await as('bursar', 'GET', `/api/grns/${st.id}`)).json.grn;
  assert.equal(full.lines[0].sent, 10); assert.equal(full.lines[0].received, 9); assert.equal(full.canCheck, true);
  assert.equal((await as('head', 'POST', `/api/grns/${st.id}/approve`, {})).status, 409, 'the Head Master cannot approve before the Bursar checks');
  assert.equal((await as('store', 'POST', `/api/grns/${st.id}/check`, {})).status, 403);
  const back = await as('bursar', 'POST', `/api/grns/${st.id}/back`, {});
  assert.equal(back.status, 400, 'a reason is needed');
  assert.equal((await as('bursar', 'POST', `/api/grns/${st.id}/back`, { reason: 'count again' })).json.grn.status, 'sent_back');
  assert.equal((await as('store', 'POST', `/api/grns/${st.id}/resend`, {})).json.grn.status, 'waiting');
  assert.equal((await as('bursar', 'POST', `/api/grns/${st.id}/check`, {})).json.grn.status, 'checked');
  const ap = await as('head', 'POST', `/api/grns/${st.id}/approve`, {});
  assert.equal(ap.json.grn.status, 'approved'); assert.ok(ap.json.grn.approvedBy);
  assert.equal(await level(shirt.id), 14 + 9);
});

test('Strict places cannot be switched on without a School Store-keeper; only the admin changes it', { skip }, async () => {
  assert.equal((await as('second', 'POST', '/api/notes/strict', { strict: false })).status, 403);
  assert.equal((await as('sadmin', 'POST', '/api/notes/strict', { strict: false })).json.strict, false);
  await db('users').where({ id: P.store.id }).update({ active: false });
  assert.equal((await as('sadmin', 'POST', '/api/notes/strict', { strict: true })).status, 409);
  await db('users').where({ id: P.store.id }).update({ active: true });
});
