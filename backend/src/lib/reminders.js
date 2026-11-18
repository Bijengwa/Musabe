// Reminders: work that has waited too long. Runs every 15 minutes (src/server.js start).
// Each reminder is sent once (alerts_sent remembers its key), through the activity log, so the bell,
// the sound and live screens work as for any other change. Who hears what: lib/notify.js.
const db = require('../db');
const { audit } = require('./util');

const TZ = 'Africa/Dar_es_Salaam';
const H = (name, def) => Number(process.env[name]) || def;
const money = (n) => `TSh ${Number(n).toLocaleString('en-GB')}`;
const system = { ip: null, user: null };

// Send once: true when this key was not used before.
async function once(trx, key) {
  const r = await trx('alerts_sent').insert({ key: key.slice(0, 120) }).onConflict('key').ignore().returning('key');
  return r.length > 0;
}

async function each(rows, key, fn) {
  let n = 0;
  for (const row of rows) {
    await db.transaction(async (trx) => { if (await once(trx, key(row))) { await fn(trx, row); n++; } });
  }
  return n;
}

async function run() {
  const out = {};
  // Stock sent but the librarian has not confirmed it.
  const dl = await db('deliveries as d').join('schools as s', 's.id', 'd.school_id').where('d.status', 'sent')
    .whereRaw('d.sent_at < now() - make_interval(hours => ?)', [H('DELIVERY_LATE_HOURS', 48)]).select('d.*', 's.short_name');
  out.deliveries = await each(dl, (d) => `delivery-late:${d.id}`, (trx, d) => audit(system, 'delivery.late',
    `Reminder: ${d.number} to ${d.short_name} was sent ${Math.floor((Date.now() - new Date(d.sent_at)) / 3600000)} hours ago and is not yet confirmed by the librarian`,
    { schoolId: d.school_id, detail: { deliveryId: d.id } }, trx));

  // Control numbers: about to expire (within 24 hours), and expired without payment.
  const soon = await db('bills').where('status', 'pending').whereRaw("expires_at between now() and now() + interval '24 hours'");
  out.billsSoon = await each(soon, (b) => `bill-soon:${b.id}:${new Date(b.expires_at).getTime()}`, (trx, b) => audit(system, 'bill.expiring',
    `Control number ${b.control_no} (${b.student_name}, ${money(b.total)}) expires ${new Date(b.expires_at).toLocaleString('en-GB', { timeZone: TZ })} and is not paid. Remind the parent or renew it`,
    { schoolId: b.school_id, detail: { billId: b.id } }, trx));
  const gone = await db('bills').where('status', 'pending').where('expires_at', '<', db.fn.now());
  out.billsExpired = await each(gone, (b) => `bill-exp:${b.id}:${new Date(b.expires_at).getTime()}`, (trx, b) => audit(system, 'bill.expired',
    `Control number ${b.control_no} (${b.student_name}, ${money(b.total)}) has expired without payment. Renew it if the parent still wants the items, or cancel it`,
    { schoolId: b.school_id, detail: { billId: b.id } }, trx));

  // Daily money: once a day (after 08:00), the bursar days before today that the accountant has not checked.
  const now = new Date();
  const hour = Number(now.toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }));
  if (hour >= 8) {
    const today = now.toLocaleDateString('en-CA', { timeZone: TZ });
    const DAY = `(r.sold_at AT TIME ZONE '${TZ}')::date`;
    const open = await db('receipts as r').join('users as u', 'u.id', 'r.sold_by').where('u.role', 'bursar')
      .whereRaw(`${DAY} < ?::date and ${DAY} >= ?::date - 14`, [today, today])
      .whereNotExists(db('money_checks as m').whereRaw(`m.bursar_id = r.sold_by and m.day = ${DAY}`))
      .groupBy('u.full_name', db.raw(DAY)).orderByRaw(`${DAY}`)
      .select('u.full_name as name', db.raw(`${DAY}::text as day`), db.raw('sum(r.total)::bigint as total'));
    if (open.length) {
      out.money = await each([{ today }], (x) => `money-late:${x.today}`, (trx) => audit(system, 'money.late',
        `Reminder: ${open.length} bursar day${open.length === 1 ? '' : 's'} not yet checked: `
        + open.slice(0, 6).map((o) => `${o.name} ${o.day} (${money(o.total)})`).join(', ') + (open.length > 6 ? ` and ${open.length - 6} more` : ''),
        { detail: { days: open.length } }, trx));
    }
  }

  // Damaged / lost and stock requests waiting too long.
  const dm = await db('damages').where('status', 'pending').whereRaw('reported_at < now() - make_interval(hours => ?)', [H('DAMAGE_LATE_HOURS', 48)]);
  out.damage = await each(dm, (d) => `damage-late:${d.id}`, (trx, d) => audit(system, 'damage.late',
    `Reminder: ${d.number} (${d.qty} × ${d.item_name} ${d.kind}) is waiting for approval for more than ${H('DAMAGE_LATE_HOURS', 48)} hours`,
    { schoolId: d.school_id, detail: { damageId: d.id } }, trx));
  const rq = await db('stock_requests as q').join('schools as s', 's.id', 'q.school_id').where('q.status', 'pending')
    .whereRaw('q.requested_at < now() - make_interval(hours => ?)', [H('REQUEST_LATE_HOURS', 48)]).select('q.*', 's.short_name');
  out.requests = await each(rq, (q) => `request-late:${q.id}`, (trx, q) => audit(system, 'request.late',
    `Reminder: ${q.number} from ${q.short_name} is waiting for an answer for more than ${H('REQUEST_LATE_HOURS', 48)} hours`,
    { schoolId: q.school_id, detail: { requestId: q.id } }, trx));
  return out;
}

module.exports = { run };
