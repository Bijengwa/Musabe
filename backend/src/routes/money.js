// Daily money: the accountant checks each bursar's money for a day.
// The receipts say how much came in (cash, bank, mobile money, control number). The accountant counts the cash
// handed over (or sees it on the bank slip) and records the check once. It is never changed afterwards.
// - Accountant: checks (page "money" full).
// - Finance office, Assistant Accountant, leaders: view. A bursar sees only their own days.
const express = require('express');
const db = require('../db');
const { HttpError, audit } = require('../lib/util');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES, pageAccess } = require('../auth/roles');
const { sendExcel } = require('../lib/excel');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const DAY = `(r.sold_at AT TIME ZONE '${TZ}')::date`;
const allSchools = (u) => ROLES[u.role]?.scope === 'all';
const clean = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const money = (n) => `TSh ${Number(n).toLocaleString('en-GB')}`;
const num = (v) => Number(v || 0);
const RESULT = { ok: 'Correct', short: 'Short', over: 'Over' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const daysAgo = (n) => { const d = new Date(`${today()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

// One row per bursar per day with receipts, plus the accountant's check if done.
async function days(user, f = {}) {
  const school = allSchools(user) ? Number(f.school) || null : user.school_id;
  const from = isDate(f.from) ? f.from : daysAgo(13);
  const to = isDate(f.to) ? f.to : today();
  const q = db('receipts as r').join('users as u', 'u.id', 'r.sold_by').join('schools as s', 's.id', 'r.school_id')
    .where('u.role', 'bursar').whereRaw(`${DAY} between ? and ?`, [from, to]);
  if (school) q.where('r.school_id', school);
  if (user.role === 'bursar') q.where('r.sold_by', user.id);
  else if (f.bursar) q.where('r.sold_by', Number(f.bursar));
  const rows = await q.groupBy('r.sold_by', 'u.full_name', 's.id', 's.short_name', 's.code', db.raw(DAY))
    .orderByRaw(`${DAY} desc`).orderBy('s.id').orderBy('u.full_name')
    .select('r.sold_by as bursar_id', 'u.full_name as bursar', 's.id as school_id', 's.short_name as school', 's.code', db.raw(`${DAY}::text as day`),
      db.raw(`count(*)::int as n, sum(r.total)::bigint as total,
        coalesce(sum(r.total) filter (where r.method='cash'),0)::bigint as cash, coalesce(sum(r.total) filter (where r.method='bank'),0)::bigint as bank,
        coalesce(sum(r.total) filter (where r.method='mobile'),0)::bigint as mobile, coalesce(sum(r.total) filter (where r.method='control'),0)::bigint as control`));
  const checks = rows.length ? await db('money_checks as m').join('users as c', 'c.id', 'm.checked_by')
    .whereIn('m.bursar_id', [...new Set(rows.map((r) => r.bursar_id))]).whereBetween('m.day', [from, to])
    .select('m.*', db.raw('m.day::text as day_text'), 'c.full_name as checked_by_name') : [];
  const C = Object.fromEntries(checks.map((c) => [`${c.bursar_id}:${c.day_text}`, c]));
  let out = rows.map((r) => {
    const c = C[`${r.bursar_id}:${r.day}`];
    return { bursarId: r.bursar_id, bursar: r.bursar, schoolId: r.school_id, school: r.school, code: r.code, day: r.day, receipts: r.n,
      total: num(r.total), cash: num(r.cash), bank: num(r.bank), mobile: num(r.mobile), control: num(r.control),
      check: c ? { id: c.id, cashCounted: num(c.cash_counted), difference: num(c.cash_counted) - num(c.cash), result: c.result, resultLabel: RESULT[c.result],
        bankSlip: c.bank_slip, note: c.note, by: c.checked_by_name, at: c.checked_at, changedSince: num(c.system_total) !== num(r.total) } : null };
  });
  if (f.status === 'open') out = out.filter((r) => !r.check);
  else if (f.status === 'checked') out = out.filter((r) => r.check);
  else if (f.status === 'problem') out = out.filter((r) => r.check && r.check.result !== 'ok');
  return { from, to, rows: out };
}

router.get('/', requirePage('money'), async (req, res) => {
  const d = await days(req.user, req.query);
  res.json({ ...d, canCheck: pageAccess(req.user.role, 'money') === 'f',
    totals: { days: d.rows.length, open: d.rows.filter((r) => !r.check).length, problems: d.rows.filter((r) => r.check && r.check.result !== 'ok').length,
      cash: d.rows.reduce((s, r) => s + r.cash, 0), total: d.rows.reduce((s, r) => s + r.total, 0) } });
});

function moneySheet(rows, title = 'Musabe Schools: daily money by bursar (TSh)') {
  return {
    name: 'Daily money', title,
    columns: [
      { header: 'S/N', key: 'sn', type: 'int', width: 6 }, { header: 'Date', key: 'day', width: 12 }, { header: 'School', key: 'school', width: 16 },
      { header: 'Bursar', key: 'bursar', width: 22 }, { header: 'Receipts', key: 'receipts', type: 'int', width: 9 },
      { header: 'Cash', key: 'cash', type: 'money', width: 12 }, { header: 'Bank', key: 'bank', type: 'money', width: 12 },
      { header: 'Mobile money', key: 'mobile', type: 'money', width: 13 }, { header: 'Control number', key: 'control', type: 'money', width: 14 },
      { header: 'Total', key: 'total', type: 'money', width: 12 }, { header: 'Cash counted', key: 'counted', type: 'money', width: 13 },
      { header: 'Difference', key: 'diff', type: 'money', width: 11 }, { header: 'Check', key: 'result', width: 10 },
      { header: 'Bank slip', key: 'slip', width: 16 }, { header: 'Note', key: 'note', width: 26 }, { header: 'Checked by', key: 'by', width: 20 },
    ],
    rows: rows.map((r, i) => ({ sn: i + 1, ...r, counted: r.check?.cashCounted, diff: r.check?.difference, result: r.check ? r.check.resultLabel : 'Not checked',
      slip: r.check?.bankSlip, note: r.check?.note, by: r.check?.by })),
  };
}

router.get('/export.xlsx', requirePage('money'), async (req, res) => {
  const d = await days(req.user, req.query);
  await sendExcel(res, 'musabe-daily-money', [moneySheet(d.rows, `Musabe Schools: daily money by bursar, ${d.from} to ${d.to} (TSh)`)]);
});

router.post('/check', requirePage('money', 'f'), async (req, res) => {
  const b = req.body || {};
  const bursarId = Number(b.bursarId), day = String(b.day || '');
  if (!isDate(day)) throw new HttpError(400, 'Choose the day.');
  if (day > today()) throw new HttpError(400, 'That day has not come yet.');
  const counted = Number(String(b.cashCounted ?? '').replace(/[,\s]/g, ''));
  if (!Number.isInteger(counted) || counted < 0) throw new HttpError(400, 'Type the cash you received or saw banked (a whole amount, 0 if none).');
  const slip = clean(b.bankSlip, 60).toUpperCase() || null;
  const note = clean(b.note, 300) || null;
  const bursar = await db('users').where({ id: bursarId || 0, role: 'bursar' }).first();
  if (!bursar) throw new HttpError(404, 'Bursar not found.');
  await db.transaction(async (trx) => {
    const [t] = await trx('receipts as r').where('r.sold_by', bursar.id).whereRaw(`${DAY} = ?`, [day]).select(db.raw(`count(*)::int as n,
      coalesce(sum(total),0)::bigint as total, coalesce(sum(total) filter (where method='cash'),0)::bigint as cash,
      coalesce(sum(total) filter (where method='bank'),0)::bigint as bank, coalesce(sum(total) filter (where method='mobile'),0)::bigint as mobile,
      coalesce(sum(total) filter (where method='control'),0)::bigint as control`));
    if (!t.n) throw new HttpError(400, `${bursar.full_name} has no receipts on ${day}.`);
    const cash = num(t.cash);
    const result = counted === cash ? 'ok' : counted < cash ? 'short' : 'over';
    if (result !== 'ok' && !note) throw new HttpError(400, `Cash is ${result} by ${money(Math.abs(counted - cash))}. Write a note about it.`);
    try {
      await trx('money_checks').insert({ school_id: bursar.school_id, bursar_id: bursar.id, day, receipts: t.n, system_total: t.total, cash: t.cash, bank: t.bank,
        mobile: t.mobile, control: t.control, cash_counted: counted, bank_slip: slip, note, result, checked_by: req.user.id });
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, `${bursar.full_name}'s money for ${day} is already checked.`);
      throw e;
    }
    await audit(req, result === 'ok' ? 'money.check' : 'money.problem',
      `${bursar.full_name}, ${day}: ${t.n} receipts, ${money(t.total)} (cash ${money(cash)}). Cash counted ${money(counted)}: `
      + (result === 'ok' ? 'correct' : `${result} by ${money(Math.abs(counted - cash))}`) + (slip ? `. Banked on slip ${slip}` : '') + (note ? `. ${note}` : ''),
      { schoolId: bursar.school_id, detail: { bursarId: bursar.id, userId: bursar.id, day } }, trx);
  });
  res.status(201).json({ ok: true });
});

module.exports = router;
module.exports.days = days;
module.exports.moneySheet = moneySheet;
