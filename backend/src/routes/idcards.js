// ID cards: every student and every staff account has one (QR code MS000123 / MU000045).
// The card is printed on "Barcodes & ID cards". Here the School Admin records that it was handed over, so everyone
// can see who has taken their ID and who has not. A lost, damaged or returned card is closed with a reason, and a
// new one can be issued (card 2, 3 ...). Nothing is deleted.
// - School Admin: students and staff of own school.  Super Admin: everyone, including administration staff.
// - Anyone who may open the student / staff page sees the card and its state. Everyone sees their own card.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES, CARD_ISSUERS, pageAccess } = require('../auth/roles');
const { codeFor } = require('../lib/codes');

const router = express.Router();
router.use(requireAuth);

const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const REASON = { lost: 'Lost', damaged: 'Damaged', returned: 'Returned (left)', mistake: 'Issued by mistake' };
const SEX = { M: 'Male', F: 'Female' };
const classLabel = (s) => [s.class_short || s.class_name, s.class_stream].filter(Boolean).join(' ');

// ---------- Who the card belongs to ----------
const SQ = () => db('students as s').leftJoin('classes as c', 'c.id', 's.class_id').join('schools as sc', 'sc.id', 's.school_id')
  .leftJoin('photos as ph', 'ph.student_id', 's.id')
  .select('s.id', 's.full_name', 's.first_name', 's.middle_name', 's.last_name', 's.admission_no', 's.sex', 's.status', 's.school_id',
    db.raw('(SELECT g.phone FROM student_guardians g WHERE g.student_id = s.id ORDER BY g.position, g.id LIMIT 1) as guardian_phone'),
    'c.name as class_name', 'c.short_name as class_short', 'c.stream as class_stream', 'sc.name as school_name', 'sc.short_name as school_short', 'sc.code as school_code',
    'ph.updated_at as photo_at');
const UQ = () => db('users as u').leftJoin('schools as sc', 'sc.id', 'u.school_id').leftJoin('photos as ph', 'ph.user_id', 'u.id')
  .select('u.id', 'u.full_name', 'u.role', 'u.phone', 'u.active', 'u.school_id', 'sc.name as school_name', 'sc.short_name as school_short', 'sc.code as school_code',
    'ph.updated_at as photo_at');
const student = (id) => SQ().where('s.id', id).first();
const staff = (id) => UQ().where('u.id', id).first();
// Staff names are one field: first word = first name, last word = surname, the rest = middle names.
function split(full) {
  const w = String(full || '').replace(/^(mr|mrs|ms|miss|dr|prof|rev|sr|fr|mwl)\.?\s+/i, '').trim().split(/\s+/).filter(Boolean);
  return { first: w[0] || '', middle: w.length > 2 ? w.slice(1, -1).join(' ') : '', last: w.length > 1 ? w[w.length - 1] : '' };
}
const photoV = (h) => (h.photo_at ? new Date(h.photo_at).getTime() : null);
const holderOut = (kind, h) => (kind === 'student'
  ? { kind, id: h.id, code: codeFor('student', h.id), name: h.full_name, firstName: h.first_name, middleName: h.middle_name || '', lastName: h.last_name,
    schoolId: h.school_id, schoolName: h.school_name, school: h.school_short, schoolCode: h.school_code, photo: photoV(h),
    admissionNo: h.admission_no, className: classLabel(h) || null, sex: SEX[h.sex] || null, parentPhone: h.guardian_phone, active: h.status === 'active' }
  : (() => {
    const n = split(h.full_name);
    return { kind, id: h.id, code: codeFor('staff', h.id), name: h.full_name, firstName: n.first, middleName: n.middle, lastName: n.last,
      schoolId: h.school_id, schoolName: h.school_name || 'Musabe Schools', school: h.school_short || 'Administration', schoolCode: h.school_code || 'admin', photo: photoV(h),
      role: ROLES[h.role]?.label || h.role, phone: h.phone, active: h.active };
  })());

// The ID card list (Barcodes & ID cards): one school's students, or staff (one school or administration).
async function listCards(kind, { school, classId, admin } = {}) {
  let rows;
  if (kind === 'staff') {
    const q = UQ().where('u.active', true);
    if (admin) q.whereNull('u.school_id'); else q.where('u.school_id', school);
    rows = await q.orderBy('u.full_name').limit(2000);
  } else {
    const q = SQ().where({ 's.school_id': school, 's.status': 'active' });
    if (classId) q.where('s.class_id', classId);
    rows = await q.orderBy('s.full_name').limit(3000);
  }
  const st = await states(kind, rows.map((r) => r.id));
  return rows.map((h) => {
    const x = holderOut(kind, h);
    return { ...x, detail: kind === 'student' ? x.className : x.role, issued: st[x.code] || null };
  });
}

