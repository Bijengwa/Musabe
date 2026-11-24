const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit').default || require('express-rate-limit');
const db = require('../db');
const { publish } = require('../realtime');
const { HttpError, checkPassword, audit, sha256 } = require('../lib/util');
const crypto = require('crypto');
const { startSession, endSession, endAllSessions, requireAuth, publicUser } = require('../auth/session');
const sms = require('../lib/sms');
const { ACCESS, CREATES } = require('../auth/roles');

const router = express.Router();
// Only failed sign-ins count (2026-11-23): a whole school signs in from one network address in the morning
// (Teacher on Duty, roll call), so 30 good sign-ins in 15 minutes must not lock everyone out.
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Wait 15 minutes and try again.' } });

// Wrong passwords:
// - 5 wrong in a row from the same address locks that address out of this account for 15 minutes
//   (someone else cannot lock a real user out from another computer).
// - 20 wrong in a row from anywhere locks the account itself for 15 minutes and tells the administrators.
// - The reply is the same for unknown usernames, wrong passwords and locks, and an unknown username still
//   takes the time of a password check, so nobody can find out which usernames exist.
const MAX_FAILS_ADDR = 5, MAX_FAILS_ACCOUNT = 20, LOCK_MIN = 15;
const TEMP_HOURS = Number(process.env.TEMP_PASSWORD_HOURS) || 72;
const addrFails = new Map(); // "userId|ip" -> { n, until }
// A fixed cost-12 hash of a throwaway text (not a secret). Written here ready-made: making it at every start
// blocked the server for almost a second.
const DUMMY = '$2b$12$mLKEC9dvmtBXEw9bawS05uXLVdd3RhoQukytELxxnongJPBnSPtKa';
setInterval(() => { const now = Date.now(); for (const [k, v] of addrFails) if (v.until < now && v.n === 0) addrFails.delete(k); }, 10 * 60000).unref();

// People can sign in with a phone number (0754 123 456 or +255754123456), an email address or a username.
// Returns the one matching user, or undefined. A phone number or email that matches more than one account is
// treated as not found, so nobody is signed into someone else's account.
async function findByLogin(raw) {
  const v = String(raw || '').trim().slice(0, 120);
  if (!v) return undefined;
  let rows;
  if (v.includes('@')) rows = await db('users').whereRaw('lower(email) = ?', [v.toLowerCase()]).limit(2);
  else {
    let d = v.replace(/[\s().-]/g, '');
    if (/^\+?255[67][0-9]{8}$/.test(d)) d = '0' + d.replace(/^\+?255/, '');
    if (/^0[67][0-9]{8}$/.test(d)) rows = await db('users').where({ phone: d }).limit(2);
    else rows = await db('users').whereRaw('lower(username) = ?', [v.toLowerCase().slice(0, 60)]).limit(2);
  }
  return rows.length === 1 ? rows[0] : undefined;
}

