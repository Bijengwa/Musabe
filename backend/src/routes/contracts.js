// Work agreements — "Makubaliano ya Malipo ya Kazi" (book No. 0201), paid in instalments (2026-11-21).
// The paper: Jina la mtoa kazi; Jina la mpewa kazi (kikundi) / jina la mkiti; Aina ya kazi; Eneo la kufanyia kazi;
// Kazi itaanza ... hadi ...; Kiasi Tsh (kwa maneno); Mchanganuo wa ulipwaji: Tarehe | Kiasi kwa maneno | Kiasi | Salio | Sahihi ya mlipwaji;
// Jumla; Imeandaliwa na | Imekaguliwa na.
// - The agreement is signed on paper by the Director and the contractor; the Assistant Accountant enters it (with a photo / PDF of
//   the signed paper) and records every instalment paid (who received it, the voucher number). The Accountant checks it (Imekaguliwa na).
// - Nobody can pay more than the agreed amount. Nothing is deleted.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { sendExcel } = require('../lib/excel');
const { uploadLimit } = require('../lib/guard');
const stock = require('../lib/stock');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const STATUS = { active: 'Work going on', finished: 'Finished', stopped: 'Stopped' };
const WRITERS = ['aacc'];
const CHECKERS = ['acc'];
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const money = (n) => `TSh ${Number(n).toLocaleString('en-GB')}`;

const base = () => db('contracts as c').join('users as u', 'u.id', 'c.created_by').leftJoin('users as k', 'k.id', 'c.checked_by').leftJoin('schools as s', 's.id', 'c.school_id')
  .select('c.id', 'c.number', 'c.employer', 'c.contractor', 'c.chairman', 'c.phone', 'c.work', 'c.place', 'c.school_id', 'c.amount', 'c.director_name', 'c.status', 'c.note',
    'c.created_at', 'c.checked_at', 'c.scan_mime', db.raw('(c.scan IS NOT NULL) as has_scan'), db.raw('c.start_on::text as start_t'), db.raw('c.end_on::text as end_t'), db.raw('c.signed_on::text as signed_t'),
    'u.full_name as by_name', 'k.full_name as checked_name', 's.short_name as school',
    db.raw('coalesce((SELECT sum(amount) FROM contract_payments x WHERE x.contract_id = c.id), 0)::bigint as paid'));
const out = (c, user) => ({ id: c.id, number: c.number, employer: c.employer, contractor: c.contractor, chairman: c.chairman, phone: c.phone, work: c.work, place: c.place,
  schoolId: c.school_id, school: c.school, startOn: c.start_t, endOn: c.end_t, signedOn: c.signed_t, directorName: c.director_name, amount: Number(c.amount),
  paid: Number(c.paid), balance: Number(c.amount) - Number(c.paid), status: c.status, statusLabel: STATUS[c.status], note: c.note, hasScan: !!c.has_scan, scanType: c.scan_mime,
  preparedBy: c.by_name, preparedAt: c.created_at, checkedBy: c.checked_name, checkedAt: c.checked_at,
  late: c.status === 'active' && !!c.end_t && c.end_t < today(),
  canPay: WRITERS.includes(user.role) && c.status === 'active' && Number(c.paid) < Number(c.amount),
  canCheck: CHECKERS.includes(user.role) && !c.checked_at, canEdit: WRITERS.includes(user.role) || user.role === 'director' });

router.get('/', requirePage('contracts'), async (req, res) => {
  const q = base().orderByRaw("c.status = 'active' desc").orderBy('c.id', 'desc').limit(500);
  if (STATUS[req.query.status]) q.where('c.status', req.query.status);
  if (req.query.q) { const w = `%${clean(req.query.q, 60)}%`; q.where((x) => x.whereILike('c.contractor', w).orWhereILike('c.work', w).orWhereILike('c.number', w)); }
  const rows = (await q).map((c) => out(c, req.user));
  res.json({ contracts: rows, canWrite: WRITERS.includes(req.user.role), statuses: STATUS,
    totals: { amount: rows.reduce((s, c) => s + c.amount, 0), paid: rows.reduce((s, c) => s + c.paid, 0), balance: rows.filter((c) => c.status === 'active').reduce((s, c) => s + c.balance, 0) } });
});

