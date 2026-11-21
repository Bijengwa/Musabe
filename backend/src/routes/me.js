// "My account": the signed-in person's own profile, settings and devices.
// Everyone can use these, whatever their role. Nobody can change another person's account here.
const express = require('express');
const db = require('../db');
const { publish } = require('../realtime');
const { HttpError, audit, tzPhone } = require('../lib/util');
const bcrypt = require('bcryptjs');
const { requireAuth, publicUser } = require('../auth/session');

const router = express.Router();
router.use(requireAuth);

// Only the administrator changes these. They appear on receipts, reports and the audit log.
const LOCKED = { fullName: 'name', username: 'username', role: 'role', schoolId: 'school' };

const THEMES = ['system', 'light', 'dark'];
const TEXT_SIZES = ['normal', 'large'];
// sound: play a sound for new notifications (default on)

// "Working as" (2026-11-20): switch to another of my roles on this device. Pages, buttons and "To do" follow it.
router.post('/role', async (req, res) => {
  const role = String(req.body?.role || '');
  if (!req.user.roles.some((r) => r.role === role)) throw new HttpError(403, 'You do not hold this role.');
  await db('sessions').where({ id: req.user.session_id }).update({ active_role: role === req.user.main_role ? null : role });
  const { ROLES } = require('../auth/roles');
  await audit(req, 'auth.role', `${req.user.full_name} now works as ${ROLES[role].label} (was ${ROLES[req.user.role].label})`, { detail: { userId: req.user.id } });
  const use = req.user.roles.find((r) => r.role === role);
  res.json({ user: publicUser({ ...req.user, role: use.role, school_id: use.school_id, school_name: use.school_name, school_short: use.school_short, school_code: use.school_code }) });
});

// Short public id for a session. The full value is a hash of the cookie and never leaves the server.
const sid = (hash) => hash.slice(0, 12);

router.get('/profile', async (req, res) => {
  const u = req.user;
  const [creator, pw, activity] = await Promise.all([
    u.created_by ? db('users').where({ id: u.created_by }).first('full_name') : null,
    db('audit_log').where({ user_id: u.id }).whereIn('action', ['auth.password_change']).orderBy('at', 'desc').first('at'),
    db('audit_log').where({ user_id: u.id }).orderBy('at', 'desc').limit(8).select('id', 'at', 'action', 'summary'),
  ]);
  res.json({
    user: publicUser(u),
    createdAt: u.created_at,
    createdBy: creator?.full_name || null,
    lastLoginAt: u.last_login_at,
    passwordChangedAt: pw?.at || null,
    activity,
  });
});

// The person may change their own phone and email. Everything else is locked.
router.patch('/', async (req, res) => {
  const b = req.body || {};
  const tried = Object.keys(LOCKED).filter((k) => b[k] !== undefined);
  if (tried.length)
  {
    const names = tried.map((k) => LOCKED[k]);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
    throw new HttpError(403, `Only your administrator can change your ${list}.`);
  }

  const up = {};
  const changes = [];
  if (b.phone !== undefined) {
    const v = tzPhone(b.phone);
    if (v !== req.user.phone) { up.phone = v; changes.push('phone'); }
  }
  if (b.email !== undefined) {
    const v = String(b.email).trim().toLowerCase() || null;
    if (v && (v.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v))) throw new HttpError(400, 'Email looks wrong. Example: name@gmail.com');
    if (v && await db('users').whereRaw('lower(email) = ?', [v]).whereNot('id', req.user.id).first())
      throw new HttpError(409, 'Another account already uses this email.');
    if (v !== (req.user.email || null)) { up.email = v; changes.push('email'); }
  }
  if (!changes.length) return res.json({ ok: true, unchanged: true });

  await db.transaction(async (trx) => {
    await trx('users').where({ id: req.user.id }).update({ ...up, updated_at: trx.fn.now() });
    await audit(req, 'profile.update', `${req.user.full_name} updated their ${changes.join(' and ')}`,
      { schoolId: req.user.school_id, detail: { changes } }, trx);
  });
  publish({ topics: ['me'], userIds: [req.user.id], onlyUsers: true });
  res.json({ ok: true, changed: changes });
});


