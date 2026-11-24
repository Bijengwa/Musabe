// Guardians of a student (2026-11-23). ONE list per student, in the table student_guardians:
// full names (at least two names, no titles), phone, relationship. Any number of guardians.
// The same person (same phone) can be a guardian of several children; each child keeps its own list.
// Used by: Students (screen, Excel, bulk edit), Sell (who pays), ID card (phone), parents' app (who may sign in).
const { HttpError } = require('./util');

const RELATIONS = ['father', 'mother', 'brother', 'sister', 'grandfather', 'grandmother', 'uncle', 'aunt', 'guardian', 'other'];
const LABEL = Object.fromEntries(RELATIONS.map((r) => [r, r[0].toUpperCase() + r.slice(1)]));
const MAX = 20; // per student; more than enough, but stops mistakes like a whole column pasted in one cell

// Words that are titles, not names. "MR JOHN", "MAMA SIMON", "BABA NEEMA" are refused: write JOHN MATHIAS.
const TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'MADAM', 'MADAME', 'SIR', 'DR', 'PROF', 'REV', 'PST', 'PASTOR', 'FR', 'SR', 'ENG', 'HON',
  'MWL', 'MWALIMU', 'MAMA', 'BABA', 'BI', 'BIBI', 'BWANA', 'MZEE', 'SHANGAZI', 'MJOMBA', 'KAKA', 'DADA', 'ANTI', 'AUNTY', 'UNCLE']);

