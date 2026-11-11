const crypto = require('crypto');
const db = require('../db');
const { publish } = require('../realtime');

// An error the API sends back to the user as { error: message }.
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Easy to read aloud and type: no 0/O or 1/l/I.
function tempPassword() {
  const A = 'abcdefghjkmnpqrstuvwxyz', N = '23456789';
  const pick = (set, n) => Array.from({ length: n }, () => set[crypto.randomInt(set.length)]).join('');
  return `${pick(A, 4)}-${pick(N, 4)}`;
}

// Phone: Tanzanian mobile number, exactly 10 digits starting with 06 or 07.
// Spaces and dashes are ignored, and +255 / 255 is changed to 0. Returns "0754123456", or null when empty.
function tzPhone(v) {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  let d = raw.replace(/[\s-]/g, '');
  if (/^\+?255\d{9}$/.test(d)) d = `0${d.replace(/^\+?255/, '')}`;
  if (!/^0[67]\d{8}$/.test(d)) throw new HttpError(400, 'Phone must be a Tanzanian mobile number: 10 digits starting with 06 or 07, e.g. 0754 123 456.');
  return d;
}

// Rules for a password a person chooses.
function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use both letters and numbers.';
  return null;
}

// "Mr. Peter Mwakalinga" -> "peter.mwakalinga" (adds 2, 3... if taken)
async function suggestUsername(fullName, trx = db) {
  const parts = fullName.replace(/^(mr|mrs|ms|miss|dr|prof|rev|sr|fr)\.?\s+/i, '').trim().toLowerCase()
    .normalize('NFKD').replace(/[^a-z\s'-]/g, '').split(/\s+/).filter(Boolean);
  const base = (parts.length > 1 ? `${parts[0]}.${parts[parts.length - 1]}` : parts[0] || 'user').replace(/['-]/g, '').slice(0, 50);
  let name = base, n = 1;
  while (await trx('users').whereRaw('lower(username) = ?', [name]).first()) name = `${base}${++n}`;
  return name;
}

async function audit(req, action, summary, { schoolId = null, detail = null, userId } = {}, trx = db) {
  await trx('audit_log').insert({
    user_id: userId ?? req.user?.id ?? null,
    school_id: schoolId,
    action,
    summary,
    detail: detail ? JSON.stringify(detail) : null,
    ip: req.ip,
  });
  // Every saved change tells open screens to refresh: "audit" plus the area, e.g. user.create -> "user".
  publish({ topics: ['audit', action.split('.')[0]], schoolId, userIds: [userId ?? req.user?.id, detail?.userId] }, trx);
}

module.exports = { HttpError, sha256, tempPassword, tzPhone, checkPassword, suggestUsername, audit };
