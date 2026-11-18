// Requests from the parents' app: "my child does not show" (Students → Parents' app).
// The School Admin of the child's school (or the Super Admin) finds the student and links the parent, or says no.
// - Linking: if the student has no parent phone yet, the parent's phone is written on the record;
//   otherwise the parent is added as a second parent / guardian (student_guardians). The first parent is never replaced here.
// - Others who can see Students may look at the list.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES } = require('../auth/roles');

const router = express.Router();
router.use(requireAuth, requirePage('students'));

const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const REL = { mother: 'Mother', father: 'Father', guardian: 'Guardian' };
const classLabel = (s) => [s.class_short || s.class_name, s.class_stream].filter(Boolean).join(' ');

function schoolFilter(req, q, col) {
  if (!allSchools(req.user)) return q.where(col, req.user.school_id);
  if (Number(req.query.school)) q.where(col, Number(req.query.school));
  return q;
}

// Students that may be the child asked for: same Adm. No., or every word of the name.
async function matches(r) {
  const q = db('students as s').leftJoin('classes as c', 'c.id', 's.class_id').where('s.school_id', r.school_id)
    .select('s.id', 's.full_name', 's.admission_no', 's.parent_name', 's.parent_phone', 's.status', 'c.name as class_name', 'c.short_name as class_short', 'c.stream as class_stream')
    .limit(8);
  const words = String(r.child_name).split(/\s+/).filter((w) => w.length >= 2).slice(0, 4);
  q.andWhere((w) => {
    if (r.admission_no) w.orWhereRaw('lower(s.admission_no) = lower(?)', [r.admission_no]);
    if (words.length) w.orWhere((x) => { for (const word of words) x.andWhereRaw('s.full_name ILIKE ?', [`%${word.replace(/[%_\\]/g, '')}%`]); });
  });
  return (await q).map((s) => ({ id: s.id, fullName: s.full_name, admissionNo: s.admission_no, class: classLabel(s), parentName: s.parent_name,
    parentPhone: s.parent_phone, status: s.status }));
}

