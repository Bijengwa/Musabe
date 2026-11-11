const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');

const router = express.Router();
router.use(requireAuth);

const shape = (s) => ({
  id: s.id, code: s.code, name: s.name, shortName: s.short_name, levels: s.levels,
  receiptPrefix: s.receipt_prefix, active: s.active,
  staffCount: s.staff_count !== undefined ? Number(s.staff_count) : undefined,
  schoolAdmins: s.school_admins || undefined,
});

// Every signed-in person can read the school list (needed for forms and labels).
router.get('/', async (req, res) => {
  const rows = await db('schools as s')
    .leftJoin('users as u', function () { this.on('u.school_id', 's.id').andOn('u.active', db.raw('true')); })
    .groupBy('s.id')
    .select('s.*', db.raw('count(u.id) as staff_count'),
      db.raw(`string_agg(CASE WHEN u.role = 'sadmin' THEN u.full_name END, ', ') as school_admins`))
    .orderBy('s.id');
  res.json({ schools: rows.map(shape) });
});

function readBody(b) {
  const name = String(b.name || '').trim().replace(/\s+/g, ' ');
  const shortName = String(b.shortName || '').trim() || name.replace(/^Musabe\s+/i, '').replace(/\s+School$/i, '');
  const levels = String(b.levels || '').trim() || null;
  const receiptPrefix = String(b.receiptPrefix || '').trim().toUpperCase();
  if (name.length < 5) throw new HttpError(400, 'Type the full school name.');
  if (!/^[A-Z]{2,4}$/.test(receiptPrefix)) throw new HttpError(400, 'Receipt prefix: 2 to 4 capital letters, e.g. HS.');
  return { name, short_name: shortName, levels, receipt_prefix: receiptPrefix };
}

router.post('/', requirePage('schools', 'f'), async (req, res) => {
  const data = readBody(req.body || {});
  const code = (data.short_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'school').slice(0, 20);
  if (await db('schools').whereRaw('lower(name) = ?', [data.name.toLowerCase()]).first()) throw new HttpError(409, 'A school with this name already exists.');
  if (await db('schools').where({ receipt_prefix: data.receipt_prefix }).first()) throw new HttpError(409, `Receipt prefix ${data.receipt_prefix} is already used.`);
  let c = code, n = 1;
  while (await db('schools').where({ code: c }).first()) c = `${code}-${++n}`;
  const [row] = await db('schools').insert({ ...data, code: c }).returning('*');
  await audit(req, 'school.create', `Added school ${row.name}`, { schoolId: row.id });
  res.status(201).json({ school: shape(row) });
});

router.patch('/:id', requirePage('schools', 'f'), async (req, res) => {
  const s = await db('schools').where({ id: Number(req.params.id) }).first();
  if (!s) throw new HttpError(404, 'School not found.');
  const data = readBody({ name: s.name, shortName: s.short_name, levels: s.levels, receiptPrefix: s.receipt_prefix, ...req.body });
  if (data.receipt_prefix !== s.receipt_prefix && await db('schools').where({ receipt_prefix: data.receipt_prefix }).whereNot('id', s.id).first())
    throw new HttpError(409, `Receipt prefix ${data.receipt_prefix} is already used.`);
  const [row] = await db('schools').where({ id: s.id }).update({ ...data, updated_at: db.fn.now() }).returning('*');
  await audit(req, 'school.update', `Updated school ${row.name}`, { schoolId: row.id });
  res.json({ school: shape(row) });
});

module.exports = router;
