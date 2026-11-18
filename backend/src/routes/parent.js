// The parents' mobile app (Musabe Parents). Mounted at /api/parent.
//
// How a parent gets in (no username, no password):
//   1. The School Admin writes the parent's phone on the student's record (one by one or in the Excel class list).
//   2. The parent opens the app and types that phone number: POST /auth/start sends a 6-digit code by SMS.
//   3. The parent types the code: POST /auth/verify makes the account the first time and gives the app a token.
//      The app keeps the token in the phone's secure storage and sends it as "Authorization: Bearer <token>".
//   The parent stays signed in on that phone (180 days, or 60 days without opening the app).
//
// What a parent sees: every student whose record has their phone (any of the three schools), plus students the
// School Admin linked to them after a request (student_guardians). Nothing else: every child route checks this.
//
// Staff accounts never sign in here. A staff member who is also a parent signs in with the phone on the child's record.
// Messages come back in the language of the app (header X-Lang: sw | en). Kiswahili is the default.
const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit').default || require('express-rate-limit');
const db = require('../db');
const { HttpError, sha256, tzPhone, audit } = require('../lib/util');
const sms = require('../lib/sms');

const router = express.Router();

const LIFE = 180 * 24 * 60 * 60 * 1000;   // a sign-in lasts 180 days
const IDLE = 60 * 24 * 60 * 60 * 1000;    // ... or ends after 60 days without opening the app
const CODE_MIN = 10;                      // a code works for 10 minutes
const MAX_TRIES = 5;                      // wrong tries per code
const MAX_SENDS = 3;                      // codes per phone in 15 minutes
const MAX_PHONES = 5;                     // phones signed in at the same time per parent

// ---------- Messages (Kiswahili / English) ----------
const T = {
  phone: { sw: 'Andika namba ya simu yenye tarakimu 10 inayoanza na 06 au 07, mfano 0754 123 456.', en: 'Type a phone number of 10 digits starting with 06 or 07, e.g. 0754 123 456.' },
  unknown: { sw: 'Namba hii haijaandikwa kama namba ya mzazi katika shule yoyote ya Musabe. Wasiliana na ofisi ya shule ya mtoto wako ili waiweke kwenye taarifa za mwanafunzi.',
    en: "This number is not written as a parent's number at any Musabe school. Ask your child's school office to put it on the student's record." },
  off: { sw: 'Akaunti hii imezimwa na shule. Wasiliana na ofisi ya shule.', en: 'This account was switched off by the school. Contact the school office.' },
  smsOff: { sw: 'Huduma ya SMS bado haijawashwa. Jaribu tena baadaye.', en: 'SMS is not set up yet. Try again later.' },
  smsFail: { sw: 'Imeshindikana kutuma SMS. Jaribu tena baada ya muda mfupi.', en: 'The SMS could not be sent. Try again in a moment.' },
  tooMany: { sw: 'Umeomba namba mara nyingi. Subiri dakika 15 kisha ujaribu tena.', en: 'Too many codes asked for. Wait 15 minutes and try again.' },
  code: { sw: 'Namba ya uthibitisho imepitwa na muda au imekosewa mara nyingi. Omba namba mpya.', en: 'The code is too old or was typed wrong too many times. Ask for a new code.' },
  codeWrong: { sw: 'Namba si sahihi. Jaribu tena.', en: 'Wrong code. Try again.' },
  signin: { sw: 'Tafadhali ingia tena.', en: 'Please sign in again.' },
  notFound: { sw: 'Haikupatikana.', en: 'Not found.' },
  bad: { sw: 'Ombi si sahihi.', en: 'Bad request.' },
  reqFields: { sw: 'Chagua shule, uhusiano wako na mtoto, na uandike jina la mtoto.', en: "Choose the school and how you are related to the child, and type the child's name." },
  reqMany: { sw: 'Una maombi 5 yanayosubiri. Subiri shule ijibu kwanza.', en: 'You have 5 requests waiting. Wait for the school to answer first.' },
  limit: { sw: 'Maombi mengi sana. Subiri kidogo kisha ujaribu tena.', en: 'Too many requests. Wait a little and try again.' },
};
const lang = (req) => {
  const h = String(req.get('x-lang') || '').toLowerCase();
  if (h.startsWith('en')) return 'en';
  if (h.startsWith('sw')) return 'sw';
  return req.parent?.locale || 'sw';
};
const fail = (req, status, key) => new HttpError(status, T[key][lang(req)]);
const clean = (v, max) => String(v ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, max);
const phoneOf = (req, v) => {
  let p = null;
  try { p = tzPhone(v); } catch { /* below */ }
  if (!p) throw fail(req, 400, 'phone');
  return p;
};

