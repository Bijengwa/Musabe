// "My account": the signed-in person's own profile, settings and devices.
// Everyone can use these, whatever their role. Nobody can change another person's account here.
const express = require('express');
const db = require('../db');
const { publish } = require('../realtime');
const { HttpError, audit, tzPhone } = require('../lib/util');
const { requireAuth, publicUser } = require('../auth/session');

const router = express.Router();
router.use(requireAuth);

// Only the administrator changes these. They appear on receipts, reports and the audit log.
const LOCKED = { fullName: 'name', username: 'username', role: 'role', schoolId: 'school' };

const THEMES = ['system', 'light', 'dark'];
const TEXT_SIZES = ['normal', 'large'];
// sound: play a sound for new notifications (default on)

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