// Signing: the drawn signature and the signing PIN (lib/seal.js). Both need the account password, so a borrowed screen cannot change them.
const PNG = /^data:image\/png;base64,[A-Za-z0-9+/=]{800,150000}$/;
async function needPassword(req) {
  const row = await db('users').where({ id: req.user.id }).first('password_hash');
  if (!(await bcrypt.compare(String(req.body?.password ?? ''), row.password_hash))) throw new HttpError(403, 'Your password is wrong.');
}
router.put('/signature', async (req, res) => {
  const image = String(req.body?.image || '');
  if (!PNG.test(image)) throw new HttpError(400, 'Draw your signature in the box first.');
  await needPassword(req);
  await db('users').where({ id: req.user.id }).update({ signature_image: image });
  await audit(req, 'sign.signature_set', `${req.user.full_name} saved a new drawn signature`);
  res.json({ ok: true });
});
router.put('/pin', async (req, res) => {
  const pin = String(req.body?.pin ?? '');
  if (!/^\d{4,6}$/.test(pin)) throw new HttpError(400, 'The signing PIN is 4 to 6 digits.');
  if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) throw new HttpError(400, 'Choose a PIN that is not easy to guess (not 1111 or 1234).');
  await needPassword(req);
  await db('users').where({ id: req.user.id }).update({ signing_pin_hash: await bcrypt.hash(pin, 12), pin_fails: 0, pin_locked_until: null });
  await audit(req, 'sign.pin_set', `${req.user.full_name} set a new signing PIN`);
  res.json({ ok: true });
});
router.get('/signature', async (req, res) => {
  const u = await db('users').where({ id: req.user.id }).first('signature_image');
  res.json({ image: u?.signature_image || null });
});

router.put('/preferences', async (req, res) => {
  const b = req.body || {};
  const prefs = { ...(req.user.preferences || {}) };
  if (b.theme !== undefined) {
    if (!THEMES.includes(b.theme)) throw new HttpError(400, 'Choose Light, Dark or System.');
    prefs.theme = b.theme;
  }
  if (b.sound !== undefined) prefs.sound = !!b.sound;
  if (b.textSize !== undefined) {
    if (!TEXT_SIZES.includes(b.textSize)) throw new HttpError(400, 'Choose Normal or Large text.');
    prefs.textSize = b.textSize;
  }
  await db('users').where({ id: req.user.id }).update({ preferences: JSON.stringify(prefs) });
  // The person's other phones and computers switch at once.
  publish({ topics: ['me'], userIds: [req.user.id], onlyUsers: true });
  res.json({ preferences: prefs });
});

// Devices where this person is signed in.
router.get('/sessions', async (req, res) => {
  const rows = await db('sessions').where({ user_id: req.user.id }).andWhere('expires_at', '>', db.fn.now())
    .orderBy('last_seen_at', 'desc').select('id', 'created_at', 'last_seen_at', 'ip', 'user_agent');
  res.json({
    sessions: rows.map((s) => ({
      id: sid(s.id),
      current: s.id === req.user.session_id,
      signedInAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      ip: s.ip,
      userAgent: s.user_agent,
    })),
  });
});

router.post('/sessions/:id/end', async (req, res) => {
  const id = String(req.params.id);
  if (!/^[0-9a-f]{12}$/.test(id)) throw new HttpError(400, 'Bad device id.');
  if (sid(req.user.session_id) === id) throw new HttpError(400, 'This is the device you are using. Use Sign out instead.');
  const n = await db('sessions').where({ user_id: req.user.id }).andWhereLike('id', `${id}%`).del();
  if (!n) throw new HttpError(404, 'That device is already signed out.');
  await audit(req, 'auth.session_end', `${req.user.full_name} signed out one of their other devices`, { schoolId: req.user.school_id });
  publish({ topics: ['signout'], userIds: [req.user.id] });
  res.json({ ok: true });
});

router.post('/sessions/end-others', async (req, res) => {
  const n = await db('sessions').where({ user_id: req.user.id }).whereNot({ id: req.user.session_id }).del();
  if (n) {
    await audit(req, 'auth.session_end', `${req.user.full_name} signed out ${n} other device${n > 1 ? 's' : ''}`, { schoolId: req.user.school_id });
    publish({ topics: ['signout'], userIds: [req.user.id] });
  }
  res.json({ ok: true, ended: n });
});

module.exports = router;
