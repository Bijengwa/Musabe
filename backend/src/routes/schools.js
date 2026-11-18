const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { pageAccess, ROLES } = require('../auth/roles');

const router = express.Router();
router.use(requireAuth);

const shape = (s) => ({
  id: s.id, code: s.code, name: s.name, shortName: s.short_name, levels: s.levels,
  receiptPrefix: s.receipt_prefix, active: s.active, students: s.students,
  receiptTitle: s.receipt_title, receiptContact: s.receipt_contact, receiptSigner: s.receipt_signer,
  lastReceiptNo: s.last_receipt_no, nextReceipt: `REC.${String((s.last_receipt_no || 0) + 1).padStart(4, '0')}`,
  staffCount: s.staff_count !== undefined ? Number(s.staff_count) : undefined,
  schoolAdmins: s.school_admins || undefined,
});

// Every signed-in person can read the school list (needed for forms and labels).
// Staff counts and School Admin names only go to people who manage schools or staff (security checklist 3.8).
router.get('/', async (req, res) => {
  const people = !!(pageAccess(req.user.role, 'schools') || pageAccess(req.user.role, 'staff'));
  const rows = await db('schools as s')
    .leftJoin('users as u', function () { this.on('u.school_id', 's.id').andOn('u.active', db.raw('true')); })
    .groupBy('s.id')
    .select('s.*', db.raw('count(u.id) as staff_count'),
      db.raw(`string_agg(CASE WHEN u.role = 'sadmin' THEN u.full_name END, ', ') as school_admins`))
    .orderBy('s.id');
  // School staff see these two only for their own school.
  const own = (r) => ROLES[req.user.role]?.scope === 'all' || r.id === req.user.school_id;
  res.json({ schools: rows.map((r) => { const x = shape(r); if (!people || !own(r)) { delete x.staffCount; delete x.schoolAdmins; } return x; }) });
});

function readBody(b) {
  const name = String(b.name || '').trim().replace(/\s+/g, ' ');
  const shortName = String(b.shortName || '').trim() || name.replace(/^Musabe\s+/i, '').replace(/\s+School$/i, '');
  const levels = String(b.levels || '').trim() || null;
  // Old code letters (no longer printed: receipts are REC.0001 ... in every school). Made from the name when missing.
  const receiptPrefix = (String(b.receiptPrefix || '').trim().toUpperCase()
    || shortName.split(/\s+/).map((w) => w[0]).join('').toUpperCase()).replace(/[^A-Z]/g, '').slice(0, 4).padEnd(2, 'X');
  if (name.length < 5) throw new HttpError(400, 'Type the full school name.');
  // What the printed receipt shows at the top and under the signature.
  const receiptTitle = String(b.receiptTitle || '').trim().replace(/\s+/g, ' ').toUpperCase() || name.toUpperCase();
  const receiptContact = String(b.receiptContact || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4).join('\n') || null;
  const receiptSigner = String(b.receiptSigner || '').trim().replace(/\s+/g, ' ').toUpperCase() || null;
  if (receiptTitle.length > 80 || (receiptSigner || '').length > 80 || (receiptContact || '').length > 400) throw new HttpError(400, 'Receipt text is too long.');
  const students = String(b.students || 'mixed');
  if (!['mixed', 'boys', 'girls'].includes(students)) throw new HttpError(400, 'Choose who the school teaches: boys, girls or both.');
  return { name, short_name: shortName, levels, receipt_prefix: receiptPrefix, students, receipt_title: receiptTitle, receipt_contact: receiptContact, receipt_signer: receiptSigner };
}

router.post('/', requirePage('schools', 'f'), async (req, res) => {
  const data = readBody(req.body || {});
  const code = (data.short_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'school').slice(0, 20);
  if (await db('schools').whereRaw('lower(name) = ?', [data.name.toLowerCase()]).first()) throw new HttpError(409, 'A school with this name already exists.');
  // Old code letters must stay unique: HS, then HSA, HSB ... if taken.
  for (let i = 0, base = data.receipt_prefix.slice(0, 3); await db('schools').where({ receipt_prefix: data.receipt_prefix }).first(); i++) data.receipt_prefix = `${base}${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i % 26]}`;
  let c = code, n = 1;
  while (await db('schools').where({ code: c }).first()) c = `${code}-${++n}`;
  const [row] = await db('schools').insert({ ...data, code: c }).returning('*');
  await audit(req, 'school.create', `Added school ${row.name}`, { schoolId: row.id });
  res.status(201).json({ school: shape(row) });
});

router.patch('/:id', requirePage('schools', 'f'), async (req, res) => {
  const s = await db('schools').where({ id: Number(req.params.id) }).first();
  if (!s) throw new HttpError(404, 'School not found.');
  const data = readBody({ name: s.name, shortName: s.short_name, levels: s.levels, receiptPrefix: s.receipt_prefix, students: s.students,
    receiptTitle: s.receipt_title, receiptContact: s.receipt_contact, receiptSigner: s.receipt_signer, ...req.body });
  data.receipt_prefix = s.receipt_prefix; // kept as it is
  // Next receipt number: to continue from the paper book (e.g. 463 after REC.0462). It can only go up, so no number is used twice.
  if (req.body?.nextReceiptNo !== undefined && req.body.nextReceiptNo !== '' && req.body.nextReceiptNo !== null) {
    const next = Number(String(req.body.nextReceiptNo).replace(/^rec\.?\s*/i, ''));
    if (!Number.isInteger(next) || next < 1 || next > 9999999) throw new HttpError(400, 'Next receipt number: type a number, e.g. 463.');
    if (next <= s.last_receipt_no) throw new HttpError(409, `REC.${String(s.last_receipt_no).padStart(4, '0')} is already used. The next number must be ${s.last_receipt_no + 1} or more.`);
    data.last_receipt_no = next - 1;
  }
  const [row] = await db('schools').where({ id: s.id }).update({ ...data, updated_at: db.fn.now() }).returning('*');
  await audit(req, 'school.update', `Updated school ${row.name}`, { schoolId: row.id });
  res.json({ school: shape(row) });
});

module.exports = router;
