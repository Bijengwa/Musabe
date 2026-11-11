// Staff accounts: list, create, edit, reset password, switch on/off.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { publish } = require('../realtime');
const { sendExcel } = require('../lib/excel');
const { HttpError, tempPassword, tzPhone, suggestUsername, audit } = require('../lib/util');
const { requireAuth, requirePage, endAllSessions } = require('../auth/session');
const { ROLES, CREATES, isAdminRole, isSchoolRole, canManage } = require('../auth/roles');

const router = express.Router();
router.use(requireAuth);

const COLS = ['u.id', 'u.full_name', 'u.username', 'u.phone', 'u.role', 'u.school_id', 'u.active', 'u.must_change_password',
  'u.reset_requested_at', 'u.last_login_at', 'u.created_at', 'sc.short_name as school_short', 'cb.full_name as created_by_name'];

const shape = (r, actor) => ({
  id: r.id,
  fullName: r.full_name,
  username: r.username,
  phone: r.phone,
  role: r.role,
  roleLabel: ROLES[r.role]?.label,
  schoolId: r.school_id,
  schoolShort: r.school_short,
  active: r.active,
  tempPassword: r.must_change_password,
  resetRequested: !!r.reset_requested_at,
  resetRequestedAt: r.reset_requested_at,
  lastLoginAt: r.last_login_at,
  createdAt: r.created_at,
  createdBy: r.created_by_name,
  canManage: canManage(actor, r),
});

function baseQuery() {
  return db('users as u').leftJoin('schools as sc', 'sc.id', 'u.school_id').leftJoin('users as cb', 'cb.id', 'u.created_by');
}

// Accounts the signed-in person may see.
function scoped(q, actor) {
  if (ROLES[actor.role].scope === 'all') return q;
  return q.where('u.school_id', actor.school_id);
}

router.get('/', requirePage('staff'), async (req, res) => {
  const { school, role, q, status } = req.query;
  let query = scoped(baseQuery(), req.user).select(COLS);
  if (school === 'admin') query = query.whereNull('u.school_id');
  else if (school) query = query.where('u.school_id', Number(school));
  if (role) query = query.where('u.role', role);
  if (status === 'off') query = query.where('u.active', false);
  if (status === 'reset') query = query.whereNotNull('u.reset_requested_at').where('u.active', true);
  if (q) query = query.where((w) => w.whereILike('u.full_name', `%${q}%`).orWhereILike('u.username', `%${q}%`));
  const rows = await query.orderByRaw('u.school_id NULLS FIRST').orderBy('u.role').orderBy('u.full_name');
  res.json({ users: rows.map((r) => shape(r, req.user)) });
});

router.get('/export.xlsx', requirePage('staff'), async (req, res) => {
  const rows = await scoped(baseQuery(), req.user).select(COLS).orderByRaw('u.school_id NULLS FIRST').orderBy('u.role').orderBy('u.full_name');
  const fmt = (p) => (p && p.length === 10 ? `${p.slice(0, 4)} ${p.slice(4, 7)} ${p.slice(7)}` : p || '');
  await sendExcel(res, 'musabe-staff', [{
    name: 'Staff accounts', title: 'Musabe Schools: staff accounts',
    columns: [
      { header: 'Full name', key: 'name', width: 28 }, { header: 'Username', key: 'username', width: 20 },
      { header: 'Role', key: 'role', width: 24 }, { header: 'School', key: 'school', width: 18 },
      { header: 'Phone', key: 'phone', width: 15 }, { header: 'Status', key: 'status', width: 18 },
      { header: 'Last sign-in', key: 'last', type: 'date', width: 20 }, { header: 'Created by', key: 'by', width: 24 },
    ],
    rows: rows.map((r) => ({ name: r.full_name, username: r.username, role: ROLES[r.role]?.label, school: r.school_short || 'Administration',
      phone: fmt(r.phone), status: !r.active ? 'Switched off' : r.must_change_password ? 'Temporary password' : 'Active',
      last: r.last_login_at ? new Date(r.last_login_at) : null, by: r.created_by_name || '' })),
  }]);
});

// Helps the form: suggested username for a name.
router.get('/suggest-username', requirePage('staff', 'f'), async (req, res) => {
  const name = String(req.query.name || '').trim();
  res.json({ username: name ? await suggestUsername(name) : '' });
});

