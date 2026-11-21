// Home page numbers. Each role gets its own set (GET /api/dashboard): what that person needs to see first.
// School roles only ever get their own school. Administration can narrow to one school with ?school=.
const express = require('express');
const db = require('../db');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES, pageAccess, DAMAGE_APPROVERS, ISSUERS, PURCHASE_CONFIRMERS, CARD_ISSUERS } = require('../auth/roles');
const { LATE_HOURS } = require('./receipts');
const { classLabel } = require('./students');

const router = express.Router();
router.use(requireAuth);

const TZ = 'Africa/Dar_es_Salaam';
const DAY = `(r.sold_at AT TIME ZONE '${TZ}')::date`;
const TODAY = `(now() AT TIME ZONE '${TZ}')::date`;
const num = (v) => Number(v || 0);
const METHOD = { cash: 'Cash', bank: 'Bank', mobile: 'Mobile money', control: 'Control number' };
const where = (q, schoolId, col = 'r.school_id') => (schoolId ? q.where(col, schoolId) : q);

// Money in: today, last 7 days, this month. With cash / bank / mobile for today.
async function sales(schoolId, soldBy) {
  const q = where(db('receipts as r'), schoolId);
  if (soldBy) q.where('r.sold_by', soldBy);
  const [s] = await q.select(db.raw(`
    count(*) filter (where ${DAY} = ${TODAY})::int as today_n,
    coalesce(sum(total) filter (where ${DAY} = ${TODAY}),0)::bigint as today,
    coalesce(sum(total) filter (where ${DAY} = ${TODAY} and method='cash'),0)::bigint as cash,
    coalesce(sum(total) filter (where ${DAY} = ${TODAY} and method='bank'),0)::bigint as bank,
    coalesce(sum(total) filter (where ${DAY} = ${TODAY} and method='mobile'),0)::bigint as mobile,
    coalesce(sum(total) filter (where ${DAY} = ${TODAY} and method='control'),0)::bigint as control,
    count(*) filter (where ${DAY} > ${TODAY} - 7)::int as week_n,
    coalesce(sum(total) filter (where ${DAY} > ${TODAY} - 7),0)::bigint as week,
    count(*) filter (where date_trunc('month', ${DAY}) = date_trunc('month', ${TODAY}))::int as month_n,
    coalesce(sum(total) filter (where date_trunc('month', ${DAY}) = date_trunc('month', ${TODAY})),0)::bigint as month`));
  return { today: { n: s.today_n, money: num(s.today), cash: num(s.cash), bank: num(s.bank), mobile: num(s.mobile), control: num(s.control) },
    week: { n: s.week_n, money: num(s.week) }, month: { n: s.month_n, money: num(s.month) } };
}

// Money per day for the last `days` days (days with no sales are 0).
async function trend(schoolId, days = 14) {
  const rows = await db.raw(`
    SELECT d::date AS day, coalesce(sum(r.total),0)::bigint AS money, count(r.id)::int AS n
    FROM generate_series(${TODAY} - ?::int + 1, ${TODAY}, interval '1 day') d
    LEFT JOIN receipts r ON ${DAY} = d::date ${schoolId ? 'AND r.school_id = ?' : ''}
    GROUP BY d ORDER BY d`, schoolId ? [days, schoolId] : [days]);
  return rows.rows.map((r) => ({ day: r.day.toISOString?.().slice(0, 10) ?? String(r.day).slice(0, 10), money: num(r.money), n: r.n }));
}

// Each school: money this month and today, receipts not given, late.
async function bySchool() {
  const rows = await db('schools as s').where('s.active', true).leftJoin('receipts as r', 'r.school_id', 's.id').groupBy('s.id').orderBy('s.id')
    .select('s.id', 's.short_name', 's.code', db.raw(`
      coalesce(sum(r.total) filter (where date_trunc('month', ${DAY}) = date_trunc('month', ${TODAY})),0)::bigint as month,
      coalesce(sum(r.total) filter (where ${DAY} = ${TODAY}),0)::bigint as today,
      count(r.id) filter (where r.status <> 'given')::int as open,
      count(r.id) filter (where r.status <> 'given' and r.sold_at < now() - make_interval(hours => ?))::int as late`, [LATE_HOURS]));
  return rows.map((r) => ({ id: r.id, name: r.short_name, code: r.code, month: num(r.month), today: num(r.today), open: r.open, late: r.late }));
}

// Each bursar today: how many receipts, how much by method. For the accountant's daily check.
async function byBursar(schoolId) {
  const q = db('users as u').join('schools as s', 's.id', 'u.school_id').where({ 'u.role': 'bursar', 'u.active': true })
    .leftJoin('receipts as r', (j) => j.on('r.sold_by', 'u.id').andOn(db.raw(`${DAY} = ${TODAY}`)));
  where(q, schoolId, 'u.school_id');
  const rows = await q.groupBy('u.id', 's.short_name', 's.code', 's.id').orderBy('s.id').orderBy('u.full_name')
    .select('u.id', 'u.full_name', 's.short_name as school', 's.code', db.raw(`count(r.id)::int as n, coalesce(sum(r.total),0)::bigint as money,
      coalesce(sum(r.total) filter (where r.method='cash'),0)::bigint as cash, coalesce(sum(r.total) filter (where r.method='bank'),0)::bigint as bank,
      coalesce(sum(r.total) filter (where r.method='mobile'),0)::bigint as mobile,
      coalesce(sum(r.total) filter (where r.method='control'),0)::bigint as control, max(r.sold_at) as last`));
  return rows.map((r) => ({ id: r.id, name: r.full_name, school: r.school, code: r.code, n: r.n, money: num(r.money), cash: num(r.cash), bank: num(r.bank), mobile: num(r.mobile), control: num(r.control), last: r.last }));
}