router.get('/', async (req, res) => {
  const status = ['pending', 'done', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const q = db('parent_requests as r').join('parents as p', 'p.id', 'r.parent_id').join('schools as sc', 'sc.id', 'r.school_id')
    .leftJoin('users as u', 'u.id', 'r.decided_by').leftJoin('students as st', 'st.id', 'r.student_id')
    .where('r.status', status).orderBy('r.created_at', status === 'pending' ? 'asc' : 'desc').limit(200)
    .select('r.*', 'p.full_name as parent_name', 'p.phone as parent_phone', 'sc.short_name as school', 'u.full_name as decided_by_name', 'st.full_name as student_name');
  schoolFilter(req, q, 'r.school_id');
  const rows = await q;
  const out = [];
  for (const r of rows) {
    out.push({ id: r.id, school: r.school, schoolId: r.school_id, parentName: r.parent_name, parentPhone: r.parent_phone, relation: r.relation, relationLabel: REL[r.relation],
      childName: r.child_name, admissionNo: r.admission_no, className: r.class_name, note: r.note, status: r.status, answer: r.answer, at: r.created_at,
      decidedAt: r.decided_at, decidedBy: r.decided_by_name, student: r.student_name, matches: r.status === 'pending' ? await matches(r) : [] });
  }
  const cq = db('parent_requests').where('status', 'pending').count({ n: '*' });
  schoolFilter(req, cq, 'school_id');
  res.json({ requests: out, pending: Number((await cq.first()).n) });
});

async function pendingRequest(req, trx) {
  const r = await trx('parent_requests').where({ id: Number(req.params.id) }).forUpdate().first();
  if (!r || (!allSchools(req.user) && r.school_id !== req.user.school_id)) throw new HttpError(404, 'Request not found.');
  if (r.status !== 'pending') throw new HttpError(409, 'This request was already answered.');
  return r;
}

router.post('/:id/link', requirePage('students', 'f'), async (req, res) => {
  const out = await db.transaction(async (trx) => {
    const r = await pendingRequest(req, trx);
    const s = await trx('students').where({ id: Number(req.body?.studentId), school_id: r.school_id }).forUpdate().first();
    if (!s) throw new HttpError(400, 'Choose a student of this school.');
    const p = await trx('parents').where({ id: r.parent_id }).first();
    let how;
    if (s.parent_phone === p.phone) how = 'already on the record';
    else if (!s.parent_phone) {
      await trx('students').where({ id: s.id }).update({ parent_phone: p.phone, parent_name: s.parent_name || p.full_name || null, updated_by: req.user.id, updated_at: trx.fn.now() });
      how = 'phone written on the student record';
    } else {
      const has = await trx('student_guardians').where({ student_id: s.id, parent_id: p.id, active: true }).first('id');
      if (!has) await trx('student_guardians').insert({ student_id: s.id, parent_id: p.id, relation: r.relation, request_id: r.id, added_by: req.user.id });
      how = 'added as a second parent / guardian';
    }
    await trx('parent_requests').where({ id: r.id }).update({ status: 'done', student_id: s.id, decided_by: req.user.id, decided_at: trx.fn.now() });
    await audit(req, 'parent.link', `${p.full_name || p.phone} (${p.phone}) can now see ${s.full_name} (${s.admission_no}) in the parents' app: ${how}`,
      { schoolId: r.school_id, detail: { requestId: r.id, studentId: s.id } }, trx);
    return { how };
  });
  res.json({ ok: true, ...out });
});

router.post('/:id/reject', requirePage('students', 'f'), async (req, res) => {
  const answer = String(req.body?.answer ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  if (answer.length < 3) throw new HttpError(400, 'Write a short answer for the parent (they will read it in the app).');
  await db.transaction(async (trx) => {
    const r = await pendingRequest(req, trx);
    await trx('parent_requests').where({ id: r.id }).update({ status: 'rejected', answer, decided_by: req.user.id, decided_at: trx.fn.now() });
    await audit(req, 'parent.reject', `Parents' app request for ${r.child_name} was turned down: ${answer}`, { schoolId: r.school_id, detail: { requestId: r.id } }, trx);
  });
  res.json({ ok: true });
});

// Second parents / guardians linked to a student (shown on the student's page), and taking one off.
router.get('/links', async (req, res) => {
  const q = db('student_guardians as g').join('parents as p', 'p.id', 'g.parent_id').join('students as s', 's.id', 'g.student_id')
    .where('g.active', true).andWhere('g.student_id', Number(req.query.student) || 0)
    .select('g.id', 'g.relation', 'g.added_at', 'p.full_name', 'p.phone', 's.school_id');
  schoolFilter(req, q, 's.school_id');
  res.json({ links: (await q).map((g) => ({ id: g.id, relation: REL[g.relation], name: g.full_name, phone: g.phone, addedAt: g.added_at })) });
});

router.post('/links/:id/remove', requirePage('students', 'f'), async (req, res) => {
  await db.transaction(async (trx) => {
    const g = await trx('student_guardians as g').join('students as s', 's.id', 'g.student_id').join('parents as p', 'p.id', 'g.parent_id')
      .where('g.id', Number(req.params.id)).andWhere('g.active', true).first('g.id', 's.school_id', 's.full_name', 'p.phone');
    if (!g || (!allSchools(req.user) && g.school_id !== req.user.school_id)) throw new HttpError(404, 'Not found.');
    await trx('student_guardians').where({ id: g.id }).update({ active: false, removed_by: req.user.id, removed_at: trx.fn.now() });
    await audit(req, 'parent.unlink', `${g.phone} can no longer see ${g.full_name} in the parents' app`, { schoolId: g.school_id }, trx);
  });
  res.json({ ok: true });
});

module.exports = router;