router.post('/', requirePage('staff', 'f'), async (req, res) => {
  const actor = req.user;
  const fullName = String(req.body?.fullName || '').trim().replace(/\s+/g, ' ');
  const role = String(req.body?.role || '');
  const phone = tzPhone(req.body?.phone);
  let username = String(req.body?.username || '').trim().toLowerCase();
  let schoolId = req.body?.schoolId ? Number(req.body.schoolId) : null;

  if (!(CREATES[actor.role] || []).includes(role)) throw new HttpError(403, `You cannot create a ${ROLES[role]?.label || 'account of this type'}.`);
  if (fullName.length < 4) throw new HttpError(400, 'Type the full name.');
  if (actor.role === 'sadmin') schoolId = actor.school_id; // School Admins only add to their own school
  if (isAdminRole(role) && schoolId) throw new HttpError(400, `${ROLES[role].label} belongs to the administration, not a school.`);
  if (isSchoolRole(role) && !schoolId) throw new HttpError(400, `Choose the school for this ${ROLES[role].label}.`);
  if (schoolId && !(await db('schools').where({ id: schoolId, active: true }).first())) throw new HttpError(400, 'That school does not exist.');
  if (username && !/^[a-z][a-z0-9._]{2,59}$/.test(username)) throw new HttpError(400, 'Username: small letters, numbers, dot or underscore, at least 3 characters.');

  const temp = tempPassword();
  const created = await db.transaction(async (trx) => {
    if (!username) username = await suggestUsername(fullName, trx);
    else if (await trx('users').whereRaw('lower(username) = ?', [username]).first()) throw new HttpError(409, `Username "${username}" is taken. Try another.`);
    const [row] = await trx('users').insert({
      full_name: fullName, username, phone, role, school_id: schoolId,
      password_hash: await bcrypt.hash(temp, 12), must_change_password: true, created_by: actor.id,
    }).returning('id');
    await audit(req, 'user.create', `Created account for ${fullName} (${ROLES[role].label})`, { schoolId, detail: { userId: row.id, role, username } }, trx);
    return row.id;
  });
  const row = await baseQuery().select(COLS).where('u.id', created).first();
  res.status(201).json({ user: shape(row, actor), tempPassword: temp });
});

async function loadTarget(req) {
  const t = await baseQuery().select(COLS).where('u.id', Number(req.params.id)).first();
  if (!t) throw new HttpError(404, 'Account not found.');
  if (!canManage(req.user, t)) throw new HttpError(403, 'You cannot change this account.');
  return t;
}

// Edit name, phone, username, and switch on/off.
router.patch('/:id', requirePage('staff', 'f'), async (req, res) => {
  const t = await loadTarget(req);
  const b = req.body || {};
  const up = {};
  const changes = [];
  if (b.fullName !== undefined) {
    const v = String(b.fullName).trim().replace(/\s+/g, ' ');
    if (v.length < 4) throw new HttpError(400, 'Type the full name.');
    if (v !== t.full_name) { up.full_name = v; changes.push('name'); }
  }
  if (b.phone !== undefined) {
    const v = tzPhone(b.phone);
    if (v !== t.phone) { up.phone = v; changes.push('phone'); }
  }
  if (b.username !== undefined) {
    const v = String(b.username).trim().toLowerCase();
    if (!/^[a-z][a-z0-9._]{2,59}$/.test(v)) throw new HttpError(400, 'Username: small letters, numbers, dot or underscore, at least 3 characters.');
    if (v !== t.username) {
      if (await db('users').whereRaw('lower(username) = ?', [v]).whereNot('id', t.id).first()) throw new HttpError(409, `Username "${v}" is taken.`);
      up.username = v; changes.push('username');
    }
  }
  let switched = null;
  if (b.active !== undefined && !!b.active !== t.active) {
    if (!b.active && t.role === 'super') {
      const others = await db('users').where({ role: 'super', active: true }).whereNot('id', t.id).count('* as n').first();
      if (Number(others.n) === 0) throw new HttpError(400, 'This is the last active Super Admin. It cannot be switched off.');
    }
    up.active = !!b.active; switched = up.active ? 'on' : 'off';
  }
  if (!Object.keys(up).length) return res.json({ ok: true, unchanged: true });
  await db.transaction(async (trx) => {
    await trx('users').where({ id: t.id }).update({ ...up, updated_at: trx.fn.now() });
    if (switched === 'off') await endAllSessions(t.id, trx);
    if (changes.length) await audit(req, 'user.update', `Changed ${changes.join(', ')} for ${up.full_name || t.full_name}`, { schoolId: t.school_id, detail: { userId: t.id, changes } }, trx);
    if (switched) await audit(req, `user.switch_${switched}`, `Switched ${switched} the account of ${t.full_name}`, { schoolId: t.school_id, detail: { userId: t.id } }, trx);
  });
  // The person whose name or username changed sees it at once on their own screens.
  if (changes.length) publish({ topics: ['me'], userIds: [t.id], onlyUsers: true });
  const row = await baseQuery().select(COLS).where('u.id', t.id).first();
  res.json({ user: shape(row, req.user) });
});

// Give a temporary password (shown once, to be handed over in person).
router.post('/:id/reset-password', requirePage('staff', 'f'), async (req, res) => {
  const t = await loadTarget(req);
  const temp = tempPassword();
  await db.transaction(async (trx) => {
    await trx('users').where({ id: t.id }).update({
      password_hash: await bcrypt.hash(temp, 12), must_change_password: true,
      reset_requested_at: null, failed_logins: 0, locked_until: null, updated_at: trx.fn.now(),
    });
    await endAllSessions(t.id, trx);
    await audit(req, 'user.reset_password', `Gave a temporary password to ${t.full_name}`, { schoolId: t.school_id, detail: { userId: t.id } }, trx);
  });
  res.json({ ok: true, username: t.username, tempPassword: temp });
});

module.exports = router;