// What sells most (last 30 days).
async function topItems(schoolId, days = 30) {
  const q = db('receipt_lines as l').join('receipts as r', 'r.id', 'l.receipt_id').whereRaw(`${DAY} > ${TODAY} - ?::int`, [days]);
  where(q, schoolId);
  const rows = await q.groupBy('l.item_name').orderByRaw('sum(l.amount) desc').limit(8)
    .select('l.item_name as name', db.raw('sum(l.qty)::int as qty, sum(l.amount)::bigint as money'));
  return rows.map((r) => ({ name: r.name, qty: r.qty, money: num(r.money) }));
}

// Paid but not (fully) given: counts and the oldest ones.
async function open(schoolId, { soldBy, limit = 8 } = {}) {
  const q = () => {
    const x = where(db('receipts as r'), schoolId).whereIn('r.status', ['waiting', 'part']);
    if (soldBy) x.where('r.sold_by', soldBy);
    return x;
  };
  const [[c], rows] = await Promise.all([
    q().select(db.raw(`count(*)::int as n, (count(*) filter (where r.sold_at < now() - make_interval(hours => ?)))::int as late,
      coalesce(sum(total),0)::bigint as money`, [LATE_HOURS])),
    q().join('schools as s', 's.id', 'r.school_id').orderBy('r.sold_at').limit(limit)
      .select('r.id', 'r.number', 'r.student_name', 'r.student_class', 'r.total', 'r.status', 'r.sold_at', 's.short_name as school', 's.code'),
  ]);
  return { n: c.n, late: c.late, money: num(c.money), lateHours: LATE_HOURS,
    oldest: rows.map((r) => ({ id: r.id, number: r.number, student: r.student_name, cls: r.student_class, total: r.total, status: r.status,
      soldAt: r.sold_at, school: r.school, code: r.code, hours: Math.floor((Date.now() - new Date(r.sold_at)) / 3600000),
      late: Date.now() - new Date(r.sold_at) >= LATE_HOURS * 3600000 })) };
}

// The library today: how many gives, how many items handed over, which items.
async function library(schoolId) {
  const g = where(db('gives as g'), schoolId, 'g.school_id').whereRaw(`(g.at AT TIME ZONE '${TZ}')::date = ${TODAY}`);
  const [[c], items] = await Promise.all([
    g.clone().select(db.raw('count(distinct g.id)::int as gives, count(distinct g.receipt_id)::int as receipts')),
    g.clone().join('give_lines as l', 'l.give_id', 'g.id').join('items as i', 'i.id', 'l.item_id').groupBy('i.name').orderByRaw('sum(l.qty) desc').limit(8)
      .select('i.name', db.raw('sum(l.qty)::int as qty')),
  ]);
  return { gives: c.gives, receipts: c.receipts, items: items.map((i) => ({ name: i.name, qty: i.qty })), qty: items.reduce((s, i) => s + i.qty, 0) };
}