// Limits. Many parents share one public address (mobile networks), so the limits count by phone or by sign-in,
// not only by address.
const keyed = (fn) => ({ standardHeaders: true, legacyHeaders: false, validate: { keyGeneratorIpFallback: false }, keyGenerator: fn,
  handler: (req, res) => res.status(429).json({ error: T.limit[lang(req)] }) });
const bodyPhone = (req) => String(req.body?.phone || '').replace(/\D/g, '').slice(-9);
const startLimit = rateLimit({ windowMs: 15 * 60000, limit: 6, ...keyed((req) => `s${bodyPhone(req)}|${req.ip}`) });
const startAddrLimit = rateLimit({ windowMs: 15 * 60000, limit: 200, ...keyed((req) => `a${req.ip}`) });
const verifyLimit = rateLimit({ windowMs: 15 * 60000, limit: 20, ...keyed((req) => `v${bodyPhone(req)}|${req.ip}`) });
const bearer = (req) => /^Bearer ([a-f0-9]{64})$/.exec(req.get('authorization') || '')?.[1];
const appLimit = rateLimit({ windowMs: 60000, limit: 300, ...keyed((req) => { const t = bearer(req); return t ? `t${sha256(t).slice(0, 24)}` : `i${req.ip}`; }) });
router.use(appLimit);

const parentOut = (p) => ({ id: p.id, phone: p.phone, fullName: p.full_name || '', locale: p.locale });

// ---------- Sign in ----------
// Is this phone a parent's? On a student's record (any school, any status), or already an account.
const onRecord = async (phone) => !!(await db('students').where({ parent_phone: phone }).first('id'));

router.post('/auth/start', startAddrLimit, startLimit, async (req, res) => {
  const phone = phoneOf(req, req.body?.phone);
  const p = await db('parents').where({ phone }).first();
  if (p && !p.active) throw fail(req, 403, 'off');
  if (!p && !(await onRecord(phone))) throw fail(req, 404, 'unknown');
  if (!sms.mode()) throw fail(req, 503, 'smsOff');
  const { n } = await db('parent_codes').where({ phone }).andWhereRaw("created_at > now() - interval '15 minutes'").count({ n: '*' }).first();
  if (Number(n) >= MAX_SENDS) throw fail(req, 429, 'tooMany');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await db.transaction(async (trx) => {
    await trx('parent_codes').where({ phone }).whereNull('used_at').update({ used_at: trx.fn.now() }); // older codes stop working
    await trx('parent_codes').insert({ phone, code_hash: sha256(`${phone}|${code}`), ip: req.ip, expires_at: new Date(Date.now() + CODE_MIN * 60000) });
  });
  const text = lang(req) === 'en'
    ? `Musabe Parents: your sign-in code is ${code}. It works for ${CODE_MIN} minutes. Do not give it to anyone.`
    : `Musabe Parents: namba yako ya kuingia ni ${code}. Inafanya kazi kwa dakika ${CODE_MIN}. Usimpe mtu yeyote.`;
  if (!(await sms.send(phone, text).catch(() => false))) throw fail(req, 502, 'smsFail');
  res.json({ ok: true, hint: sms.hint(phone), minutes: CODE_MIN, dev: sms.mode() === 'dev' });
});

