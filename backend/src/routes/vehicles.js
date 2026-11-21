// Vehicles and their responsible driver (2026-11-21). The Manager and the Assistant Manager keep the list: plate, make, use,
// school, and who is responsible for it now. Changing the driver closes the old one (with the date) and keeps the history.
// Drivers often have no account in the system, so their name and phone are typed.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { sendExcel } = require('../lib/excel');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const plateOf = (v) => clean(v, 12).toUpperCase().replace(/\s+/g, ' ');
function phoneOf(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (!/^0[67]\d{8}$/.test(d)) throw new HttpError(400, 'Phone must be 10 digits starting with 06 or 07.');
  return d;
}

const list = () => db('vehicles as v').leftJoin('schools as s', 's.id', 'v.school_id')
  .leftJoin('vehicle_drivers as d', (j) => j.on('d.vehicle_id', 'v.id').andOnNull('d.to_on'))
  .select('v.*', 's.short_name as school', 'd.id as driver_row', 'd.driver_name', 'd.phone as driver_phone', 'd.licence_no', db.raw('d.from_on::text as driver_from'))
  .orderBy('v.active', 'desc').orderBy('v.plate');
const out = (v) => ({ id: v.id, plate: v.plate, make: v.make, use: v.use, schoolId: v.school_id, school: v.school, active: v.active, note: v.note,
  driver: v.driver_row ? { name: v.driver_name, phone: v.driver_phone, licence: v.licence_no, from: v.driver_from } : null });

router.get('/', requirePage('vehicles'), async (req, res) => {
  const rows = (await list()).map(out);
  res.json({ vehicles: rows, noDriver: rows.filter((v) => v.active && !v.driver).length });
});
router.get('/export.xlsx', requirePage('vehicles'), async (req, res) => {
  const rows = (await list()).map(out);
  await sendExcel(res, 'musabe-vehicles', [{ name: 'Vehicles', title: 'Musabe Schools: vehicles and responsible drivers', columns: [
    { header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'Plate', key: 'plate', width: 12 }, { header: 'Make / model', key: 'make', width: 20 }, { header: 'Use', key: 'use', width: 22 },
    { header: 'School', key: 'school', width: 16 }, { header: 'Driver', key: 'dn', width: 24 }, { header: 'Phone', key: 'dp', width: 13 }, { header: 'Since', key: 'df', width: 12 }, { header: 'In use', key: 'act', width: 8 }],
  rows: rows.map((v, i) => ({ ...v, sn: i + 1, dn: v.driver?.name || '', dp: v.driver?.phone || '', df: v.driver?.from || '', act: v.active ? 'Yes' : 'No' })) }]);
});
router.get('/:id', requirePage('vehicles'), async (req, res) => {
  const v = await list().where('v.id', Number(req.params.id) || 0).first();
  if (!v) throw new HttpError(404, 'Vehicle not found.');
  const drivers = await db('vehicle_drivers as d').join('users as u', 'u.id', 'd.recorded_by').where('d.vehicle_id', v.id).orderBy('d.from_on', 'desc').orderBy('d.id', 'desc')
    .select('d.id', 'd.driver_name', 'd.phone', 'd.licence_no', db.raw('d.from_on::text as from_t'), db.raw('d.to_on::text as to_t'), 'u.full_name as by');
  res.json({ vehicle: out(v), drivers: drivers.map((d) => ({ id: d.id, name: d.driver_name, phone: d.phone, licence: d.licence_no, from: d.from_t, to: d.to_t, by: d.by })) });
});