// May this person see the card? May they issue it?
function canSee(user, kind, h) {
  if (kind === 'staff' && h.id === user.id) return true;
  const page = kind === 'student' ? 'students' : 'staff';
  if (!pageAccess(user.role, page) && !pageAccess(user.role, 'idcards')) return false;
  return allSchools(user) || h.school_id === user.school_id;
}
function canIssue(user, kind, h) {
  if (!CARD_ISSUERS.includes(user.role)) return false;
  if (user.role === 'super') return true;
  if (kind === 'staff' && h.id === user.id) return false; // nobody records their own card
  return h.school_id != null && h.school_id === user.school_id;
}

async function load(user, kind, id) {
  if (!['student', 'staff'].includes(kind)) throw new HttpError(404, 'Not found.');
  const h = await (kind === 'student' ? student(Number(id) || 0) : staff(Number(id) || 0));
  if (!h || !canSee(user, kind, h)) throw new HttpError(404, kind === 'student' ? 'Student not found.' : 'Staff account not found.');
  return h;
}

async function cardInfo(user, kind, h) {
  const rows = await db('id_cards as c').leftJoin('users as i', 'i.id', 'c.issued_by').leftJoin('users as e', 'e.id', 'c.ended_by')
    .where(kind === 'student' ? 'c.student_id' : 'c.user_id', h.id).orderBy('c.card_no', 'desc')
    .select('c.*', 'i.full_name as issued_by_name', 'e.full_name as ended_by_name');
  const cards = rows.map((c) => ({ id: c.id, no: c.card_no, issuedAt: c.issued_at, issuedBy: c.issued_by_name, note: c.note, open: !c.ended_at,
    endedAt: c.ended_at, endedBy: c.ended_by_name, endReason: c.end_reason, endLabel: REASON[c.end_reason] || null, endNote: c.end_note }));
  const current = cards.find((c) => c.open) || null;
  return { holder: holderOut(kind, h), issued: !!current, current, cards, canIssue: canIssue(user, kind, h) };
}

router.get('/me', async (req, res) => res.json(await cardInfo(req.user, 'staff', await staff(req.user.id))));
router.get('/:kind/:id', async (req, res) => {
  const h = await load(req.user, req.params.kind, req.params.id);
  res.json(await cardInfo(req.user, req.params.kind, h));
});

// The state of many cards at once (ID card lists): { "MS000012": { issued, no, at } }
async function states(kind, ids) {
  if (!ids.length) return {};
  const rows = await db('id_cards').whereIn(kind === 'student' ? 'student_id' : 'user_id', ids).whereNull('ended_at')
    .select('student_id', 'user_id', 'card_no', 'issued_at');
  return Object.fromEntries(rows.map((r) => [codeFor(kind, kind === 'student' ? r.student_id : r.user_id), { no: r.card_no, at: r.issued_at }]));
}

// Issue one or many cards (the people have the printed card in their hands).
router.post('/issue', requirePage('idcards', 'f'), async (req, res) => {
  const b = req.body || {};
  const kind = b.kind;
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : [b.id]).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  if (!['student', 'staff'].includes(kind)) throw new HttpError(400, 'Choose students or staff.');
  if (!ids.length) throw new HttpError(400, 'Choose who received the card.');
  if (ids.length > 500) throw new HttpError(400, 'At most 500 cards at a time.');
  const note = clean(b.note, 200) || null;
  const done = await db.transaction(async (trx) => {
    const out = [];
    // Two clicks at the same moment: the second waits here and then sees the card (one card in use per person).
    await trx.raw('SELECT pg_advisory_xact_lock(?, ?)', [1501, kind === 'student' ? 1 : 2]);
    for (const id of ids) {
      const h = await (kind === 'student' ? student(id) : staff(id));
      if (!h || !canSee(req.user, kind, h)) throw new HttpError(404, kind === 'student' ? 'One of the students is not in your school.' : 'One of the staff accounts is not in your school.');
      if (!canIssue(req.user, kind, h)) throw new HttpError(403, kind === 'staff' && h.id === req.user.id ? 'Your own card is recorded by another administrator.'
        : 'Only the School Admin of this school (or the Super Admin) records ID cards.');
      if (kind === 'student' ? h.status !== 'active' : !h.active) throw new HttpError(400, `${h.full_name} is ${kind === 'student' ? 'marked as left school' : 'switched off'}.`);
      const col = kind === 'student' ? 'student_id' : 'user_id';
      const open = await trx('id_cards').where(col, h.id).whereNull('ended_at').first();
      if (open) { if (ids.length === 1) throw new HttpError(409, `${h.full_name} already has card ${open.card_no}. If it was lost, close it first.`); continue; }
      const [{ n }] = await trx('id_cards').where(col, h.id).max('card_no as n');
      const no = (n || 0) + 1;
      await trx('id_cards').insert({ kind, [col]: h.id, school_id: h.school_id, card_no: no, issued_by: req.user.id, note });
      out.push({ h, no });
    }
    // Staff: one line each, so every person is told about their own card. Students: one line per school.
    if (kind === 'staff') {
      for (const x of out) await audit(req, 'idcard.issue', `ID card ${x.no > 1 ? `no. ${x.no} ` : ''}given to ${x.h.full_name} (${codeFor('staff', x.h.id)})`,
        { schoolId: x.h.school_id, detail: { userId: x.h.id } }, trx);
    } else if (out.length) {
      const bySchool = new Map();
      for (const x of out) bySchool.set(x.h.school_id, [...(bySchool.get(x.h.school_id) || []), x]);
      for (const [schoolId, list] of bySchool) {
        await audit(req, 'idcard.issue', list.length === 1
          ? `ID card ${list[0].no > 1 ? `no. ${list[0].no} ` : ''}given to ${list[0].h.full_name} (${codeFor(kind, list[0].h.id)})`
          : `ID cards given to ${list.length} ${kind === 'student' ? 'students' : 'staff'}: ${list.slice(0, 6).map((x) => x.h.full_name).join(', ')}${list.length > 6 ? ' …' : ''}`,
        { schoolId, detail: { studentIds: list.map((x) => x.h.id), ...(list.length === 1 ? { studentId: list[0].h.id } : {}) } }, trx);
      }
    }
    return out.length;
  });
  res.json({ issued: done, skipped: ids.length - done });
});

