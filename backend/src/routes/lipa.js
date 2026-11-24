// Lipa numbers (2026-11-24): the mobile-money numbers of a school. Parents see them in the app next to their control number,
// pay, and send the transaction number ("I paid"). The Accountant checks the money and marks the control number paid.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES } = require('../auth/roles');

const router = express.Router();
router.use(requireAuth);

const NETWORKS = { mpesa: 'M-Pesa', tigo: 'Mixx by Yas (Tigo Pesa)', airtel: 'Airtel Money', halo: 'HaloPesa', azam: 'AzamPesa', other: 'Other' };
const WRITERS = ['acc', 'fm', 'manager', 'director', 'sadmin', 'super'];
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const schoolOf = (u, wanted) => {
  const id = ROLES[u.role]?.scope === 'all' ? Number(wanted) : u.school_id;
  if (!id) throw new HttpError(400, 'Choose the school.');
  return id;
};

router.get('/', requirePage('bills'), async (req, res) => {
  const school = schoolOf(req.user, req.query.school);
  const rows = await db('lipa_numbers').where({ school_id: school }).orderBy('active', 'desc').orderBy('network').select('id', 'network', 'number', 'account_name as accountName', 'active');
  res.json({ numbers: rows.map((r) => ({ ...r, networkLabel: NETWORKS[r.network] })), networks: NETWORKS, canWrite: WRITERS.includes(req.user.role) });
});

router.post('/', requirePage('bills', 'f'), async (req, res) => {
  if (!WRITERS.includes(req.user.role)) throw new HttpError(403, 'The Accountant or the Finance Manager adds lipa numbers.');
  const school = schoolOf(req.user, req.body?.schoolId);
  const network = String(req.body?.network || '');
  const number = String(req.body?.number || '').replace(/\s/g, '');
  const accountName = clean(req.body?.accountName, 80);
  if (!NETWORKS[network]) throw new HttpError(400, 'Choose the mobile network.');
  if (!/^[0-9]{5,12}$/.test(number)) throw new HttpError(400, 'The lipa number must be 5 to 12 digits.');
  if (accountName.length < 3) throw new HttpError(400, 'Write the name the number is registered under (what the parent will see).');
  let id;
  try { [{ id }] = await db('lipa_numbers').insert({ school_id: school, network, number, account_name: accountName, created_by: req.user.id }).returning('id'); }
  catch (e) { if (e.code === '23505') throw new HttpError(409, 'This lipa number is already listed.'); throw e; }
  await audit(req, 'lipa.add', `Lipa number added: ${NETWORKS[network]} ${number} (${accountName})`, { schoolId: school, detail: { id } });
  res.status(201).json({ id });
});

router.post('/:id/active', requirePage('bills', 'f'), async (req, res) => {
  if (!WRITERS.includes(req.user.role)) throw new HttpError(403, 'The Accountant or the Finance Manager changes lipa numbers.');
  const r = await db('lipa_numbers').where({ id: Number(req.params.id) || 0 }).first();
  if (!r || (ROLES[req.user.role]?.scope !== 'all' && r.school_id !== req.user.school_id)) throw new HttpError(404, 'Lipa number not found.');
  const active = !!req.body?.active;
  await db('lipa_numbers').where({ id: r.id }).update({ active });
  await audit(req, 'lipa.switch', `Lipa number ${r.number} switched ${active ? 'on' : 'off'}`, { schoolId: r.school_id, detail: { id: r.id } });
  res.json({ ok: true });
});

module.exports = router;