function readVehicle(b) {
  const plate = plateOf(b.plate);
  if (!/^[A-Z0-9 -]{3,12}$/.test(plate)) throw new HttpError(400, 'Write the plate number, e.g. T 123 ABC.');
  return { plate, make: clean(b.make, 60) || null, use: clean(b.use, 120) || null, note: clean(b.note, 300) || null };
}
router.post('/', requirePage('vehicles', 'f'), async (req, res) => {
  const b = req.body || {};
  const v = readVehicle(b);
  const school = b.schoolId ? await db('schools').where({ id: Number(b.schoolId) || 0 }).first('id') : null;
  if (await db('vehicles').whereRaw('upper(plate) = ?', [v.plate]).first()) throw new HttpError(409, `${v.plate} is already in the list.`);
  const [row] = await db('vehicles').insert({ ...v, school_id: school?.id ?? null, created_by: req.user.id }).returning('id');
  await audit(req, 'vehicle.create', `Vehicle ${v.plate}${v.make ? ` (${v.make})` : ''} added${v.use ? `: ${v.use}` : ''}`, { schoolId: school?.id ?? null, detail: { vehicleId: row.id } });
  res.status(201).json({ id: row.id });
});
router.patch('/:id', requirePage('vehicles', 'f'), async (req, res) => {
  const old = await db('vehicles').where({ id: Number(req.params.id) || 0 }).first();
  if (!old) throw new HttpError(404, 'Vehicle not found.');
  const b = req.body || {};
  const v = readVehicle({ plate: old.plate, make: old.make, use: old.use, note: old.note, ...b });
  if (await db('vehicles').whereRaw('upper(plate) = ?', [v.plate]).whereNot('id', old.id).first()) throw new HttpError(409, `${v.plate} is already in the list.`);
  const schoolId = b.schoolId === undefined ? old.school_id : (Number(b.schoolId) || null);
  const active = b.active === undefined ? old.active : !!b.active;
  await db('vehicles').where({ id: old.id }).update({ ...v, school_id: schoolId, active, updated_at: db.fn.now() });
  await audit(req, 'vehicle.update', `Vehicle ${old.plate}: ${old.active !== active ? (active ? 'back in use' : 'out of use') : 'details changed'}`, { detail: { vehicleId: old.id } });
  res.json({ ok: true });
});
// A new responsible driver: the one before is closed on the day before.
router.post('/:id/driver', requirePage('vehicles', 'f'), async (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 120).toUpperCase();
  if (name.length < 3) throw new HttpError(400, "Write the driver's name.");
  const from = isDate(b.from) ? b.from : today();
  const phone = phoneOf(b.phone);
  await db.transaction(async (trx) => {
    const v = await trx('vehicles').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!v) throw new HttpError(404, 'Vehicle not found.');
    const now = await trx('vehicle_drivers').where({ vehicle_id: v.id }).whereNull('to_on').first();
    if (now && from < String(now.from_on instanceof Date ? now.from_on.toLocaleDateString('en-CA') : now.from_on).slice(0, 10)) throw new HttpError(400, `${now.driver_name} has been the driver since an earlier date. The new driver starts after that.`);
    if (now) await trx('vehicle_drivers').where({ id: now.id }).update({ to_on: from });
    await trx('vehicle_drivers').insert({ vehicle_id: v.id, driver_name: name, phone, licence_no: clean(b.licence, 30).toUpperCase() || null, from_on: from, recorded_by: req.user.id });
    await audit(req, 'vehicle.driver', `${v.plate}: responsible driver now ${name}${now ? ` (before: ${now.driver_name})` : ''}, from ${from}`, { schoolId: v.school_id, detail: { vehicleId: v.id } }, trx);
  });
  res.json({ ok: true });
});
// No driver now (the vehicle is parked).
router.post('/:id/driver/end', requirePage('vehicles', 'f'), async (req, res) => {
  await db.transaction(async (trx) => {
    const v = await trx('vehicles').where({ id: Number(req.params.id) || 0 }).first();
    if (!v) throw new HttpError(404, 'Vehicle not found.');
    const now = await trx('vehicle_drivers').where({ vehicle_id: v.id }).whereNull('to_on').forUpdate().first();
    if (!now) throw new HttpError(409, `${v.plate} has no driver now.`);
    await trx('vehicle_drivers').where({ id: now.id }).update({ to_on: today() });
    await audit(req, 'vehicle.driver', `${v.plate}: ${now.driver_name} is no longer the responsible driver`, { schoolId: v.school_id, detail: { vehicleId: v.id } }, trx);
  });
  res.json({ ok: true });
});

module.exports = router;