router.get('/export.xlsx', requirePage('contracts'), async (req, res) => {
  const rows = (await base().orderBy('c.id', 'desc')).map((c) => out(c, req.user));
  await sendExcel(res, 'musabe-work-agreements', [{ name: 'Agreements', title: 'Musabe Schools: Makubaliano ya Malipo ya Kazi', columns: [
    { header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'No.', key: 'number', width: 11 }, { header: 'Mpewa kazi', key: 'contractor', width: 26 }, { header: 'Mkiti', key: 'chairman', width: 20 },
    { header: 'Aina ya kazi', key: 'work', width: 30 }, { header: 'Eneo', key: 'place', width: 18 }, { header: 'Kuanzia', key: 'startOn', width: 12 }, { header: 'Hadi', key: 'endOn', width: 12 },
    { header: 'Kiasi', key: 'amount', type: 'money', width: 14 }, { header: 'Kilicholipwa', key: 'paid', type: 'money', width: 14 }, { header: 'Salio', key: 'balance', type: 'money', width: 14 },
    { header: 'Hali', key: 'statusLabel', width: 14 }],
  rows: rows.map((r, i) => ({ ...r, sn: i + 1 })) }]);
});

async function one(user, id) {
  const c = await base().where('c.id', Number(id) || 0).first();
  if (!c) throw new HttpError(404, 'Agreement not found.');
  const pays = await db('contract_payments as x').join('users as u', 'u.id', 'x.recorded_by').where('x.contract_id', c.id).orderBy('x.paid_on').orderBy('x.id')
    .select('x.id', 'x.amount', db.raw('x.paid_on::text as day'), 'x.received_by', 'x.ref', 'u.full_name as by');
  let left = Number(c.amount);
  return { ...out(c, user), payments: pays.map((p) => { left -= Number(p.amount); return { id: p.id, day: p.day, amount: Number(p.amount), balance: left, receivedBy: p.received_by, ref: p.ref, by: p.by }; }) };
}
router.get('/:id', requirePage('contracts'), async (req, res) => res.json({ contract: await one(req.user, req.params.id) }));
router.get('/:id/scan', requirePage('contracts'), async (req, res) => {
  const c = await db('contracts').where({ id: Number(req.params.id) || 0 }).first('scan', 'scan_mime', 'number');
  if (!c?.scan) throw new HttpError(404, 'No copy of the signed paper.');
  res.set({ 'Content-Type': c.scan_mime, 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': `inline; filename="${c.number}"`, 'X-Content-Type-Options': 'nosniff' });
  res.send(c.scan);
});

function readForm(b) {
  const contractor = clean(b.contractor, 120).toUpperCase();
  const work = clean(b.work, 300);
  if (contractor.length < 3) throw new HttpError(400, 'Write the name of the one given the work (mpewa kazi / kikundi).');
  if (work.length < 3) throw new HttpError(400, 'Write the kind of work (aina ya kazi).');
  const amount = Number(String(b.amount ?? '').replace(/[,\s]/g, ''));
  if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000000) throw new HttpError(400, 'Write the agreed amount (whole shillings).');
  const startOn = isDate(b.startOn) ? b.startOn : null;
  const endOn = isDate(b.endOn) ? b.endOn : null;
  if (startOn && endOn && endOn < startOn) throw new HttpError(400, 'The work ends before it starts.');
  const phone = String(b.phone ?? '').replace(/\D/g, '') || null;
  if (phone && !/^0[67]\d{8}$/.test(phone)) throw new HttpError(400, 'Phone must be 10 digits starting with 06 or 07.');
  return { employer: clean(b.employer, 120) || 'MUSABE SCHOOLS', contractor, chairman: clean(b.chairman, 120).toUpperCase() || null, phone, work, place: clean(b.place, 150) || null,
    start_on: startOn, end_on: endOn, amount, signed_on: isDate(b.signedOn) ? b.signedOn : null, director_name: clean(b.directorName, 120) || null, note: clean(b.note, 300) || null };
}

router.post('/', requirePage('contracts', 'f'), async (req, res) => {
  if (!WRITERS.includes(req.user.role)) throw new HttpError(403, 'The Assistant Accountant enters the work agreements.');
  const f = readForm(req.body || {});
  const school = req.body?.schoolId ? await db('schools').where({ id: Number(req.body.schoolId) || 0 }).first('id') : null;
  const id = await db.transaction(async (trx) => {
    const { rows: [{ id: cid }] } = await trx.raw(`SELECT nextval(pg_get_serial_sequence('contracts', 'id'))::int AS id`);
    const number = stock.paperNo('MKT', cid);
    await trx('contracts').insert({ id: cid, number, ...f, school_id: school?.id ?? null, created_by: req.user.id });
    await audit(req, 'contract.create', `${number}: ${f.contractor} — ${f.work}${f.place ? ` (${f.place})` : ''}, ${money(f.amount)}. Signed on paper by the Director and the contractor`, { schoolId: school?.id ?? null, detail: { contractId: cid } }, trx);
    return cid;
  });
  res.status(201).json({ contract: await one(req.user, id) });
});

// Change the details (before any money is paid), finish or stop it.
router.patch('/:id', requirePage('contracts', 'f'), async (req, res) => {
  if (!WRITERS.includes(req.user.role) && req.user.role !== 'director') throw new HttpError(403, 'The Assistant Accountant or the Director changes an agreement.');
  const b = req.body || {};
  await db.transaction(async (trx) => {
    const c = await trx('contracts').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!c) throw new HttpError(404, 'Agreement not found.');
    if (c.status !== 'active') throw new HttpError(409, `${c.number} is ${STATUS[c.status].toLowerCase()}.`);
    const [{ n }] = await trx('contract_payments').where({ contract_id: c.id }).count('* as n');
    if (b.status && b.status !== 'active') {
      if (!STATUS[b.status]) throw new HttpError(400, 'Unknown status.');
      const note = clean(b.note, 300);
      if (b.status === 'stopped' && note.length < 5) throw new HttpError(400, 'Write why the work is stopped.');
      await trx('contracts').where({ id: c.id }).update({ status: b.status, note: note || c.note, updated_at: trx.fn.now() });
      await audit(req, 'contract.status', `${c.number} (${c.contractor}): ${STATUS[b.status].toLowerCase()}${note ? `: ${note}` : ''}`, { schoolId: c.school_id, detail: { contractId: c.id } }, trx);
      return;
    }
    if (Number(n)) throw new HttpError(409, `${c.number}: money was already paid on it, the agreement cannot be changed.`);
    const f = readForm({ ...{ employer: c.employer, contractor: c.contractor, chairman: c.chairman, phone: c.phone, work: c.work, place: c.place, amount: c.amount, directorName: c.director_name, note: c.note }, ...b });
    await trx('contracts').where({ id: c.id }).update({ ...f, updated_at: trx.fn.now() });
    await audit(req, 'contract.update', `${c.number}: details changed`, { schoolId: c.school_id, detail: { contractId: c.id } }, trx);
  });
  res.json({ contract: await one(req.user, req.params.id) });
});