router.post('/auth/verify', verifyLimit, async (req, res) => {
  const phone = phoneOf(req, req.body?.phone);
  const code = String(req.body?.code || '').replace(/\D/g, '');
  const row = await db('parent_codes').where({ phone }).whereNull('used_at').andWhere('expires_at', '>', db.fn.now()).orderBy('id', 'desc').first();
  if (!row || row.attempts >= MAX_TRIES) throw fail(req, 400, 'code');
  const good = code.length === 6 && crypto.timingSafeEqual(Buffer.from(sha256(`${phone}|${code}`)), Buffer.from(row.code_hash));
  if (!good) {
    await db('parent_codes').where({ id: row.id }).increment('attempts', 1);
    throw fail(req, 400, row.attempts + 1 >= MAX_TRIES ? 'code' : 'codeWrong');
  }
  // Used once only, even if two taps arrive together.
  if (!(await db('parent_codes').where({ id: row.id }).whereNull('used_at').update({ used_at: db.fn.now() }))) throw fail(req, 400, 'code');

  let p = await db('parents').where({ phone }).first();
  if (p && !p.active) throw fail(req, 403, 'off');
  if (!p) {
    // First time: the account takes the parent's name from the newest student record with this phone.
    const s = await db('students').where({ parent_phone: phone }).whereNotNull('parent_name').orderBy('updated_at', 'desc').first('parent_name');
    await db('parents').insert({ phone, full_name: s?.parent_name || null, locale: lang(req) }).onConflict('phone').ignore();
    p = await db('parents').where({ phone }).first();
    await audit(req, 'parent.register', `Parent ${p.full_name ? `${p.full_name} (${phone})` : phone} opened an account in the parents' app`);
  }
  const token = crypto.randomBytes(32).toString('hex');
  await db('parent_sessions').insert({ id: sha256(token), parent_id: p.id, device: clean(req.body?.device, 80) || null, ip: req.ip, expires_at: new Date(Date.now() + LIFE) });
  await db('parents').where({ id: p.id }).update({ last_login_at: db.fn.now() });
  // At most MAX_PHONES phones at once: the ones not used for longest are signed out.
  const extra = await db('parent_sessions').where({ parent_id: p.id }).orderBy('last_seen_at', 'desc').offset(MAX_PHONES).pluck('id');
  if (extra.length) await db('parent_sessions').whereIn('id', extra).del();
  res.json({ token, parent: parentOut(p) });
});

// Every route below needs a signed-in parent.
async function requireParent(req, _res, next) {
  const t = bearer(req);
  if (!t) throw fail(req, 401, 'signin');
  const row = await db('parent_sessions as s').join('parents as p', 'p.id', 's.parent_id')
    .where('s.id', sha256(t)).andWhere('s.expires_at', '>', db.fn.now())
    .select('p.*', 's.id as sid', 's.last_seen_at as seen').first();
  if (!row || !row.active) throw fail(req, 401, 'signin');
  const idle = Date.now() - new Date(row.seen).getTime();
  if (idle > IDLE) { await db('parent_sessions').where({ id: row.sid }).del(); throw fail(req, 401, 'signin'); }
  if (idle > 60000) db('parent_sessions').where({ id: row.sid }).update({ last_seen_at: db.fn.now() }).catch(() => {});
  row.notices_seen = Number(row.notices_seen) || 0;
  req.parent = row;
  next();
}

router.post('/auth/logout', requireParent, async (req, res) => {
  await db('parent_sessions').where({ id: req.parent.sid }).del();
  res.json({ ok: true });
});

router.use(requireParent);

// ---------- Children ----------
// Ids of this parent's children: phone on the record, or linked by the School Admin.
async function childIds(p) {
  const [own, linked] = await Promise.all([
    db('students').where({ parent_phone: p.phone }).pluck('id'),
    db('student_guardians').where({ parent_id: p.id, active: true }).pluck('student_id'),
  ]);
  return [...new Set([...own, ...linked])];
}

const SQ = () => db('students as s').join('schools as sc', 'sc.id', 's.school_id').leftJoin('classes as c', 'c.id', 's.class_id')
  .leftJoin('photos as ph', 'ph.student_id', 's.id')
  .select('s.id', 's.full_name', 's.first_name', 's.last_name', 's.admission_no', 's.sex', 's.status', 's.school_id',
    'sc.name as school_name', 'sc.short_name as school_short', 'sc.code as school_code',
    'c.name as class_name', 'c.short_name as class_short', 'c.stream as class_stream', 'ph.updated_at as photo_at');