const up = (v) => String(v ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase();
// " grace  tibaijuka " -> "GRACE TIBAIJUKA". Mr. John -> problem.
function nameOf(v) {
  const raw = up(v).replace(/\./g, ' ');
  const name = raw.replace(/[^A-Z' -]/g, '').replace(/\s+/g, ' ').trim();
  if (!name) return { name: '', problem: 'full name is empty' };
  const words = name.split(' ');
  if (TITLES.has(words[0])) return { name, problem: `"${String(v).trim()}" starts with a title. Write the real names, for example JOHN MATHIAS or GRACE TIBAIJUKA` };
  if (words.filter((w) => w.replace(/['-]/g, '').length >= 2).length < 2) return { name, problem: `"${String(v).trim()}" needs at least two names, for example JOHN MATHIAS` };
  if (name.length > 120) return { name, problem: 'full name is too long' };
  return { name };
}

// Phone: any way it is written -> 0754123456. 754123456 (Excel lost the 0), 255754123456, 0754-123 456 all work.
function phoneOf(v) {
  let d = String(v ?? '').replace(/\.0+$/, '').replace(/\D/g, '');
  if (!d) return { phone: null };
  if (d.startsWith('255') && d.length === 12) d = `0${d.slice(3)}`;
  if (d.length === 9 && /^[67]/.test(d)) d = `0${d}`;
  if (/^0[67]\d{8}$/.test(d)) return { phone: d };
  return { phone: null, bad: String(v).trim() };
}

// "Mama", "MOTHER", "mzazi" ... -> mother. Unknown words -> null.
function relationOf(v) {
  const t = String(v ?? '').trim().toLowerCase().replace(/[^a-z ]/g, '');
  if (!t) return null;
  if (RELATIONS.includes(t)) return t;
  const map = {
    dad: 'father', baba: 'father', mother: 'mother', mom: 'mother', mum: 'mother', mama: 'mother',
    bro: 'brother', kaka: 'brother', sis: 'sister', dada: 'sister', grandpa: 'grandfather', babu: 'grandfather',
    grandma: 'grandmother', bibi: 'grandmother', mjomba: 'uncle', 'baba mdogo': 'uncle', 'baba mkubwa': 'uncle',
    shangazi: 'aunt', auntie: 'aunt', aunty: 'aunt', 'mama mdogo': 'aunt', 'mama mkubwa': 'aunt', mlezi: 'guardian', parent: 'guardian', mzazi: 'guardian',
  };
  return map[t] || null;
}

// Check one list (from the form, the bulk editor or one Excel row).
// Returns { list: [{ id?, full_name, phone, relationship }], errors: [text] }. Never throws.
function check(input) {
  const errors = [], list = [];
  if (!Array.isArray(input)) return { list, errors: ['Guardians must be a list.'] };
  if (input.length > MAX) errors.push(`At most ${MAX} guardians for one student.`);
  const phones = new Map();
  input.slice(0, MAX).forEach((g, i) => {
    const n = `Guardian ${i + 1}`;
    const blank = !String(g?.fullName ?? '').trim() && !String(g?.phone ?? '').trim() && !String(g?.relationship ?? '').trim();
    if (blank) return; // an empty row (e.g. "Guardian 3" columns left empty) is not a guardian
    const { name, problem } = nameOf(g.fullName);
    const p = phoneOf(g.phone);
    const rel = relationOf(g.relationship);
    if (problem) errors.push(`${n}: ${problem}.`);
    if (!p.phone) errors.push(p.bad ? `${n}: phone "${p.bad}" is not a correct mobile number (10 digits starting 06 or 07).` : `${n}: phone is empty.`);
    if (!rel) errors.push(String(g.relationship ?? '').trim() ? `${n}: relationship "${g.relationship}" is not known. Use ${RELATIONS.map((r) => LABEL[r]).join(', ')}.` : `${n}: choose the relationship.`);
    if (p.phone && phones.has(p.phone)) errors.push(`${n}: phone ${p.phone} is the same as guardian ${phones.get(p.phone)}.`);
    if (p.phone) phones.set(p.phone, i + 1);
    const id = g.id != null && g.id !== '' ? Number(g.id) : null;
    if (id != null && !Number.isInteger(id)) errors.push(`${n}: wrong guardian id.`);
    list.push({ id, full_name: name, phone: p.phone, relationship: rel });
  });
  return { list, errors };
}

// Same as check(), but stops at the first mistake (form and API).
function clean(input) {
  const { list, errors } = check(input);
  if (errors.length) throw new HttpError(400, errors[0]);
  return list;
}

// One phone is one person: the name must be the same on every child of the school.
// Returns warnings like "0754... is saved as JOHN MATHIAS for NEEMA JOHN (MSB-01-0001)".
async function samePerson(db, schoolId, list, notStudentIds = []) {
  const phones = [...new Set(list.map((g) => g.phone).filter(Boolean))];
  if (!phones.length) return [];
  const q = db('student_guardians as g').join('students as s', 's.id', 'g.student_id')
    .where('g.school_id', schoolId).whereIn('g.phone', phones).select('g.phone', 'g.full_name', 's.full_name as student', 's.admission_no');
  if (notStudentIds.length) q.whereNotIn('g.student_id', notStudentIds);
  const rows = await q;
  const out = [];
  for (const g of list) {
    const other = rows.find((r) => r.phone === g.phone && r.full_name !== g.full_name);
    if (other) out.push(`${g.phone} is saved as ${other.full_name} (guardian of ${other.student}, ${other.admission_no}), here it is ${g.full_name}. One phone should be one person.`);
  }
  return out;
}

// Replace the whole list of one student. Guardians kept by id keep their "verified" mark
// unless the name or phone changed.
async function save(trx, { studentId, schoolId, userId, list }) {
  const old = await trx('student_guardians').where({ student_id: studentId }).select('*');
  const byId = new Map(old.map((g) => [g.id, g]));
  if (list.some((g) => g.id != null && !byId.has(g.id))) throw new HttpError(400, 'A guardian in the list does not belong to this student. Reload the page.');
  // From Excel there are no ids: the same name + phone is the same guardian (keeps "verified").
  const used = new Set(list.filter((g) => g.id != null).map((g) => g.id));
  list = list.map((g) => {
    if (g.id != null) return g;
    const twin = old.find((o) => !used.has(o.id) && o.phone === g.phone && o.full_name === g.full_name);
    if (!twin) return g;
    used.add(twin.id);
    return { ...g, id: twin.id };
  });
  const keepIds = list.filter((g) => g.id != null).map((g) => g.id);
  await trx('student_guardians').where({ student_id: studentId }).whereNotIn('id', keepIds.length ? keepIds : [0]).del();
  for (const [position, g] of list.entries()) {
    const values = { full_name: g.full_name, phone: g.phone, relationship: g.relationship, position, updated_by: userId, updated_at: trx.fn.now() };
    const was = g.id != null && byId.get(g.id);
    if (was) {
      if (was.full_name !== g.full_name || was.phone !== g.phone) Object.assign(values, { verified: false, verified_by: null, verified_at: null, verification_method: null, verification_note: null });
      await trx('student_guardians').where({ id: g.id }).update(values);
    } else {
      await trx('student_guardians').insert({ ...values, student_id: studentId, school_id: schoolId, created_by: userId });
    }
  }
}

// Short text for history: "JOHN MATHIAS (Father, 0754123456), GRACE TIBAIJUKA (Mother, 0713...)"
const text = (list) => list.map((g) => `${g.full_name} (${LABEL[g.relationship] || g.relationship}, ${g.phone})`).join(', ') || 'none';
const same = (a, b) => text(a) === text(b);

// All guardians of many students: Map studentId -> [rows in order].
async function forStudents(db, ids) {
  const map = new Map();
  if (!ids.length) return map;
  for (let i = 0; i < ids.length; i += 5000) {
    const rows = await db('student_guardians as g').leftJoin('users as v', 'v.id', 'g.verified_by').whereIn('g.student_id', ids.slice(i, i + 5000))
      .orderBy('g.student_id').orderBy('g.position').orderBy('g.id').select('g.*', 'v.full_name as verified_by_name');
    for (const g of rows) {
      if (!map.has(g.student_id)) map.set(g.student_id, []);
      map.get(g.student_id).push(g);
    }
  }
  return map;
}

const out = (g) => ({
  id: g.id, fullName: g.full_name, phone: g.phone, relationship: g.relationship, relationshipLabel: LABEL[g.relationship] || g.relationship,
  verified: !!g.verified, verificationMethod: g.verification_method || null, verificationNote: g.verification_note || null,
  verifiedBy: g.verified_by_name || null, verifiedAt: g.verified_at || null,
});

// SQL pieces for lists: first guardian's name and phone of student "s".
const FIRST_NAME = '(SELECT g.full_name FROM student_guardians g WHERE g.student_id = s.id ORDER BY g.position, g.id LIMIT 1)';
const FIRST_PHONE = '(SELECT g.phone FROM student_guardians g WHERE g.student_id = s.id ORDER BY g.position, g.id LIMIT 1)';

module.exports = { RELATIONS, LABEL, TITLES, MAX, nameOf, phoneOf, relationOf, check, clean, samePerson, save, text, same, forStudents, out, FIRST_NAME, FIRST_PHONE };
