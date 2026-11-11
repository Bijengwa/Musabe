// Sessions: a random token in an HttpOnly cookie. The database keeps only its hash.
const crypto = require('crypto');
const db = require('../db');
const { sha256, HttpError } = require('../lib/util');
const { pageAccess, ROLES } = require('./roles');
const { publish } = require('../realtime');

const COOKIE = 'musabe_sid';
const SHORT = 12 * 60 * 60 * 1000;      // 12 hours
const LONG = 30 * 24 * 60 * 60 * 1000;  // 30 days ("Keep me signed in")

const cookieOpts = (maxAge) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  ...(maxAge ? { maxAge } : {}),
});

async function startSession(req, res, userId, remember) {
  const token = crypto.randomBytes(32).toString('hex');
  const ttl = remember ? LONG : SHORT;
  await db('sessions').insert({
    id: sha256(token),
    user_id: userId,
    expires_at: new Date(Date.now() + ttl),
    ip: req.ip,
    user_agent: (req.get('user-agent') || '').slice(0, 255),
  });
  res.cookie(COOKIE, token, cookieOpts(remember ? ttl : undefined));
}

async function endSession(req, res) {
  const token = req.cookies?.[COOKIE];
  if (token) await db('sessions').where({ id: sha256(token) }).del();
  res.clearCookie(COOKIE, cookieOpts());
}

// Sign out every device of a user (password reset, switched off, role change). Their open screens close at once.
async function endAllSessions(userId, trx = db) {
  const n = await trx('sessions').where({ user_id: userId }).del();
  publish({ topics: ['signout'], userIds: [userId] }, trx === db ? null : trx);
  return n;
}

// Reads the cookie and puts the signed-in user on req.user (or null).
async function loadUser(req, _res, next) {
  req.user = null;
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  const row = await db('sessions as s')
    .join('users as u', 'u.id', 's.user_id')
    .leftJoin('schools as sc', 'sc.id', 'u.school_id')
    .where('s.id', sha256(token))
    .andWhere('s.expires_at', '>', db.fn.now())
    .select('u.*', 'sc.name as school_name', 'sc.short_name as school_short', 'sc.code as school_code', 's.id as session_id')
    .first();
  if (!row || !row.active) return next();
  db('sessions').where({ id: row.session_id }).update({ last_seen_at: db.fn.now() }).catch(() => {});
  delete row.password_hash;
  req.user = row;
  next();
}

// Must be signed in. While a temporary password is in use, only a few routes are open.
const OPEN_WHILE_TEMP = ['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'];
function requireAuth(req, _res, next) {
  if (!req.user) throw new HttpError(401, 'Please sign in.');
  if (req.user.must_change_password && !OPEN_WHILE_TEMP.includes(req.originalUrl.split('?')[0]))
    throw new HttpError(403, 'Choose your own password first.');
  next();
}

// requirePage('staff') = can see it; requirePage('staff', 'f') = can change things on it.
const requirePage = (page, level = 'v') => (req, _res, next) => {
  const a = pageAccess(req.user?.role, page);
  if (!a || (level === 'f' && a !== 'f')) throw new HttpError(403, 'Your account is not allowed to do this.');
  next();
};

function publicUser(u) {
  return {
    id: u.id,
    fullName: u.full_name,
    username: u.username,
    phone: u.phone,
    email: u.email || null,
    role: u.role,
    roleLabel: ROLES[u.role]?.label,
    scope: ROLES[u.role]?.scope,
    school: u.school_id ? { id: u.school_id, name: u.school_name, shortName: u.school_short, code: u.school_code } : null,
    mustChangePassword: u.must_change_password,
    preferences: u.preferences || {},
  };
}

module.exports = { startSession, endSession, endAllSessions, loadUser, requireAuth, requirePage, publicUser };