// A copy of the signed paper (photo or PDF). Never replaced once saved.
router.post('/:id/scan', requirePage('contracts', 'f'), uploadLimit, express.raw({ type: () => true, limit: '3mb' }), async (req, res) => {
  if (!WRITERS.includes(req.user.role)) throw new HttpError(403, 'The Assistant Accountant adds the copy of the signed paper.');
  const c = await db('contracts').where({ id: Number(req.params.id) || 0 }).first('id', 'number', 'school_id', db.raw('(scan IS NOT NULL) as has'));
  if (!c) throw new HttpError(404, 'Agreement not found.');
  if (c.has) throw new HttpError(409, `${c.number} already has the copy of the signed paper.`);
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) throw new HttpError(400, 'Choose the photo or PDF.');
  const mime = buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'image/jpeg'
    : buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png'
      : buf.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf' : null;
  if (!mime) throw new HttpError(400, 'Only a photo (JPEG, PNG) or a PDF.');
  await db('contracts').where({ id: c.id }).update({ scan: buf, scan_mime: mime, updated_at: db.fn.now() });
  await audit(req, 'contract.scan', `${c.number}: copy of the signed paper added`, { schoolId: c.school_id, detail: { contractId: c.id } });
  res.json({ ok: true });
});

// One instalment (Mchanganuo wa ulipwaji): date, amount, who received it (Sahihi ya mlipwaji), voucher no.
router.post('/:id/payments', requirePage('contracts', 'f'), async (req, res) => {
  if (!WRITERS.includes(req.user.role)) throw new HttpError(403, 'The Assistant Accountant records the payments of an agreement.');
  const b = req.body || {};
  const amount = Number(String(b.amount ?? '').replace(/[,\s]/g, ''));
  if (!Number.isInteger(amount) || amount <= 0) throw new HttpError(400, 'Write the amount paid (whole shillings).');
  const day = isDate(b.paidOn) ? b.paidOn : today();
  if (day > today()) throw new HttpError(400, 'The date cannot be in the future.');
  const receivedBy = clean(b.receivedBy, 120);
  if (receivedBy.length < 3) throw new HttpError(400, 'Write who received the money (the payee signs on the paper).');
  await db.transaction(async (trx) => {
    const c = await trx('contracts').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!c) throw new HttpError(404, 'Agreement not found.');
    if (c.status !== 'active') throw new HttpError(409, `${c.number} is ${STATUS[c.status].toLowerCase()}.`);
    const [{ s }] = await trx('contract_payments').where({ contract_id: c.id }).sum('amount as s');
    const left = Number(c.amount) - Number(s || 0);
    if (amount > left) throw new HttpError(400, `Only ${money(left)} is left on this agreement. Nobody pays more than agreed.`);
    await trx('contract_payments').insert({ contract_id: c.id, paid_on: day, amount, received_by: receivedBy.toUpperCase(), ref: clean(b.ref, 60) || null, recorded_by: req.user.id });
    if (amount === left) await trx('contracts').where({ id: c.id }).update({ status: 'finished', updated_at: trx.fn.now() });
    await audit(req, 'contract.paid', `${c.number} (${c.contractor}): paid ${money(amount)} to ${receivedBy.toUpperCase()}${b.ref ? ` (${clean(b.ref, 60)})` : ''}. Salio: ${money(left - amount)}${amount === left ? ' — fully paid' : ''}`,
      { schoolId: c.school_id, detail: { contractId: c.id } }, trx);
  });
  res.status(201).json({ contract: await one(req.user, req.params.id) });
});

// Imekaguliwa na: the Accountant checks the agreement and its payments.
router.post('/:id/check', requirePage('contracts', 'f'), async (req, res) => {
  if (!CHECKERS.includes(req.user.role)) throw new HttpError(403, 'The Accountant checks the agreements.');
  await db.transaction(async (trx) => {
    const c = await trx('contracts').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!c) throw new HttpError(404, 'Agreement not found.');
    if (c.checked_at) throw new HttpError(409, `${c.number} was already checked.`);
    if (c.created_by === req.user.id) throw new HttpError(403, 'The one who prepared it cannot also check it.');
    await trx('contracts').where({ id: c.id }).update({ checked_by: req.user.id, checked_at: trx.fn.now() });
    await audit(req, 'contract.check', `${c.number} (${c.contractor}) checked by the Accountant (${req.user.full_name})`, { schoolId: c.school_id, detail: { contractId: c.id } }, trx);
  });
  res.json({ contract: await one(req.user, req.params.id) });
});

module.exports = router;