const classLabel = (s) => [s.class_short || s.class_name, s.class_stream].filter(Boolean).join(' ');
const classFull = (s) => [s.class_name, s.class_stream].filter(Boolean).join(' ');
const childOut = (s) => ({
  id: s.id, fullName: s.full_name, firstName: s.first_name, admissionNo: s.admission_no, sex: s.sex, status: s.status,
  class: classLabel(s), classFull: classFull(s),
  school: { id: s.school_id, name: s.school_name, shortName: s.school_short, code: s.school_code },
  photo: s.photo_at ? new Date(s.photo_at).getTime() : null,
});

// Summary numbers per child for the home screen.
async function summaries(ids, p) {
  const m = {};
  for (const id of ids) m[id] = { itemsWaiting: 0, bills: 0, billsTotal: 0, unread: 0, idCard: null, borrowed: 0 };
  if (!ids.length) return m;
  const [rec, bills, notes, cards, out] = await Promise.all([
    db('receipts').whereIn('student_id', ids).whereNot('status', 'given').groupBy('student_id').select('student_id').count({ n: '*' }),
    db('bills').whereIn('student_id', ids).where('status', 'pending').andWhere('expires_at', '>', db.fn.now()).groupBy('student_id').select('student_id').count({ n: '*' }).sum({ total: 'total' }),
    db('parent_notices').whereIn('student_id', ids).andWhere('id', '>', p.notices_seen).groupBy('student_id').select('student_id').count({ n: '*' }),
    db('id_cards').whereIn('student_id', ids).whereNull('ended_at').select('student_id', 'issued_at'),
    db('issue_lines as l').join('issues as i', 'i.id', 'l.issue_id').whereIn('i.student_id', ids).whereNotNull('l.copy_id').whereNull('l.returned')
      .groupBy('i.student_id').select('i.student_id').count({ n: '*' }),
  ]);
  for (const r of rec) m[r.student_id].itemsWaiting = Number(r.n);
  for (const r of bills) { m[r.student_id].bills = Number(r.n); m[r.student_id].billsTotal = Number(r.total); }
  for (const r of notes) m[r.student_id].unread = Number(r.n);
  for (const r of cards) m[r.student_id].idCard = r.issued_at;
  for (const r of out) m[r.student_id].borrowed = Number(r.n);
  return m;
}

router.get('/me', async (req, res) => {
  const p = req.parent;
  const ids = await childIds(p);
  const rows = ids.length ? await SQ().whereIn('s.id', ids).orderByRaw("s.status = 'left', s.school_id, s.first_name") : [];
  const sum = await summaries(ids, p);
  const pending = await db('parent_requests').where({ parent_id: p.id, status: 'pending' }).count({ n: '*' }).first();
  res.json({ parent: parentOut(p), children: rows.map((s) => ({ ...childOut(s), ...sum[s.id] })), requestsPending: Number(pending.n) });
});

router.patch('/me', async (req, res) => {
  const ch = {};
  if (req.body?.fullName !== undefined) ch.full_name = clean(req.body.fullName, 120).toUpperCase() || null;
  if (req.body?.locale !== undefined) { if (!['sw', 'en'].includes(req.body.locale)) throw fail(req, 400, 'bad'); ch.locale = req.body.locale; }
  if (Object.keys(ch).length) await db('parents').where({ id: req.parent.id }).update(ch);
  res.json({ parent: parentOut(await db('parents').where({ id: req.parent.id }).first()) });
});

// One child of this parent, or 404 (never says whether the student exists).
async function myChild(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw fail(req, 404, 'notFound');
  const ids = await childIds(req.parent);
  if (!ids.includes(id)) throw fail(req, 404, 'notFound');
  return SQ().where('s.id', id).first();
}

router.get('/children/:id', async (req, res) => {
  const s = await myChild(req);
  const sum = (await summaries([s.id], req.parent))[s.id];
  const card = await db('id_cards').where({ student_id: s.id }).whereNull('ended_at').first('card_no', 'issued_at');
  res.json({ child: { ...childOut(s), ...sum, idCard: card ? { no: card.card_no, issuedAt: card.issued_at } : null } });
});

