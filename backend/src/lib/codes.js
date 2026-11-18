// Barcodes of the system. Every code starts with M and a letter that says what it is:
//   MI000012  an item (one code for all pieces: uniform, reams, rice)
//   MC000345  one piece of a thing that comes back (a text book copy, a microscope)
//   MS000123  a student's ID card
//   MU000045  a staff ID card (a staff account)
// The number is the row id, so nothing extra is stored and a code can never point to two things.
// Any other code is a maker's barcode printed on the packet (table item_barcodes).
const TYPES = { I: 'item', C: 'copy', S: 'student', U: 'staff' };
const LETTER = { item: 'I', copy: 'C', student: 'S', staff: 'U' };

const codeFor = (type, id) => `M${LETTER[type]}${String(id).padStart(6, '0')}`;

// What a scanned text is: { type, id } for system codes, { type: 'barcode', code } for a maker's code, null for rubbish.
function parseCode(raw) {
  const s = String(raw ?? '').trim().toUpperCase();
  const m = /^M([ICSU])(\d{1,9})$/.exec(s);
  if (m) return { type: TYPES[m[1]], id: Number(m[2]) };
  if (/^[A-Z0-9./-]{4,40}$/.test(s)) return { type: 'barcode', code: s };
  return null;
}

module.exports = { codeFor, parseCode };
