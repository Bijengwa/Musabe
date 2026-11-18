// My signature and signing PIN, the SMS code for big amounts, and the public "is this paper real?" check (QR on the printed paper).
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth } = require('../auth/session');
const seal = require('../lib/seal');
const docs = require('../lib/docs');
const { ROLES } = require('../auth/roles');

const router = express.Router();
const publicRouter = express.Router();

// ---- signed-in person: his own signature and PIN ----
router.use(requireAuth);
const cleanPng = (v) => {
  const s = String(v || '');
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s)) throw new HttpError(400, 'Draw your signature in the box.');
  if (s.length > 150000) throw new HttpError(400, 'The signature picture is too big. Draw it smaller.');
  if (s.length < 800) throw new HttpError(400, 'The signature is empty. Draw it in the box.');
  return s;
};
async function needPassword(user, password) {
  const u = await db('users').where({ id: user.id }).first('password_hash');
  if (!password || !(await bcrypt.compare(String(password), u.password_hash))) throw new HttpError(403, 'Your password is wrong.');
}
router.get('/me', async (req, res) => {
  const u = await db('users').where({ id: req.user.id }).first('signature_image', 'signing_pin_hash', 'signing_pin_at');
  res.json({ hasSignature: !!u.signature_image, image: u.signature_image || null, hasPin: !!u.signing_pin_hash, pinSetAt: u.signing_pin_at, smsAbove: seal.smsAbove(), mode: seal.mode() });
});
router.put('/signature', async (req, res) => {
  await needPassword(req.user, req.body?.password);
  const image = cleanPng(req.body?.image);
  await db('users').where({ id: req.user.id }).update({ signature_image: image });
  await audit(req, 'signing.signature', `${req.user.full_name} saved a new signature`, { userId: req.user.id, schoolId: req.user.school_id });
  res.json({ ok: true });
});
router.put('/pin', async (req, res) => {
  await needPassword(req.user, req.body?.password);
  const pin = String(req.body?.pin || '');
  if (!/^\d{4,6}$/.test(pin)) throw new HttpError(400, 'The signing PIN is 4 to 6 digits.');
  if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) throw new HttpError(400, 'Choose a PIN that is not all the same or in a row (like 1234).');
  await db('users').where({ id: req.user.id }).update({ signing_pin_hash: await bcrypt.hash(pin, 10), signing_pin_at: db.fn.now(), pin_fail: 0, pin_locked_until: null });
  await audit(req, 'signing.pin', `${req.user.full_name} set a new signing PIN`, { userId: req.user.id, schoolId: req.user.school_id });
  res.json({ ok: true });
});
// What the screen needs before it shows the PIN box for a document.
router.get('/need', async (req, res) => {
  const type = String(req.query.type || ''); const id = Number(req.query.id) || 0;
  const amount = await docs.amountOf(type, id);
  res.json({ ...(await seal.need(req.user, type, id, amount)), amount });
});
router.post('/code', async (req, res) => {
  const type = String(req.body?.type || ''); const id = Number(req.body?.id) || 0;
  if (!docs.STEP || !['requisition', 'voucher', 'purchase'].includes(type) || !id) throw new HttpError(400, 'Unknown document.');
  res.json(await seal.sendSigningCode(req.user, type, id));
});

// ---- public check (no sign-in): GET /api/verify/:type/:id/:code ----
publicRouter.get('/:type/:id/:code', async (req, res) => {
  const type = String(req.params.type); const id = Number(req.params.id) || 0;
  if (!['requisition', 'voucher', 'purchase'].includes(type) || !seal.verifyOk(type, id, req.params.code)) throw new HttpError(404, 'This code is not a Musabe document.');
  const content = await docs.contentOf(type, id);
  if (!content) throw new HttpError(404, 'This code is not a Musabe document.');
  const sealed = await seal.seal(db, type, id, content);
  const sigs = await db('document_signatures').where({ doc_type: type, doc_id: id }).orderBy('id').select('step', 'user_name', 'role', 'signed_at', 'acting');
  let info;
  if (type === 'requisition') {
    const r = await db('requisitions as r').join('schools as s', 's.id', 'r.school_id').where('r.id', id).first('r.number', 'r.status', 'r.department', 'r.applicant_name', 's.name as school', 'r.requested_at');
    info = { number: r.number, title: 'Payment requisition', school: r.school, department: r.department, applicant: r.applicant_name, status: r.status, date: r.requested_at, amount: await docs.amountOf(type, id) };
  } else {
    const p = await db('payment_requests').where({ id }).first('number', 'status', 'payee_name', 'requested_at');
    info = { number: p.number, title: 'Requested cash payout voucher', payee: p.payee_name, status: p.status, date: p.requested_at, amount: await docs.amountOf(type, id) };
  }
  res.json({ ...info, seal: sealed.status, signatures: sigs.map((s) => ({ step: docs.STEP[s.step] || s.step, name: s.user_name, role: ROLES[s.role]?.label || null, at: s.signed_at, acting: s.acting })) });
});

module.exports = router;
module.exports.publicRouter = publicRouter;