router.get('/children/:id/photo', async (req, res) => {
  const s = await myChild(req);
  const ph = await db('photos').where({ student_id: s.id }).first('mime', 'data');
  if (!ph) throw fail(req, 404, 'notFound');
  res.set({ 'Content-Type': ph.mime, 'Cache-Control': 'private, max-age=86400' });
  res.send(ph.data);
});

// Receipts (what was paid for) and whether the library has given the items.
router.get('/children/:id/receipts', async (req, res) => {
  const s = await myChild(req);
  const rs = await db('receipts').where({ student_id: s.id }).orderBy('sold_at', 'desc').limit(60)
    .select('id', 'number', 'total', 'method', 'reference', 'status', 'sold_at', 'given_at', 'student_class', 'payer_name');
  const lines = rs.length ? await db('receipt_lines').whereIn('receipt_id', rs.map((r) => r.id)).orderBy('id')
    .select('receipt_id', 'item_name', 'qty', 'unit_price', 'amount', 'given_qty', 'out_of_stock') : [];
  res.json({ receipts: rs.map((r) => ({
    id: r.id, number: r.number, total: r.total, method: r.method, reference: r.reference, status: r.status, soldAt: r.sold_at, givenAt: r.given_at,
    class: r.student_class, payer: r.payer_name,
    lines: lines.filter((l) => l.receipt_id === r.id).map((l) => ({ item: l.item_name, qty: l.qty, price: l.unit_price, amount: l.amount, given: l.given_qty, waitingStock: l.out_of_stock })),
  })) });
});

// Control numbers waiting to be paid (bank / mobile money), and the last ones paid or cancelled.
router.get('/children/:id/bills', async (req, res) => {
  const s = await myChild(req);
  const bs = await db('bills').where({ student_id: s.id })
    .andWhere((w) => w.where('status', 'pending').orWhereRaw("coalesce(paid_at, cancelled_at, created_at) > now() - interval '60 days'"))
    .orderBy('created_at', 'desc').limit(30)
    .select('id', 'control_no', 'total', 'status', 'expires_at', 'created_at', 'paid_at');
  const lines = bs.length ? await db('bill_lines').whereIn('bill_id', bs.map((b) => b.id)).orderBy('id').select('bill_id', 'item_name', 'qty', 'amount') : [];
  const now = Date.now();
  res.json({ bills: bs.map((b) => ({
    id: b.id, controlNo: b.control_no, total: b.total, createdAt: b.created_at, expiresAt: b.expires_at, paidAt: b.paid_at,
    status: b.status === 'pending' && new Date(b.expires_at).getTime() < now ? 'expired' : b.status,
    lines: lines.filter((l) => l.bill_id === b.id).map((l) => ({ item: l.item_name, qty: l.qty, amount: l.amount })),
  })) });
});

// Things the school gave out to the child (books, instruments ...), and whether those that come back were returned.
router.get('/children/:id/issued', async (req, res) => {
  const s = await myChild(req);
  const rows = await db('issue_lines as l').join('issues as i', 'i.id', 'l.issue_id').where('i.student_id', s.id)
    .orderBy('i.at', 'desc').limit(100)
    .select('l.id', 'i.number', 'i.at', 'l.item_name', 'l.unit', 'l.qty', 'l.copy_id', 'l.returned', 'l.returned_at');
  res.json({ issued: rows.map((r) => ({ id: r.id, number: r.number, at: r.at, item: r.item_name, unit: r.unit, qty: r.qty,
    comesBack: !!r.copy_id, returned: r.returned, returnedAt: r.returned_at })) });
});

