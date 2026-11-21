const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');

const router = express.Router();
router.use(requireAuth);

const cleanName = (value) => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();

router.get('/', requirePage('purchases'), async (req, res) => {
  const q = String(req.query.q || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  let query = db('suppliers').where({ active: true });
  if (q) query = query.whereRaw("name ilike ?", [`%${q}%`]);
  const rows = await query.orderBy('name').limit(30);
  res.json({ suppliers: rows.map((row) => ({ id: row.id, name: row.name })) });
});

router.post('/', requirePage('purchases', 'f'), async (req, res) => {
  if (!['storekeeper', 'manager', 'super'].includes(req.user.role)) {
    throw new HttpError(403, 'Only the Store-keeper, Manager or Super Admin may register suppliers.');
  }
  const name = cleanName(req.body?.name);
  if (name.length < 3) throw new HttpError(400, 'Type the supplier name.');
  if (name.length > 120) throw new HttpError(400, 'Supplier name is too long.');

  const existing = await db('suppliers').whereRaw("lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = lower(?)", [name]).first();
  if (existing) {
    if (!existing.active) await db('suppliers').where({ id: existing.id }).update({ active: true });
    return res.status(200).json({ supplier: { id: existing.id, name: existing.name }, existing: true });
  }

  const [row] = await db('suppliers').insert({ name, created_by: req.user.id }).returning(['id', 'name']);
  await audit(req, 'supplier.create', `Registered supplier ${row.name}`);
  res.status(201).json({ supplier: { id: row.id, name: row.name }, existing: false });
});

module.exports = router;