// Students: per school (administration) or per class (one school).
async function students(schoolId) {
  if (!schoolId) {
    const rows = await db('schools as s').where('s.active', true).leftJoin('students as st', (j) => j.on('st.school_id', 's.id').andOn(db.raw("st.status = 'active'")))
      .groupBy('s.id').orderBy('s.id').select('s.id', 's.short_name', 's.code',
        db.raw("count(st.id)::int as n, (count(st.id) filter (where st.sex='M'))::int as boys, (count(st.id) filter (where st.sex='F'))::int as girls"));
    return { total: rows.reduce((s, r) => s + r.n, 0), schools: rows.map((r) => ({ id: r.id, name: r.short_name, code: r.code, n: r.n, boys: r.boys, girls: r.girls })) };
  }
  const rows = await db('classes as c').where({ 'c.school_id': schoolId, 'c.active': true })
    .leftJoin('students as st', (j) => j.on('st.class_id', 'c.id').andOn(db.raw("st.status = 'active'")))
    .groupBy('c.id').select('c.*', db.raw(`count(st.id)::int as n, (count(st.id) filter (where st.sex='M'))::int as boys, (count(st.id) filter (where st.sex='F'))::int as girls,
      (count(st.id) filter (where st.parent_phone is null))::int as no_phone`));
  const classes = rows.map((c) => ({ id: c.id, label: classLabel(c), name: c.name, n: c.n, boys: c.boys, girls: c.girls, noPhone: c.no_phone }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
  return { total: classes.reduce((s, c) => s + c.n, 0), boys: classes.reduce((s, c) => s + c.boys, 0), girls: classes.reduce((s, c) => s + c.girls, 0),
    noPhone: classes.reduce((s, c) => s + c.noPhone, 0), classes };
}

// Items: how many on sale, and items a school does not have a price for (finance must fix).
async function items() {
  const [schools, list, [{ n: pending }]] = await Promise.all([
    db('schools').where({ active: true }).orderBy('id'),
    db('items as i').where('i.active', true).leftJoin('item_prices as p', 'p.item_id', 'i.id').groupBy('i.id').select('i.id', db.raw('array_agg(p.school_id) as schools')),
    db('item_imports').where({ status: 'pending' }).count('* as n'),
  ]);
  return { active: list.length, pendingUploads: num(pending),
    unpriced: schools.map((s) => ({ id: s.id, name: s.short_name, code: s.code, n: list.filter((i) => !(i.schools || []).includes(s.id)).length })) };
}

// For School Admin: class lists waiting for approval.
const pendingLists = async (schoolId) => num((await db('student_imports').where({ school_id: schoolId, status: 'pending' }).count('* as n'))[0].n);

// ---------- Sales dashboard (page "salesdash") ----------
// Only the finance office and the accountant office (and Super Admin / Director). Not bursars.
// GET /api/dashboard/sales?from=YYYY-MM-DD&to=YYYY-MM-DD&school=  (default: this month)
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
router.get('/sales', requirePage('salesdash'), async (req, res) => {
  const school = Number(req.query.school) || null;
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const from = isDate(req.query.from) ? req.query.from : `${todayStr.slice(0, 8)}01`;
  const to = isDate(req.query.to) ? req.query.to : todayStr;
  if (from > to) return res.status(400).json({ error: '"From" must be before "To".' });
  const spanDays = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  // The same number of days just before, to compare.
  const prevTo = new Date(new Date(from).getTime() - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(new Date(from).getTime() - spanDays * 86400000).toISOString().slice(0, 10);
  const inRange = (q, a = from, b = to) => where(q, school).whereRaw(`${DAY} between ? and ?`, [a, b]);

  const [[k], [prev], byDay, bySch, items, bursars, classes, [bills], [owed]] = await Promise.all([
    inRange(db('receipts as r')).select(db.raw(`count(*)::int as n, coalesce(sum(total),0)::bigint as money,
      coalesce(sum(total) filter (where method='cash'),0)::bigint as cash, coalesce(sum(total) filter (where method='bank'),0)::bigint as bank,
      coalesce(sum(total) filter (where method='mobile'),0)::bigint as mobile, coalesce(sum(total) filter (where method='control'),0)::bigint as control,
      count(distinct coalesce(student_id::text, student_name))::int as students`)),
    inRange(db('receipts as r'), prevFrom, prevTo).select(db.raw('count(*)::int as n, coalesce(sum(total),0)::bigint as money')),
    db.raw(`SELECT d::date AS day, coalesce(sum(r.total),0)::bigint AS money, count(r.id)::int AS n
      FROM generate_series(?::date, ?::date, interval '${spanDays > 92 ? '1 month' : '1 day'}') d
      LEFT JOIN receipts r ON ${spanDays > 92 ? `date_trunc('month', ${DAY}) = d::date` : `${DAY} = d::date`} AND ${DAY} between ? and ? ${school ? 'AND r.school_id = ?' : ''}
      GROUP BY d ORDER BY d`, [spanDays > 92 ? `${from.slice(0, 8)}01` : from, to, from, to, ...(school ? [school] : [])]),
    inRange(db('receipts as r').join('schools as s', 's.id', 'r.school_id')).groupBy('s.id').orderBy('s.id')
      .select('s.id', 's.short_name as name', 's.code', db.raw('count(r.id)::int as n, sum(r.total)::bigint as money')),
    inRange(db('receipt_lines as l').join('receipts as r', 'r.id', 'l.receipt_id')).groupBy('l.item_name').orderByRaw('sum(l.amount) desc')
      .select('l.item_name as name', db.raw('sum(l.qty)::int as qty, sum(l.amount)::bigint as money')),
    inRange(db('receipts as r').join('users as u', 'u.id', 'r.sold_by').join('schools as s', 's.id', 'r.school_id'))
      .groupBy('u.id', 's.short_name', 's.code').orderByRaw('sum(r.total) desc')
      .select('u.full_name as name', 'u.role', 's.short_name as school', 's.code', db.raw('count(r.id)::int as n, sum(r.total)::bigint as money')),
    inRange(db('receipts as r')).groupBy('r.student_class').orderByRaw('sum(r.total) desc').limit(12)
      .select('r.student_class as name', db.raw('count(*)::int as n, sum(r.total)::bigint as money')),
    where(db('bills as b'), school, 'b.school_id').where('b.status', 'pending')
      .select(db.raw(`(count(*) filter (where b.expires_at >= now()))::int as n, coalesce(sum(b.total) filter (where b.expires_at >= now()),0)::bigint as money,
        (count(*) filter (where b.expires_at < now()))::int as expired`)),
    where(db('receipt_lines as l').join('receipts as r', 'r.id', 'l.receipt_id'), school).whereIn('r.status', ['waiting', 'part'])
      .select(db.raw('coalesce(sum(l.qty - l.given_qty),0)::int as qty, coalesce(sum((l.qty - l.given_qty) * l.unit_price),0)::bigint as money')),
  ]);
  const money = num(k.money);
  res.json({
    from, to, school, groupedBy: spanDays > 92 ? 'month' : 'day',
    kpi: { receipts: k.n, money, students: k.students, average: k.n ? Math.round(money / k.n) : 0,
      methods: { cash: num(k.cash), bank: num(k.bank), mobile: num(k.mobile), control: num(k.control) },
      previous: { from: prevFrom, to: prevTo, receipts: prev.n, money: num(prev.money) } },
    trend: byDay.rows.map((r) => ({ day: r.day.toISOString?.().slice(0, 10) ?? String(r.day).slice(0, 10), money: num(r.money), n: r.n })),
    bySchool: bySch.map((r) => ({ id: r.id, name: r.name, code: r.code, n: r.n, money: num(r.money) })),
    items: items.map((r) => ({ name: r.name, qty: r.qty, money: num(r.money) })),
    sellers: bursars.map((r) => ({ name: r.name, role: ROLES[r.role]?.label, school: r.school, code: r.code, n: r.n, money: num(r.money) })),
    classes: classes.map((r) => ({ name: r.name, n: r.n, money: num(r.money) })),
    controlNumbers: { waiting: bills.n, money: num(bills.money), expired: bills.expired },
    notGiven: { qty: owed.qty, money: num(owed.money) },
  });
});

// Low stock count for finance homes.
async function stockAlerts() {
  const [r] = await db('stock_levels').select(db.raw(`(count(*) filter (where qty = 0 and reorder_level > 0))::int as out,
    (count(*) filter (where qty > 0 and reorder_level > 0 and qty <= reorder_level))::int as low`));
  const [w] = await db('deliveries').where('status', 'sent').count('* as n');
  const [q] = await db('stock_requests').where('status', 'pending').count('* as n');
  const [d] = await db('damages').where('status', 'pending').count('* as n');
  return { out: r.out, low: r.low, onTheWay: num(w.n), requests: num(q.n), damage: num(d.n) };
}

// ---------- "To do": the work waiting for THIS person, by role ----------
// Each line is shown only if the role may open its page, and only when there is something to do.
// School roles count their own school; administration counts all schools (or the one chosen at the top).
async function todo(user, school) {
  const can = (page, lvl) => { const a = pageAccess(user.role, page); return a && (lvl !== 'f' || a === 'f'); };
  const sc = (q, col) => (school ? q.where(col, school) : q);
  const cnt = async (q) => num((await q.count('* as n'))[0].n);
  const items = [];
  const add = (n, label, link, tone = 'warn', extra) => { if (n) items.push({ n, label, link, tone, ...(extra || {}) }); };
  const TODAY_D = `(now() AT TIME ZONE '${TZ}')::date`;

  if (can('give', 'f')) {
    const [o] = await sc(db('receipts as r').whereIn('r.status', ['waiting', 'part']), 'r.school_id')
      .select(db.raw('count(*)::int as n, (count(*) filter (where r.sold_at < now() - make_interval(hours => ?)))::int as late', [LATE_HOURS]));
    add(o.n, 'receipts waiting to be given', '/give', o.late ? 'bad' : 'warn', o.late ? { sub: `${o.late} late` } : undefined);
  } else if (can('receipts')) {
    add(await cnt(sc(db('receipts as r').whereIn('r.status', ['waiting', 'part']).whereRaw('r.sold_at < now() - make_interval(hours => ?)', [LATE_HOURS]), 'r.school_id')),
      `receipts late at the library (over ${LATE_HOURS} h)`, '/receipts', 'bad');
  }
  if (can('incoming', 'f')) add(await cnt(sc(db('deliveries').where('status', 'sent'), 'school_id')), 'deliveries to confirm', '/incoming');
  if (can('stockin', 'f')) {
    add(await cnt(sc(db('deliveries').where('status', 'sent').whereRaw("sent_at < now() - interval '48 hours'"), 'school_id')),
      'deliveries not confirmed after 48 hours', '/stock-in', 'info');
  }
  if (can('requests', 'f') && ROLES[user.role]?.scope === 'all') add(await cnt(sc(db('stock_requests').where('status', 'pending'), 'school_id')), 'stock requests to answer', '/requests');
  else if (can('requests')) {
    const q = sc(db('stock_requests').where('status', 'pending'), 'school_id');
    add(await cnt(q), user.role === 'librarian' ? 'of your stock requests are waiting for finance' : 'stock requests waiting', '/requests', 'info');
  }
  if (DAMAGE_APPROVERS.includes(user.role)) add(await cnt(sc(db('damages').where('status', 'pending').whereNot('reported_by', user.id), 'school_id')), 'damaged / lost reports to approve', '/damage');
  else if (can('damage')) add(await cnt(sc(db('damages').where('status', 'pending'), 'school_id')), 'damaged / lost reports waiting for approval', '/damage', 'info');
  if (can('stock')) {
    const [st] = await sc(db('stock_levels'), 'school_id').select(db.raw(`(count(*) filter (where qty = 0 and reorder_level > 0))::int as out,
      (count(*) filter (where qty > 0 and reorder_level > 0 and qty <= reorder_level))::int as low`));
    add(st.out, 'items out of stock (with a reorder level)', '/stock?status=out', 'bad');
    add(st.low, 'items low in stock', '/stock?status=low');
  }
  if (can('bills')) {
    const q = sc(db('bills').where('status', 'pending'), 'school_id');
    if (user.role === 'bursar') q.where('created_by', user.id);
    const [b] = await q.select(db.raw(`(count(*) filter (where expires_at >= now()))::int as n, (count(*) filter (where expires_at < now()))::int as expired,
      coalesce(sum(total) filter (where expires_at >= now()),0)::bigint as money`));
    add(b.n, can('bills', 'f') ? 'control numbers waiting for payment: mark them paid when the money is seen' : 'control numbers waiting for payment', '/control-numbers', 'info', { sub: `TSh ${num(b.money).toLocaleString('en-GB')}` });
    add(b.expired, 'control numbers expired without payment: renew or cancel', '/control-numbers', 'bad');
  }
  if (can('money', 'f')) {
    const DAY = `(r.sold_at AT TIME ZONE '${TZ}')::date`;
    const rows = await sc(db('receipts as r').join('users as u', 'u.id', 'r.sold_by').where('u.role', 'bursar')
      .whereRaw(`${DAY} < ${TODAY_D} and ${DAY} >= ${TODAY_D} - 14`)
      .whereNotExists(db('money_checks as m').whereRaw(`m.bursar_id = r.sold_by and m.day = ${DAY}`)), 'r.school_id')
      .countDistinct({ n: db.raw(`(r.sold_by, ${DAY})`) });
    add(num(rows[0].n), 'bursar days not yet checked (daily money)', '/money?status=open');
  }
  if (can('money')) {
    const q = sc(db('money_checks').whereNot('result', 'ok').whereRaw(`day >= ${TODAY_D} - 14`), 'school_id');
    if (user.role === 'bursar') q.where('bursar_id', user.id);
    add(await cnt(q), user.role === 'bursar' ? 'of your days were short or over (last 2 weeks)' : 'bursar days short or over (last 2 weeks)', '/money?status=problem', 'bad');
  }
  if (can('itemsupload', 'f')) {
    const q = db('item_imports').where('status', 'pending');
    if (user.role !== 'fm') q.where('uploaded_by', user.id);
    add(await cnt(q), 'item uploads waiting for approval', '/items', 'warn');
  }
  // Main store, issuing and the weekly check (2026-11-16).
  if (PURCHASE_CONFIRMERS.includes(user.role)) {
    add(await cnt(db('purchases').where('status', 'checked').whereNot('created_by', user.id).where((w) => w.whereNull('checked_by').orWhereNot('checked_by', user.id))),
      'purchases counted by the store-keeper: confirm them', '/purchases');
    add(await cnt(db('purchases').where('status', 'pending')), 'purchases waiting to be counted (go with the store-keeper)', '/purchases', 'info');
    add(await cnt(db('stock_counts').where('status', 'pending').whereNot('counted_by', user.id)), 'weekly stock checks to confirm', '/counts');
  } else if (user.role === 'storekeeper') {
    add(await cnt(db('purchases').where({ status: 'pending', ordered: false })), 'purchases waiting for Mapokezi to check', '/purchases', 'info');
    add(await cnt(db('purchases').where({ status: 'checked' })), 'checked by Mapokezi: waiting for the accountant office to confirm', '/purchases', 'info');
    add(await cnt(db('purchases').where({ status: 'pending', ordered: true })), 'orders waiting for the goods (Mapokezi checks them when they arrive)', '/purchases', 'info');
  } else if (user.role === 'mapokezi') {
    add(await cnt(db('purchases').where('status', 'pending')), 'purchases waiting for you to check against the receipts', '/purchases');
    add(await cnt(db('requisitions as r').whereIn('r.status', ['approved', 'buying', 'arrived'])
      .whereExists(db('payment_requests as pr').whereRaw('pr.requisition_id = r.id').where('pr.kind', 'float').where('pr.status', 'paid').select(db.raw('1')))),
    'requisitions with money given: goods will come to check soon', '/requisitions', 'info');
  } else if (user.role === 'cashier') {
    add(await cnt(db('payment_requests').where('status', 'pending')), 'payments waiting for you to give out', '/payments');
  }
  // Order Book (2026-11-20).
  if (pageAccess(user.role, 'orders')) {
    const od = (st) => sc(db('orders'), 'school_id').where('status', st);
    if (user.role === 'acad') add(await cnt(od('acad')), "teachers' orders to answer (give or send on)", '/orders');
    if (user.role === 'head') add(await cnt(od('head')), 'orders to approve', '/orders');
    if (user.role === 'manager') add(await cnt(od('manager')), 'orders from the schools to approve', '/orders');
    if (['storekeeper', 'amanager'].includes(user.role)) add(await cnt(od('keeper')), 'orders to buy for: write the requisition', '/orders');
    if (['acad', 'librarian', 'sstore', 'patron', 'head'].includes(user.role)) add(await cnt(od('rejected').where('written_by', user.id).where('rejected_at', '>', db.raw("now() - interval '7 days'"))), 'of your orders were rejected this week', '/orders', 'info');
  }
  // School requisitions: the signer whose turn it is, and the store-keeper who buys or sends.
  if (pageAccess(user.role, 'requisitions')) {
    // Signers count only what is theirs to sign: a requisition sent back to the applicant waits for the applicant.
    const rq = () => sc(db('requisitions'), 'school_id');
    const sign = () => rq().where('returned', false);
    if (user.role === 'head') {
      add(await cnt(sign().where('status', 'head')), 'requisitions to sign', '/requisitions');
      add(await cnt(sign().where('status', 'acad')), 'requisitions waiting for the first school signer (you may sign if he is away)', '/requisitions', 'info');
    }
    if (user.role === 'acad') add(await cnt(sign().where({ status: 'acad', kind: 'academic' })), 'requisitions for lessons to sign', '/requisitions');
    if (user.role === 'sstore') add(await cnt(sign().where({ status: 'acad', kind: 'general' })), 'requisitions from staff to sign', '/requisitions');
    if (user.role === 'storekeeper') {
      add(await cnt(sign().where('status', 'store')), 'old school requisitions to sign', '/requisitions');
      add(await cnt(rq().where('status', 'approved')), 'approved requisitions to buy or order', '/requisitions');
    }
    if (user.role === 'cashier') add(await cnt(rq().whereIn('status', ['approved', 'buying']).whereNotNull('money_back_asked_at')), 'buyers bringing office money back: receive it', '/requisitions');
    if (user.role === 'amanager') add(await cnt(rq().where({ status: 'approved', requested_by: user.id })), 'of your requisitions are approved: to buy', '/requisitions');
    // Office buying (2026-11-21): LPOs to sign, confirmed goods to send to the schools.
    if (user.role === 'acc') add(await cnt(db('lpos').where('status', 'certify').whereNot('prepared_by', user.id)), 'LPOs to certify (Head of Accounts)', '/lpo');
    if (['manager', 'fm'].includes(user.role)) add(await cnt(db('lpos').where('status', 'authorise').whereNot('prepared_by', user.id).where((w) => w.whereNull('certified_by').orWhereNot('certified_by', user.id))), 'LPOs to authorise', '/lpo');
    if (user.role === 'storekeeper') add(await cnt(db('purchases as p').where('p.status', 'confirmed').whereNotNull('p.school_id').whereNull('p.delivery_id')
      .whereExists(db('purchase_lines as l').whereRaw('l.purchase_id = p.id').whereRaw('coalesce(l.confirmed_qty, l.qty) > 0').select(db.raw('1')))), 'confirmed purchases to send to the schools (with QR labels)', '/purchases');
    if (user.role === 'acc') add(await cnt(db('contracts').whereNull('checked_at').whereNot('created_by', user.id)), 'work agreements to check', '/contracts', 'info');
    if (user.role === 'aacc') add(await cnt(sign().where('status', 'check').whereNot('requested_by', user.id)), 'requisitions to check (prices) before the Manager', '/requisitions');
    if (['manager', 'fm'].includes(user.role)) add(await cnt(sign().where('status', 'manager').whereNot('requested_by', user.id)), 'requisitions to approve (money)', '/requisitions');
    if (['manager', 'fm'].includes(user.role)) add(await cnt(db('payment_requests').where('status', 'review').whereNot('requested_by', user.id)), 'payout vouchers to authorize (money)', '/payments');
    if (['amanager', 'storekeeper'].includes(user.role)) add(await cnt(db('purchases').where({ went_with: user.id, status: 'pending' }).whereNull('went_with_signed_at')), 'buying forms to sign: you went to the market too', '/purchases');
    if (['amanager', 'storekeeper'].includes(user.role)) {
      add(await cnt(rq().where({ requested_by: user.id, returned: true }).whereIn('status', ['check', 'manager'])), 'of your requisitions were sent back: please correct them', '/requisitions');
      add(await cnt(rq().where({ requested_by: user.id, returned: false }).whereIn('status', ['check', 'manager'])), 'of your requisitions wait for the Assistant Accountant / Manager', '/requisitions', 'info');
    }
    if (['head', 'acad', 'teacher', 'librarian', 'bursar', 'sstore'].includes(user.role)) {
      add(await cnt(rq().where({ requested_by: user.id, returned: true }).whereIn('status', ['acad', 'head', 'store', 'check', 'manager'])), 'of your requisitions were sent back: please correct them', '/requisitions');
    }
    if (['acad', 'teacher', 'librarian', 'bursar', 'sstore'].includes(user.role)) add(await cnt(rq().where('requested_by', user.id).whereIn('status', ['acad', 'head', 'store', 'check', 'manager', 'approved', 'buying', 'arrived', 'sent'])),
      'of your requisitions are on the way', '/requisitions', 'info');
  }
  // ID cards not yet handed over (the School Admin records them).
  if (CARD_ISSUERS.includes(user.role) && user.school_id) {
    const n = await cnt(db('students as s').where({ 's.school_id': user.school_id, 's.status': 'active' })
      .whereNotExists(db('id_cards as c').whereRaw('c.student_id = s.id').whereNull('c.ended_at')));
    add(n, 'students have not taken their ID card', '/labels?tab=cards', 'info');
    add(await cnt(db('users as u').where({ 'u.school_id': user.school_id, 'u.active': true })
      .whereNotExists(db('id_cards as c').whereRaw('c.user_id = u.id').whereNull('c.ended_at'))), 'staff have not taken their ID card', '/labels?tab=cards&kind=staff', 'info');
  }
  if (ISSUERS.includes(user.role)) {
    const mine = (q) => (user.role === 'storekeeper' ? q.whereNull('school_id') : q.where('school_id', user.school_id));
    const [{ monday }] = (await db.raw(`SELECT date_trunc('week', (now() AT TIME ZONE '${TZ}'))::date AS monday`)).rows;
    const done = await mine(db('stock_counts').where('week_start', monday).whereNot('status', 'rejected')).first();
    const holds = await mine(db('stock_levels').where('qty', '>', 0)).first();
    if (!done && holds) add(1, 'weekly stock check not done yet this week: count the store', '/counts');
    add(await cnt(mine(db('item_copies').where('status', 'out'))), 'pieces are out and must come back', '/issue', 'info');
  }
  // Admission interviews (2026-11-20): children who passed but are not registered as students yet.
  if (can('students', 'f') && can('interviews') && user.school_id) {
    add(await cnt(db('admission_interviews').where({ school_id: user.school_id, result: 'passed' }).whereNull('student_id')),
      'children passed the admission interview: register them as students', '/interviews?result=passed&registered=no', 'info');
  }
  if (can('interviews', 'f')) add(await cnt(sc(db('admission_interviews').where('result', 'waiting'), 'school_id')), 'admission interviews waiting for a result', '/interviews?result=waiting', 'info');
  if (can('classlist', 'f') && user.school_id) {
    add(await cnt(db('classes').where({ school_id: user.school_id, active: true }).whereNull('level')), 'classes typed by hand: choose their class from the list', '/students/classes');
  }
  if (can('students', 'f') && user.school_id) add(await cnt(db('student_imports').where({ school_id: user.school_id, status: 'pending' })), 'class lists waiting for approval', '/students/upload');
  if (can('staff', 'f')) {
    const q = db('users').whereNotNull('reset_requested_at').where('active', true);
    if (user.role === 'sadmin') q.where('school_id', user.school_id);
    add(await cnt(q), 'staff asked for a new password', '/staff');
    if (user.role === 'super') add(await cnt(db('users').where('locked_until', '>', db.fn.now())), 'accounts locked after wrong passwords', '/staff', 'bad');
  }
  return items;
}

// Librarian: deliveries to confirm, own requests and damage reports.
async function libraryWork(schoolId) {
  const [incoming, requests, damages] = await Promise.all([
    db('deliveries as d').where({ 'd.school_id': schoolId, 'd.status': 'sent' }).orderBy('d.sent_at').limit(5)
      .select('d.id', 'd.number', 'd.sent_at', db.raw('(select count(*)::int from delivery_lines l where l.delivery_id = d.id) as lines'),
        db.raw('(select coalesce(sum(qty),0)::int from delivery_lines l where l.delivery_id = d.id) as units')),
    db('stock_requests').where({ school_id: schoolId }).orderBy('id', 'desc').limit(5).select('id', 'number', 'status', 'requested_at', 'answer_note'),
    db('damages').where({ school_id: schoolId }).orderBy('id', 'desc').limit(5).select('id', 'number', 'item_name', 'qty', 'kind', 'status', 'reported_at', 'decision_note'),
  ]);
  return {
    incoming: incoming.map((d) => ({ id: d.id, number: d.number, sentAt: d.sent_at, lines: d.lines, units: d.units })),
    requests: requests.map((r) => ({ id: r.id, number: r.number, status: r.status, at: r.requested_at, note: r.answer_note })),
    damages: damages.map((d) => ({ id: d.id, number: d.number, item: d.item_name, qty: d.qty, kind: d.kind, status: d.status, at: d.reported_at, note: d.decision_note })),
  };
}

// Bursar: own control numbers waiting, and the accountant's checks of own days.
async function bursarWork(user) {
  const [bills, checks] = await Promise.all([
    db('bills').where({ created_by: user.id, status: 'pending' }).orderBy('expires_at').limit(6)
      .select('id', 'control_no', 'student_name', 'total', 'expires_at'),
    db('money_checks').where({ bursar_id: user.id }).orderBy('day', 'desc').limit(7)
      .select(db.raw('day::text as day'), 'cash', 'cash_counted', 'result', 'note'),
  ]);
  return {
    bills: bills.map((b) => ({ id: b.id, controlNo: b.control_no.replace(/(\d{4})(?=\d)/g, '$1 '), student: b.student_name, total: b.total,
      expiresAt: b.expires_at, expired: new Date(b.expires_at) < new Date() })),
    checks: checks.map((c) => ({ day: c.day, cash: num(c.cash), counted: num(c.cash_counted), result: c.result, note: c.note })),
  };
}

router.get('/', async (req, res) => {
  const u = req.user;
  const all = ROLES[u.role]?.scope === 'all';
  const school = all ? (Number(req.query.school) || null) : u.school_id;
  const d = { role: u.role, school, todo: await todo(u, school) };
  switch (u.role) {
    case 'super':
      Object.assign(d, { sales: await sales(school), trend: await trend(school), bySchool: await bySchool(), open: await open(school, { limit: 5 }),
        students: await students(school), items: await items() });
      break;
    case 'director': case 'adirector':
      Object.assign(d, { sales: await sales(school), trend: await trend(school, 30), bySchool: await bySchool(), topItems: await topItems(school),
        students: await students(school), open: await open(school, { limit: 0 }) });
      break;
    case 'manager':
      Object.assign(d, { sales: await sales(school), bySchool: await bySchool(), open: await open(school, { limit: 10 }), topItems: await topItems(school) });
      break;
    case 'fm': case 'afm':
      Object.assign(d, { sales: await sales(school), trend: await trend(school), bySchool: await bySchool(), topItems: await topItems(school), items: await items(),
        open: await open(school, { limit: 0 }), stock: await stockAlerts() });
      break;
    case 'acc': case 'aacc':
      Object.assign(d, { sales: await sales(school), bursars: await byBursar(school), open: await open(school, { limit: 10 }), trend: await trend(school),
        stock: await stockAlerts() });
      break;
    case 'sadmin':
      Object.assign(d, { students: await students(school), pendingLists: await pendingLists(school) });
      break;
    case 'head':
      Object.assign(d, { sales: await sales(school), trend: await trend(school), open: await open(school, { limit: 5 }), library: await library(school),
        topItems: await topItems(school), students: await students(school) });
      break;
    case 'bursar':
      Object.assign(d, { sales: await sales(school, u.id), open: await open(school, { soldBy: u.id, limit: 6 }),
        recent: (await db('receipts').where({ sold_by: u.id }).orderBy('sold_at', 'desc').limit(6)
          .select('id', 'number', 'student_name', 'student_class', 'total', 'method', 'status', 'sold_at'))
          .map((r) => ({ id: r.id, number: r.number, student: r.student_name, cls: r.student_class, total: r.total, method: METHOD[r.method], status: r.status, soldAt: r.sold_at })),
        work: await bursarWork(u) });
      break;
    case 'librarian':
      Object.assign(d, { open: await open(school, { limit: 10 }), library: await library(school), work: await libraryWork(school) });
      break;
    case 'storekeeper':
    case 'amanager': {
      // No main store: orders and purchases for the schools, deliveries on the way, requisitions to sign or buy.
      const [pu] = await db('purchases').select(db.raw(`(count(*) filter (where status = 'pending' and ordered))::int as ordered,
        (count(*) filter (where status = 'pending' and not ordered))::int as tocount, (count(*) filter (where status = 'checked'))::int as checked,
        coalesce(sum(total) filter (where status = 'confirmed' and date_trunc('month', bought_on) = date_trunc('month', ${TODAY})), 0)::bigint as month`));
      const [dl] = await db('deliveries').where('status', 'sent').select(db.raw('count(*)::int as n'));
      const recent = await db('purchases as p').leftJoin('schools as s', 's.id', 'p.school_id').orderBy('p.id', 'desc').limit(8)
        .select('p.id', 'p.number', 'p.supplier', 'p.status', 'p.ordered', 'p.total', 'p.created_at', 's.short_name as school');
      Object.assign(d, { store: { ordered: pu.ordered, toCount: pu.tocount, checked: pu.checked, boughtThisMonth: num(pu.month), onTheWay: dl.n,
        requests: num((await db('stock_requests').where('status', 'pending').count('* as n'))[0].n),
        orders: num((await db('orders').where('status', 'keeper').count('* as n'))[0].n),
        toBuy: num((await db('requisitions').where('status', 'approved').modify((q) => { if (u.role === 'amanager') q.where('requested_by', u.id); }).count('* as n'))[0].n),
        toApprove: num((await db('requisitions').where({ status: 'manager', requested_by: u.id }).count('* as n'))[0].n),
        recent: recent.map((p) => ({ id: p.id, number: p.number, supplier: p.supplier, status: p.status, ordered: p.ordered, total: num(p.total), at: p.created_at, school: p.school })) } });
      break;
    }
    case 'mapokezi': {
      // Mapokezi checks goods against the receipts before the store-keeper sends them on. He sees the requisitions the
      // Cashier has given money for, so he knows what is coming and what to check it against.
      const [pu] = await db('purchases').select(db.raw(`(count(*) filter (where status = 'pending'))::int as toCheck, (count(*) filter (where status = 'checked'))::int as checked`));
      const recent = await db('purchases as p').leftJoin('schools as s', 's.id', 'p.school_id').where('p.status', 'pending').orderBy('p.id', 'desc').limit(8)
        .select('p.id', 'p.number', 'p.supplier', 'p.total', 'p.created_at', 's.short_name as school');
      const given = await db('requisitions as r').join('schools as s', 's.id', 'r.school_id').join('payment_requests as pr', 'pr.requisition_id', 'r.id')
        .where('pr.kind', 'float').where('pr.status', 'paid').whereIn('r.status', ['approved', 'buying', 'arrived']).orderBy('pr.paid_at', 'desc').limit(8)
        .select('r.id', 'r.number', 'r.purpose', 'r.status', 's.short_name as school', 'pr.amount', 'pr.paid_at');
      Object.assign(d, { mapokezi: { toCheck: pu.toCheck, checked: pu.checked,
        moneyGiven: given.map((g) => ({ id: g.id, number: g.number, purpose: g.purpose, status: g.status, school: g.school, amount: num(g.amount), at: g.paid_at })),
        recent: recent.map((p) => ({ id: p.id, number: p.number, supplier: p.supplier, total: num(p.total), at: p.created_at, school: p.school })) } });
      break;
    }
    case 'cashier': {
      const [c] = await db('payment_requests').select(db.raw(`(count(*) filter (where status = 'pending'))::int as pending,
        coalesce(sum(amount) filter (where status = 'paid' and (paid_at AT TIME ZONE 'Africa/Dar_es_Salaam')::date = ${TODAY}), 0)::bigint as paid_today,
        (count(*) filter (where status = 'paid' and (paid_at AT TIME ZONE 'Africa/Dar_es_Salaam')::date = ${TODAY}))::int as paid_n`));
      const waiting = await db('payment_requests as p').leftJoin('requisitions as r', 'r.id', 'p.requisition_id').leftJoin('schools as s', 's.id', 'r.school_id')
        .where('p.status', 'pending').orderBy('p.id').limit(10)
        .select('p.id', 'p.number', 'p.kind', 'p.purpose', 'p.amount', 'p.requested_at', 'p.approved_by_name', 'r.number as requisition_no', 's.short_name as school');
      Object.assign(d, { cashier: { pending: c.pending, paidToday: num(c.paid_today), paidTodayN: c.paid_n,
        waiting: waiting.map((p) => ({ id: p.id, number: p.number, kind: p.kind, purpose: p.purpose, amount: num(p.amount), at: p.requested_at, approvedBy: p.approved_by_name, requisition: p.requisition_no, school: p.school })) } });
      break;
    }
    default: // Academic Master, teachers: academic work comes in Step 3
      Object.assign(d, { students: await students(school) });
  }
  res.json(d);
});

module.exports = router;