// ---------- Photo on the ID card ----------
// The browser makes a small JPEG (about 360 x 480); the School Admin (own school) or the Super Admin saves it.
router.get('/photo/:kind/:id', async (req, res) => {
  const h = await load(req.user, req.params.kind, req.params.id);
  const p = await db('photos').where(req.params.kind === 'student' ? { student_id: h.id } : { user_id: h.id }).first('mime', 'data');
  if (!p) throw new HttpError(404, 'No photo.');
  res.set({ 'Content-Type': p.mime, 'Cache-Control': 'private, max-age=86400', 'Content-Disposition': 'inline' });
  res.send(p.data);
});

router.post('/photo/:kind/:id', requirePage('idcards', 'f'), async (req, res) => {
  const kind = req.params.kind;
  const h = await load(req.user, kind, req.params.id);
  if (!canIssue(req.user, kind, h)) throw new HttpError(403, 'Only the School Admin of this school (or the Super Admin) changes ID photos.');
  const m = /^data:(image\/jpeg|image\/png);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image || ''));
  if (!m) throw new HttpError(400, 'Choose a photo (JPEG or PNG).');
  const data = Buffer.from(m[2], 'base64');
  const jpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff, png = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if ((m[1] === 'image/jpeg' && !jpeg) || (m[1] === 'image/png' && !png)) throw new HttpError(400, 'This file is not a real photo.');
  if (data.length > 400000) throw new HttpError(400, 'The photo is too big. Choose it again (the page makes it small).');
  const col = kind === 'student' ? 'student_id' : 'user_id';
  await db.transaction(async (trx) => {
    await trx.raw(`INSERT INTO photos (${col}, mime, data, updated_by) VALUES (?, ?, ?, ?)
      ON CONFLICT (${col}) WHERE ${col} IS NOT NULL DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [h.id, m[1], data, req.user.id]);
    await audit(req, 'idcard.photo', `ID card photo of ${h.full_name} ${h.photo_at ? 'changed' : 'added'}`,
      { schoolId: h.school_id, detail: kind === 'student' ? { studentId: h.id } : { userId: h.id } }, trx);
  });
  res.json({ ok: true });
});

// Close the card in use: lost, damaged, returned (left school / left work) or issued by mistake.
router.post('/:id/close', requirePage('idcards', 'f'), async (req, res) => {
  const reason = String(req.body?.reason || '');
  const note = clean(req.body?.note, 200) || null;
  if (!REASON[reason]) throw new HttpError(400, 'Choose why: lost, damaged, returned or issued by mistake.');
  if (reason !== 'returned' && !note) throw new HttpError(400, 'Write a short note (e.g. "lost at the bus stop").');
  await db.transaction(async (trx) => {
    const c = await trx('id_cards').where({ id: Number(req.params.id) || 0 }).forUpdate().first();
    if (!c) throw new HttpError(404, 'ID card not found.');
    const h = await (c.kind === 'student' ? student(c.student_id) : staff(c.user_id));
    if (!canSee(req.user, c.kind, h)) throw new HttpError(404, 'ID card not found.');
    if (!canIssue(req.user, c.kind, h)) throw new HttpError(403, 'Only the School Admin of this school (or the Super Admin) records ID cards.');
    if (c.ended_at) throw new HttpError(409, 'This card is already closed.');
    await trx('id_cards').where({ id: c.id }).update({ ended_at: trx.fn.now(), ended_by: req.user.id, end_reason: reason, end_note: note });
    await audit(req, 'idcard.close', `ID card no. ${c.card_no} of ${h.full_name}: ${REASON[reason].toLowerCase()}${note ? ` (${note})` : ''}`,
      { schoolId: c.school_id, detail: c.kind === 'student' ? { studentId: h.id } : { userId: h.id } }, trx);
  });
  res.json({ ok: true });
});

module.exports = router;
module.exports.states = states;
module.exports.listCards = listCards;