router.post('/login', loginLimit, async (req, res) => {
  const { username, password, remember } = req.body || {}; // 'username' carries whatever the person typed: phone, email or username
  if (!username || !password) throw new HttpError(400, 'Type your phone number, email or username, and your password.');
  const u = await findByLogin(username);
  const wrong = new HttpError(401, 'Wrong phone number, email, username or password. After several tries the account waits 15 minutes.');
  const ok = await bcrypt.compare(String(password).slice(0, 200), u ? u.password_hash : DUMMY);
  if (!u) throw wrong;
  const key = `${u.id}|${req.ip}`;
  const a = addrFails.get(key) || { n: 0, until: 0 };
  const accountLocked = u.locked_until && new Date(u.locked_until) > new Date();
  if (a.until > Date.now() || accountLocked) {
    // Locked: same reply as a wrong password, so a lock does not show that the username exists.
    await audit(req, 'auth.login_failed', `Sign-in refused for ${u.username}: waiting after too many wrong passwords`, { userId: u.id, schoolId: u.school_id });
    throw wrong;
  }
  if (!ok) {
    a.n += 1;
    if (a.n >= MAX_FAILS_ADDR) { a.until = Date.now() + LOCK_MIN * 60000; a.n = 0; }
    addrFails.set(key, a);
    const fails = u.failed_logins + 1;
    await db('users').where({ id: u.id }).update({
      failed_logins: fails >= MAX_FAILS_ACCOUNT ? 0 : fails,
      locked_until: fails >= MAX_FAILS_ACCOUNT ? new Date(Date.now() + LOCK_MIN * 60000) : null,
    });
    await audit(req, 'auth.login_failed', `Wrong password for ${u.username}`, { userId: u.id, schoolId: u.school_id });
    if (fails >= MAX_FAILS_ACCOUNT) await audit(req, 'auth.locked', `Account ${u.username} locked for ${LOCK_MIN} minutes after ${MAX_FAILS_ACCOUNT} wrong passwords`, { userId: u.id, schoolId: u.school_id });
    throw wrong;
  }
  addrFails.delete(key);
  if (!u.active) throw new HttpError(403, 'This account is switched off. Ask your administrator.');
  if (u.must_change_password && u.temp_password_expires_at && new Date(u.temp_password_expires_at) < new Date())
    throw new HttpError(403, `This temporary password has expired (it works for ${TEMP_HOURS} hours). Ask your administrator for a new one.`);
  await db('users').where({ id: u.id }).update({ failed_logins: 0, locked_until: null, last_login_at: db.fn.now() });
  // No SMS code at sign-in, and any number of devices may be signed in at once.
  await finishLogin(req, res, u, !!remember);
  res.json({ ok: true, mustChangePassword: u.must_change_password });
});

// ---- the SMS code ----
const CODE_MIN = 5, MAX_TRIES = 5, MAX_SENDS = 3;
const hashCode = (userId, code) => sha256(`${userId}:${code}`);
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
async function sendCode(req, u, remember, reason) {
  const code = newCode();
  const challenge = crypto.randomBytes(24).toString('hex');
  // A person gets one open code at a time.
  await db('login_codes').where({ user_id: u.id }).whereNull('used_at').del();
  await db('login_codes').insert({ user_id: u.id, challenge_hash: sha256(challenge), code_hash: hashCode(u.id, code), remember, reason,
    ip: req.ip, user_agent: (req.get('user-agent') || '').slice(0, 255), expires_at: new Date(Date.now() + CODE_MIN * 60000) });
  const ok = await sms.send(u.phone, `Musabe: your sign-in code is ${code}. It works for ${CODE_MIN} minutes. Never tell it to anyone.`).catch(() => false);
  if (!ok) { await db('login_codes').where({ challenge_hash: sha256(challenge) }).del(); throw new HttpError(503, 'The code could not be sent by SMS now. Try again in a minute, or ask your administrator.'); }
  return challenge;
}
async function finishLogin(req, res, u, remember, extra = '') {
  await db('users').where({ id: u.id }).update({ failed_logins: 0, locked_until: null, last_login_at: db.fn.now() });
  await startSession(req, res, u.id, remember);
  await audit(req, 'auth.login', `${u.full_name} signed in${extra}`, { userId: u.id, schoolId: u.school_id });
}
const wrongCode = () => new HttpError(400, 'The code is wrong or has expired. Check the SMS, or ask for a new code.');
async function openChallenge(challenge) {
  const row = await db('login_codes').where({ challenge_hash: sha256(String(challenge || '').slice(0, 100)) }).whereNull('used_at').first();
  return row && new Date(row.expires_at) > new Date() ? row : null;
}

router.post('/verify-code', loginLimit, async (req, res) => {
  const row = await openChallenge(req.body?.challenge);
  if (!row) throw wrongCode();
  const u = await db('users').where({ id: row.user_id }).first();
  if (!u || !u.active) throw wrongCode();
  const code = String(req.body?.code || '').replace(/\D/g, '').slice(0, 6);
  const good = code.length === 6 && crypto.timingSafeEqual(Buffer.from(hashCode(u.id, code)), Buffer.from(row.code_hash));
  if (!good) {
    const n = row.attempts + 1;
    if (n >= MAX_TRIES) await db('login_codes').where({ id: row.id }).del();
    else await db('login_codes').where({ id: row.id }).update({ attempts: n });
    await audit(req, 'auth.code_failed', `Wrong sign-in code for ${u.username} (${n} of ${MAX_TRIES})`, { userId: u.id, schoolId: u.school_id });
    throw new HttpError(400, n >= MAX_TRIES ? 'Too many wrong codes. Sign in again to get a new code.' : `The code is wrong. ${MAX_TRIES - n} tries left.`);
  }
  const claimed = await db('login_codes').where({ id: row.id }).whereNull('used_at').update({ used_at: db.fn.now() });
  if (!claimed) throw wrongCode();
  await finishLogin(req, res, u, row.remember, ' with an SMS code');
  res.json({ ok: true, mustChangePassword: u.must_change_password });
});

