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

// Rules for a password a person chooses (ASVS L2): at least 12 characters, no rules about symbols,
// not a common password, and not built from the person's own name or username or the school name.
// A phrase is easiest: "mama neema 2026", "kijani-mlima-saba".
const COMMON = ['password', 'passw0rd', 'qwerty', 'asdfgh', 'zxcvbn', '123456', '654321', '111111', '000000', 'abc123', 'iloveyou',
  'admin', 'welcome', 'letmein', 'changeme', 'musabe', 'mwanza', 'tanzania', 'bugando', 'school', 'shule', 'karibu', 'nenosiri'];
function checkPassword(pw, who = {}) {
  if (typeof pw !== 'string' || pw.length < 12) return 'Use at least 12 characters. A short sentence is easy to remember, e.g. "mama neema 2026".';
  if (pw.length > 128) return 'Use at most 128 characters.';
  const low = pw.toLowerCase().replace(/[\s._-]/g, '');
  if (new Set(low).size < 5) return 'Too easy to guess: use more different letters or numbers.';
  // Take out common words and the person's own names: what is left must still be a real password.
  const own = [who.username, ...(String(who.fullName || '').split(/\s+/))].map((x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '')).filter((x) => x.length >= 3);
  let rest = low;
  for (const w of [...own, ...COMMON].sort((a, b) => b.length - a.length)) rest = rest.split(w).join('');
  rest = rest.replace(/(.)\1+/g, '$1').replace(/0123|1234|2345|3456|4567|5678|6789/g, '');
  if (rest.length < 6) return own.some((x) => low.includes(x)) ? 'Do not build the password from your own name or username.' : 'Too easy to guess: it is mostly a common word or number. Add other words.';
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
