// Signatures and seals.
//  - A person signs with their signing PIN (not the password). Their drawn signature (My profile) is put on the paper.
//  - For a big amount (SIGN_SMS_FROM, default TSh 1,000,000) an SMS code to their phone is needed too.
//  - Each signature stores a hash of the paper's numbers at that moment and a MAC (server secret) chained to the earlier signature.
//    seal(): 'valid' only if the chain is untouched AND the paper still says what the last signer saw. A changed number breaks it.
//  - The QR on the printed paper holds a check code (checkCode()); /api/verify/... answers it without sign-in.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db0 = require('../db');
const sms = require('./sms');
const { HttpError, audit } = require('./util');

const SECRET = process.env.SEAL_SECRET || (process.env.NODE_ENV === 'production' ? '' : crypto.randomBytes(32).toString('hex'));
if (!SECRET) throw new Error('SEAL_SECRET is required when NODE_ENV=production.');
const BIG = Number(process.env.SIGN_SMS_FROM) || 1000000;
const MAX_FAILS = 5;
const LOCK_MIN = 15;
const CODE_MIN = 10;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const hashOf = (content) => sha(canon(content ?? null));
const macOf = (s) => hmac([s.doc_type, s.doc_id, s.step, s.user_id ?? '', s.user_name, s.content_hash, s.prev_mac ?? '', new Date(s.signed_at).toISOString(), sha(s.image || '')].join('|'));
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const codeHash = (userId, code) => hmac(`signcode|${userId}|${code}`);

const signaturesOf = async (db, type, ids) => (ids.length ? db('signatures').where({ doc_type: type }).whereIn('doc_id', ids).orderBy('id') : []);

// Before the transaction: the PIN (and the SMS code for a big amount) must be right. Wrong tries are counted and stay counted.
async function checkSigning(user, { pin, smsCode, type, id, amount }) {
  const u = await db0('users').where({ id: user.id }).first('id', 'phone', 'signature_image', 'signing_pin_hash', 'pin_fails', 'pin_locked_until');
  if (!u?.signing_pin_hash || !u.signature_image) throw new HttpError(403, 'First draw your signature and choose your signing PIN in My profile.');
  if (u.pin_locked_until && new Date(u.pin_locked_until) > new Date()) throw new HttpError(429, 'Signing is locked for a few minutes because of wrong PINs. Try again later.');
  const p = String(pin ?? '').trim();
  if (!/^\d{4,6}$/.test(p) || !(await bcrypt.compare(p, u.signing_pin_hash))) {
    const n = u.pin_fails + 1;
    await db0('users').where({ id: u.id }).update(n >= MAX_FAILS ? { pin_fails: 0, pin_locked_until: new Date(Date.now() + LOCK_MIN * 60000) } : { pin_fails: n });
    await audit({ user, ip: null }, 'sign.pin_failed', `Wrong signing PIN by ${user.full_name} (${n} of ${MAX_FAILS})`, { userId: u.id, schoolId: user.school_id }).catch(() => {});
    throw new HttpError(403, n >= MAX_FAILS ? `Wrong PIN ${MAX_FAILS} times. Signing is locked for ${LOCK_MIN} minutes.` : `The signing PIN is wrong. ${MAX_FAILS - n} tries left.`);
  }
  if (u.pin_fails) await db0('users').where({ id: u.id }).update({ pin_fails: 0 });
  if (amount >= BIG && id) await checkSms(u, type, id, smsCode);
}
const needCode = (e) => { e.extra = { needSmsCode: true }; return e; };
async function checkSms(u, type, id, smsCode) {
  const code = String(smsCode ?? '').replace(/\D/g, '').slice(0, 6);
  const open = await db0('sign_codes').where({ user_id: u.id, doc_type: type, doc_id: id }).whereNull('used_at').where('expires_at', '>', db0.fn.now()).orderBy('id', 'desc').first();
  if (code.length !== 6) {
    if (!open || Date.now() - new Date(open.created_at).getTime() > 30000) {
      const fresh = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      await db0('sign_codes').insert({ user_id: u.id, doc_type: type, doc_id: id, code_hash: codeHash(u.id, fresh), expires_at: new Date(Date.now() + CODE_MIN * 60000) });
      const ok = await sms.send(u.phone, `Musabe: code to sign a paper of TSh ${BIG.toLocaleString('en-GB')} or more: ${fresh}. Valid ${CODE_MIN} minutes. Never tell it to anyone.`).catch(() => false);
      if (!ok) throw new HttpError(503, 'The SMS code could not be sent now. Try again in a minute.');
    }
    throw needCode(new HttpError(428, `This amount is TSh ${BIG.toLocaleString('en-GB')} or more. Type the code sent by SMS to your phone.`));
  }
  if (!open || open.attempts >= 3 || !same(codeHash(u.id, code), open.code_hash)) {
    if (open) await db0('sign_codes').where({ id: open.id }).increment('attempts', 1);
    throw needCode(new HttpError(403, 'The SMS code is wrong or has expired.'));
  }
  await db0('sign_codes').where({ id: open.id }).update({ used_at: db0.fn.now() });
}

// Inside the transaction: put the signature on the paper. o: { allowSame, sameOkIfActing, acting, note, user, image, name, role }
async function stamp(trx, req, type, id, step, content, o = {}) {
  const who = o.user || req.user;
  if (who.id != null && !o.allowSame) {
    const mine = await trx('signatures').where({ doc_type: type, doc_id: id, user_id: who.id }).whereNot({ step });
    if (mine.length && !(o.sameOkIfActing && mine.every((s) => s.acting)))
      throw new HttpError(403, 'You already signed this paper at another step. A different person must sign here.');
  }
  let image = o.image;
  if (image === undefined) image = (await trx('users').where({ id: who.id }).first('signature_image'))?.signature_image || null;
  const prev = await trx('signatures').where({ doc_type: type, doc_id: id }).orderBy('id', 'desc').first('mac');
  const row = { doc_type: type, doc_id: id, step, user_id: who.id ?? null, user_name: String(o.name || who.full_name).slice(0, 120), role: o.role === undefined ? who.role : o.role,
    image, acting: !!o.acting, note: o.note || null, content_hash: hashOf(content), prev_mac: prev?.mac || null, signed_at: new Date(), ip: req.ip || null };
  row.mac = macOf(row);
  await trx('signatures').insert(row);
  return row.mac;
}

// Short code printed under the QR. It depends on the paper's numbers, so a changed paper has another code.
function checkCode(type, id, content) {
  const h = hmac(`check|${type}|${id}|${hashOf(content)}`).slice(0, 12).toUpperCase();
  return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`;
}
// The seal of a paper now: { status: 'valid' | 'broken' | 'unsigned', code, signatures, reason }
async function seal(db, type, id, content) {
  const sigs = await db('signatures').where({ doc_type: type, doc_id: id }).orderBy('id');
  const code = checkCode(type, id, content);
  if (!sigs.length) return { status: 'unsigned', code, signatures: 0 };
  let prev = null;
  for (const s of sigs) {
    if ((s.prev_mac || null) !== prev || !same(macOf(s), s.mac)) return { status: 'broken', code, signatures: sigs.length, reason: 'A signature record was changed.' };
    prev = s.mac;
  }
  if (sigs.at(-1).content_hash !== hashOf(content)) return { status: 'broken', code, signatures: sigs.length, reason: 'A number on this paper was changed after it was signed.' };
  return { status: 'valid', code, signatures: sigs.length };
}

module.exports = { signaturesOf, checkSigning, stamp, seal, checkCode, hashOf, BIG };