router.post('/resend-code', loginLimit, async (req, res) => {
  const row = await openChallenge(req.body?.challenge);
  if (!row) throw wrongCode();
  if (row.sends >= MAX_SENDS) throw new HttpError(429, 'The code was already sent 3 times. Sign in again after a few minutes.');
  if (Date.now() - new Date(row.sent_at).getTime() < 30000) throw new HttpError(429, 'Wait 30 seconds before asking for another code.');
  const u = await db('users').where({ id: row.user_id }).first();
  if (!u || (!u.phone && sms.mode() !== 'dev')) throw wrongCode();
  const code = newCode();
  const ok = await sms.send(u.phone, `Musabe: your sign-in code is ${code}. It works for ${CODE_MIN} minutes. Never tell it to anyone.`).catch(() => false);
  if (!ok) throw new HttpError(503, 'The code could not be sent by SMS now. Try again in a minute.');
  await db('login_codes').where({ id: row.id }).update({ code_hash: hashCode(u.id, code), attempts: 0, sends: row.sends + 1, sent_at: db.fn.now(), expires_at: new Date(Date.now() + CODE_MIN * 60000) });
  res.json({ ok: true, phoneHint: sms.hint(u.phone), minutes: CODE_MIN });
});

router.post('/logout', async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const pages = { ...(ACCESS[req.user.role] || {}) };
  // 2026-11-24: "Teacher on Duty" and "Roll call" only for the teacher whose duty week it is. The Discipline, Academic,
  // Second and Head Master always see them. "My teaching" only for those who teach (the Head Master does not).
  if (req.user.school_id) {
    if (req.user.role === 'teacher' && !(await require('../lib/duty').onDuty(db, req.user.id, req.user.school_id, require('../lib/duty').today()))) { delete pages.duty; delete pages.rollcall; }
    if (pages.teaching && req.user.role !== 'teacher' && !(await db('class_subjects').where({ teacher_id: req.user.id, active: true }).first('id'))) delete pages.teaching;
  }
  res.json({
    user: publicUser(req.user),
    pages,
    canCreate: CREATES[req.user.role] || [],
  });
});

// Guessing the current password from a signed-in screen (e.g. a computer left open): 10 tries per 15 minutes.
const changeLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `pw${req.user?.id}`, skipSuccessfulRequests: true, validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many tries. Wait 15 minutes and try again.' } });

router.post('/change-password', requireAuth, changeLimit, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const u = await db('users').where({ id: req.user.id }).first();
  if (!(await bcrypt.compare(String(currentPassword || ''), u.password_hash)))
    throw new HttpError(400, 'Your current password is wrong.');
  const bad = checkPassword(newPassword, { username: u.username, fullName: u.full_name });
  if (bad) throw new HttpError(400, bad);
  if (newPassword === currentPassword) throw new HttpError(400, 'Choose a password different from the old one.');
  await db.transaction(async (trx) => {
    await trx('users').where({ id: u.id }).update({
      password_hash: await bcrypt.hash(newPassword, 12),
      must_change_password: false,
      temp_password_expires_at: null,
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
  const u = await findByLogin(req.body?.username);
  if (u && u.active) {
    await db('users').where({ id: u.id }).update({ reset_requested_at: db.fn.now() });
    await audit(req, 'auth.reset_request', `${u.full_name} asked for a new password`, { userId: u.id, schoolId: u.school_id });
  }
  res.json({ ok: true, message: 'If the details are right, your administrator will see your request and give you a temporary password in person.' });
});

module.exports = { router, endAllSessions };
