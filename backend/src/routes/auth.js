const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit').default || require('express-rate-limit');
const db = require('../db');
const { publish } = require('../realtime');
const { HttpError, checkPassword, audit } = require('../lib/util');
const { startSession, endSession, endAllSessions, requireAuth, publicUser } = require('../auth/session');
const { ACCESS, CREATES } = require('../auth/roles');

const router = express.Router();
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Wait 15 minutes and try again.' } });

const MAX_FAILS = 5, LOCK_MIN = 15;

router.post('/login', loginLimit, async (req, res) => {
  const { username, password, remember } = req.body || {};
  if (!username || !password) throw new HttpError(400, 'Type your username and password.');
  const u = await db('users').whereRaw('lower(username) = ?', [String(username).trim().toLowerCase()]).first();
  const wrong = new HttpError(401, 'Wrong username or password.');
  if (!u) throw wrong;
  if (u.locked_until && new Date(u.locked_until) > new Date())
    throw new HttpError(423, `Too many wrong passwords. Try again after ${new Date(u.locked_until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`);
  if (!(await bcrypt.compare(String(password), u.password_hash))) {
    const fails = u.failed_logins + 1;
    await db('users').where({ id: u.id }).update({
      failed_logins: fails >= MAX_FAILS ? 0 : fails,
      locked_until: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000) : null,
    });
    if (fails >= MAX_FAILS) await audit(req, 'auth.locked', `Account ${u.username} locked for ${LOCK_MIN} minutes after ${MAX_FAILS} wrong passwords`, { userId: u.id, schoolId: u.school_id });
    throw wrong;
  }
  if (!u.active) throw new HttpError(403, 'This account is switched off. Ask your administrator.');
  await db('users').where({ id: u.id }).update({ failed_logins: 0, locked_until: null, last_login_at: db.fn.now() });
  await startSession(req, res, u.id, !!remember);
  await audit(req, 'auth.login', `${u.full_name} signed in`, { userId: u.id, schoolId: u.school_id });
  res.json({ ok: true, mustChangePassword: u.must_change_password });
});

router.post('/logout', async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: publicUser(req.user),
    pages: ACCESS[req.user.role] || {},
    canCreate: CREATES[req.user.role] || [],
  });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const u = await db('users').where({ id: req.user.id }).first();
  if (!(await bcrypt.compare(String(currentPassword || ''), u.password_hash)))
    throw new HttpError(400, 'Your current password is wrong.');
  const bad = checkPassword(newPassword);
  if (bad) throw new HttpError(400, bad);
  if (newPassword === currentPassword) throw new HttpError(400, 'Choose a password different from the old one.');
  await db.transaction(async (trx) => {
    await trx('users').where({ id: u.id }).update({
      password_hash: await bcrypt.hash(newPassword, 12),
      must_change_password: false,
      reset_requested_at: null,
      updated_at: trx.fn.now(),
    });
    // Sign out other devices; keep this one.
    await trx('sessions').where({ user_id: u.id }).whereNot({ id: req.user.session_id }).del();
    await audit(req, 'auth.password_change', `${u.full_name} chose a new password`, { schoolId: u.school_id }, trx);
  });
  publish({ topics: ['signout'], userIds: [u.id] });
  res.json({ ok: true });
});

// "Forgot password": records a request for the administrator. Never says if the username exists.
router.post('/forgot', loginLimit, async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  if (username) {
    const u = await db('users').whereRaw('lower(username) = ?', [username]).first();
    if (u && u.active) {
      await db('users').where({ id: u.id }).update({ reset_requested_at: db.fn.now() });
      await audit(req, 'auth.reset_request', `${u.full_name} asked for a new password`, { userId: u.id, schoolId: u.school_id });
    }
  }
  res.json({ ok: true, message: 'If the username is right, your administrator will see your request and give you a temporary password in person.' });
});

module.exports = { router, endAllSessions };