// ---------- Notices ----------
// From the school about the children: items collected, issued, returned, receipts. Newest first, 40 at a time.
router.get('/notices', async (req, res) => {
  const p = req.parent;
  let ids = await childIds(p);
  if (req.query.child) ids = ids.filter((i) => i === Number(req.query.child));
  if (!ids.length) return res.json({ notices: [], unread: 0, more: false });
  const q = db('parent_notices as n').join('students as s', 's.id', 'n.student_id').join('schools as sc', 'sc.id', 'n.school_id')
    .whereIn('n.student_id', ids).orderBy('n.id', 'desc').limit(41)
    .select('n.id', 'n.student_id', 'n.kind', 'n.title', 'n.body', 'n.ref', 'n.created_at', 's.first_name', 's.full_name', 'sc.short_name as school');
  if (Number(req.query.before) > 0) q.andWhere('n.id', '<', Number(req.query.before));
  const rows = await q;
  const more = rows.length > 40;
  const list = rows.slice(0, 40).map((x) => ({ ...x, id: Number(x.id) }));
  const fresh = list.filter((n) => n.id > p.notices_seen).map((n) => n.id);
  if (fresh.length) await db('parent_notices').whereIn('id', fresh).whereNull('sent_at').update({ sent_at: db.fn.now() });
  const { n } = await db('parent_notices').whereIn('student_id', ids).andWhere('id', '>', p.notices_seen).count({ n: '*' }).first();
  res.json({ unread: Number(n), more, notices: list.map((x) => ({ id: x.id, childId: x.student_id, child: x.first_name, childFull: x.full_name, school: x.school,
    kind: x.kind, title: x.title, body: x.body, ref: x.ref, at: x.created_at, unread: x.id > p.notices_seen })) });
});

// The parent has seen the notices up to this one.
router.post('/notices/seen', async (req, res) => {
  const ids = await childIds(req.parent);
  const top = ids.length ? Number((await db('parent_notices').whereIn('student_id', ids).max({ m: 'id' }).first()).m) || 0 : 0;
  const upTo = Math.min(Number(req.body?.upTo) || top, top);
  if (upTo > req.parent.notices_seen) await db('parents').where({ id: req.parent.id }).update({ notices_seen: upTo });
  res.json({ ok: true });
});

// ---------- "My child is missing" ----------
router.get('/schools', async (_req, res) => {
  res.json({ schools: await db('schools').where({ active: true }).orderBy('id').select('id', 'name', 'short_name as shortName', 'code') });
});

router.get('/requests', async (req, res) => {
  const rows = await db('parent_requests as r').join('schools as sc', 'sc.id', 'r.school_id').where('r.parent_id', req.parent.id)
    .orderBy('r.created_at', 'desc').limit(30)
    .select('r.id', 'r.child_name', 'r.admission_no', 'r.class_name', 'r.relation', 'r.status', 'r.answer', 'r.created_at', 'r.decided_at', 'sc.short_name as school');
  res.json({ requests: rows.map((r) => ({ id: r.id, childName: r.child_name, admissionNo: r.admission_no, className: r.class_name, relation: r.relation,
    status: r.status, answer: r.answer, school: r.school, at: r.created_at, decidedAt: r.decided_at })) });
});

router.post('/requests', async (req, res) => {
  const p = req.parent;
  const schoolId = Number(req.body?.schoolId);
  const childName = clean(req.body?.childName, 120).toUpperCase();
  const relation = String(req.body?.relation || '');
  if (!Number.isInteger(schoolId) || schoolId <= 0 || childName.length < 3 || !['mother', 'father', 'guardian'].includes(relation)) throw fail(req, 400, 'reqFields');
  const school = await db('schools').where({ id: schoolId, active: true }).first('id');
  if (!school) throw fail(req, 400, 'reqFields');
  const { n } = await db('parent_requests').where({ parent_id: p.id, status: 'pending' }).count({ n: '*' }).first();
  if (Number(n) >= 5) throw fail(req, 429, 'reqMany');
  const admissionNo = clean(req.body?.admissionNo, 20).toUpperCase() || null;
  const className = clean(req.body?.className, 40).toUpperCase() || null;
  const [row] = await db('parent_requests').insert({ parent_id: p.id, school_id: schoolId, child_name: childName, admission_no: admissionNo,
    class_name: className, relation, note: clean(req.body?.note, 200) || null }).returning('id');
  const who = p.full_name ? `${p.full_name} (${p.phone})` : p.phone;
  await audit(req, 'parent.request', `Parent ${who} asks to see ${childName}${admissionNo ? `, Adm. No. ${admissionNo}` : ''}${className ? `, ${className}` : ''} (${relation}) in the parents' app`,
    { schoolId, detail: { requestId: row?.id ?? row } });
  res.json({ ok: true });
});

module.exports = { router };
