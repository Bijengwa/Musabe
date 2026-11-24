// School places (2026-11-24). Each school keeps two places:
// - Library: books, exercise books, stationery (the Librarian).
// - School store: uniforms, cleaning, laboratory, food, equipment, other (the School Store-keeper).
// The item category decides the place, so stock stays one row per school and item and nothing old breaks.
const LIBRARY_CATEGORIES = ['book', 'exercise_book', 'stationery'];
const PLACES = {
  library: { label: 'Library', code: 'LIB', keeper: 'librarian' },
  school_store: { label: 'School store', code: 'ST', keeper: 'sstore' },
};
const placeOf = (category) => (LIBRARY_CATEGORIES.includes(category) ? 'library' : 'school_store');
const categoriesOf = (place) => (place === 'library' ? LIBRARY_CATEGORIES : ['uniform', 'laboratory', 'food', 'cleaning', 'equipment', 'other']);

// Which places a person works in (only the keepers; everybody else sees both).
function placesOfRole(role, roles = [role]) {
  const mine = [];
  if (roles.includes('librarian')) mine.push('library');
  if (roles.includes('sstore')) mine.push('school_store');
  return mine;
}

// Paper numbers per school and place: BS/ST/ISN.0001, BS/LIB/GRN.0003.
const placeNo = (prefix, place, kind, seq) => `${prefix}/${PLACES[place].code}/${kind}.${String(seq).padStart(4, '0')}`;

// Next number in a series: one transaction at a time per school + place + paper kind.
async function nextSeq(trx, table, schoolId, place) {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`${table}:${schoolId}:${place}`]);
  const [{ n }] = await trx(table).where({ school_id: schoolId, place }).max('seq as n');
  return (Number(n) || 0) + 1;
}

// When a delivery has been fully confirmed, each place that received lines gets its GRN (Goods Received Note).
// The receiving place writes it; the Bursar checks it; the Head Master approves it.
async function makeGrns(trx, delivery, school, by) {
  const lines = await trx('delivery_lines as l').join('items as i', 'i.id', 'l.item_id').where('l.delivery_id', delivery.id)
    .select('l.id', 'l.item_id', 'l.item_name', 'l.qty', 'l.received_qty', 'l.note', 'i.category', 'i.unit');
  const byPlace = {};
  for (const l of lines) (byPlace[placeOf(l.category)] ||= []).push(l);
  const made = [];
  for (const [place, ls] of Object.entries(byPlace)) {
    if (await trx('grns').where({ delivery_id: delivery.id, place }).first()) continue;
    const seq = await nextSeq(trx, 'grns', delivery.school_id, place);
    const number = placeNo(school.receipt_prefix, place, 'GRN', seq);
    const [{ id }] = await trx('grns').insert({ school_id: delivery.school_id, place, seq, number, delivery_id: delivery.id, delivery_number: delivery.number, prepared_by: by }).returning('id');
    await trx('grn_lines').insert(ls.map((l) => ({ grn_id: id, item_id: l.item_id, item_name: l.item_name, unit: l.unit, sent_qty: l.qty, received_qty: l.received_qty ?? 0, note: l.note })));
    made.push({ id, number, place });
  }
  return made;
}

module.exports = { PLACES, LIBRARY_CATEGORIES, placeOf, categoriesOf, placesOfRole, placeNo, nextSeq, makeGrns };
