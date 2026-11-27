// Staff accounts: list, create, edit, reset password, switch on/off.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { publish } = require('../realtime');
const { sendExcel, readRows } = require('../lib/excel');
const { uploadLimit } = require('../lib/guard');
const { HttpError, tempPassword, tzPhone, suggestUsername, audit } = require('../lib/util');
const { requireAuth, requirePage, endAllSessions } = require('../auth/session');
const { ROLES, CREATES, isAdminRole, isSchoolRole, canManage, clash, roleLabelFor, titled } = require('../auth/roles');

const router = express.Router();
router.use(requireAuth);

// A temporary password works for TEMP_PASSWORD_HOURS (72 by default). After that the administrator gives a new one.
const tempExpiry = () => new Date(Date.now() + (Number(process.env.TEMP_PASSWORD_HOURS) || 72) * 3600000);

const COLS = ['u.id', 'u.full_name', 'u.username', 'u.phone', 'u.role', 'u.school_id', 'u.active', 'u.must_change_password', 'u.gender',
  'u.reset_requested_at', 'u.last_login_at', 'u.created_at', 'sc.short_name as school_short', 'cb.full_name as created_by_name'];

const shape = (r, actor) => ({
  id: r.id,
  fullName: r.full_name,
  username: r.username,
  phone: r.phone,
  role: r.role,
  roleLabel: roleLabelFor(r.role, r.gender),
  gender: r.gender || null,
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
  extraRoles: (r.extra_roles || []).map((x) => ({ id: x.id, role: x.role, label: ROLES[x.role]?.label, schoolId: x.school_id, school: x.school_short || null })),
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
  if (status === 'temp') query = query.where('u.must_change_password', true).where('u.active', true);
  if (status === 'reset') query = query.whereNotNull('u.reset_requested_at').where('u.active', true);
  if (q) query = query.where((w) => w.whereILike('u.full_name', `%${q}%`).orWhereILike('u.username', `%${q}%`));
  const rows = await query.orderByRaw('u.school_id NULLS FIRST').orderBy('u.role').orderBy('u.full_name');
  const extra = await extraRoles(rows.map((r) => r.id));
  res.json({ users: rows.map((r) => shape({ ...r, extra_roles: extra[r.id] }, req.user)) });
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
  const gender = ['m', 'f'].includes(req.body?.gender) ? req.body.gender : null;
  if (req.body?.gender && !gender) throw new HttpError(400, 'Choose male or female.');
  const fullName = titled(String(req.body?.fullName || '').trim().replace(/\s+/g, ' '), gender);
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
      full_name: fullName, username, phone, role, school_id: schoolId, gender,
      password_hash: await bcrypt.hash(temp, 12), must_change_password: true, temp_password_expires_at: tempExpiry(), created_by: actor.id,
    }).returning('id');
    await audit(req, 'user.create', `Created account for ${fullName} (${ROLES[role].label})`, { schoolId, detail: { userId: row.id, role, username } }, trx);
    return row.id;
  });
  const row = await baseQuery().select(COLS).where('u.id', created).first();
  res.status(201).json({ user: shape(row, actor), tempPassword: temp });
});


// ---------- Register many staff from Excel (Super Admin) ----------
// Columns: Full name, Role, School, Phone. The username is made by the system (first.last). Each person gets a temporary password,
// shown once on the screen. ?check=1 only checks the file and saves nothing.
const BULK_MAX = 200;
router.get('/bulk-template.xlsx', requirePage('staff', 'f'), async (req, res) => {
  if (req.user.role !== 'super') throw new HttpError(403, 'Only the Super Admin registers staff from Excel.');
  const schools = await db('schools').where({ active: true }).orderBy('short_name').select('short_name');
  const s = schools[0]?.short_name || 'Musabe Primary';
  await sendExcel(res, 'musabe-staff-template', [{ name: 'Staff', title: 'Musabe Schools: staff to register', columns: [
    { header: 'Full name', key: 'name', width: 30 }, { header: 'Role', key: 'role', width: 22 }, { header: 'School', key: 'school', width: 22 }, { header: 'Phone', key: 'phone', width: 16 }],
  rows: [{ name: 'Mary John Mushi', role: 'Teacher', school: s, phone: '0712345678' }, { name: 'Asha Said Kombo', role: 'Bursar', school: s, phone: '' }] },
  { name: 'Roles and schools', title: 'Write the role and school exactly like this', columns: [{ header: 'Role', key: 'r', width: 30 }, { header: 'School', key: 's', width: 30 }],
    rows: Array.from({ length: Math.max(Object.keys(ROLES).length, schools.length) }, (_, i) => ({ r: Object.values(ROLES)[i]?.label || '', s: schools[i]?.short_name || '' })) }]);
});

router.post('/bulk', requirePage('staff', 'f'), uploadLimit, express.raw({ type: () => true, limit: '2mb' }), async (req, res) => {
  const actor = req.user;
  if (actor.role !== 'super') throw new HttpError(403, 'Only the Super Admin registers staff from Excel.');
  const { rows: raw } = await readRows(req.body);
  const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let head = null, col = {};
  for (const r of raw.slice(0, 10)) {
    const m = {};
    r.cells.forEach((c, i) => { const k = norm(c); if (['fullname', 'name', 'jina', 'majina'].includes(k)) m.name ??= i; else if (['role', 'cheo', 'position'].includes(k)) m.role ??= i; else if (['school', 'shule'].includes(k)) m.school ??= i; else if (['phone', 'simu', 'phonenumber', 'mobile'].includes(k)) m.phone ??= i; });
    if (m.name !== undefined && m.role !== undefined) { head = r.row; col = m; break; }
  }
  if (!head) throw new HttpError(400, 'Could not find the columns "Full name" and "Role". Download the template to see.');
  const data = raw.filter((r) => r.row > head);
  if (!data.length) throw new HttpError(400, 'There are no people in this file.');
  if (data.length > BULK_MAX) throw new HttpError(400, `Put at most ${BULK_MAX} people in one file.`);
  const roleBy = {};
  for (const [k, v] of Object.entries(ROLES)) { roleBy[norm(k)] = k; roleBy[norm(v.label)] = k; }
  const schools = await db('schools').where({ active: true }).select('id', 'code', 'name', 'short_name');
  const schoolBy = {};
  for (const sc of schools) for (const n of [sc.code, sc.name, sc.short_name]) if (n) schoolBy[norm(n)] = sc;
  const good = [], errors = [], seen = new Set();
  for (const r of data) {
    const name = String(r.cells[col.name] || '').trim().replace(/\s+/g, ' ');
    const roleKey = roleBy[norm(r.cells[col.role])];
    const sc = col.school !== undefined && r.cells[col.school] ? schoolBy[norm(r.cells[col.school])] : null;
    let phone = null, problem = '';
    if (col.phone !== undefined && r.cells[col.phone]) { try { phone = tzPhone(r.cells[col.phone]); } catch { problem = 'The phone number is not right (like 0712345678).'; } }
    if (name.length < 4) problem ||= 'Type the full name.';
    else if (!roleKey) problem ||= `Role "${r.cells[col.role] || ''}" is not known. See the "Roles and schools" sheet.`;
    else if (!(CREATES.super || []).includes(roleKey)) problem ||= 'This role cannot be created here.';
    else if (isAdminRole(roleKey) && r.cells[col.school]) problem ||= `${ROLES[roleKey].label} belongs to the administration: leave School empty.`;
    else if (isSchoolRole(roleKey) && !sc) problem ||= `${ROLES[roleKey].label} needs a school that exists: "${r.cells[col.school] || ''}".`;
    const key = `${norm(name)}|${roleKey}|${sc?.id || ''}`;
    if (!problem && seen.has(key)) problem = 'This person is written twice in the file.';
    if (problem) { errors.push({ row: r.row, name, message: problem }); continue; }
    seen.add(key);
    good.push({ row: r.row, name, role: roleKey, schoolId: isSchoolRole(roleKey) ? sc.id : null, school: sc?.short_name || '', phone });
  }
  if (req.query.check) return res.json({ checked: true, ok: good.length, errors, people: good.map((g) => ({ row: g.row, fullName: g.name, phone: g.phone, role: ROLES[g.role].label, school: g.school })) });
  const created = await db.transaction(async (trx) => {
    const out = [];
    for (const g of good) {
      const username = await suggestUsername(g.name, trx);
      const temp = tempPassword();
      const [row] = await trx('users').insert({ full_name: g.name, username, phone: g.phone, role: g.role, school_id: g.schoolId, password_hash: await bcrypt.hash(temp, 10), must_change_password: true, temp_password_expires_at: tempExpiry(), created_by: actor.id }).returning('id');
      out.push({ row: g.row, id: row.id, fullName: g.name, phone: g.phone, username, tempPassword: temp, role: ROLES[g.role].label, school: g.school });
    }
    await audit(req, 'user.bulk', `Registered ${out.length} staff from Excel`, { detail: { count: out.length } }, trx);
    return out;
  });
  publish({ topics: ['user'] }, db);
  res.status(201).json({ created, errors });
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
  let gender = t.gender;
  if (b.gender !== undefined) {
    if (!['m', 'f'].includes(b.gender)) throw new HttpError(400, 'Choose male or female.');
    if (b.gender !== t.gender) { up.gender = b.gender; gender = b.gender; changes.push('gender'); }
  }
  if (b.fullName !== undefined || up.gender) {
    const v = titled(String(b.fullName ?? t.full_name).trim().replace(/\s+/g, ' '), gender);
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
    if (!b.active && (t.role === 'super' || await hasExtraSuper(t.id))) {
      if ((await otherSupers(t.id)) === 0) throw new HttpError(400, 'This is the last active Super Admin. It cannot be switched off. Give the Super Admin role to somebody else first.');
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
// Refuse a password request (2026-11-24): the person who asked does not get a new password. The request leaves the list; they may ask again.
router.post('/:id/refuse-reset', requirePage('staff', 'f'), async (req, res) => {
  const t = await loadTarget(req);
  if (!t.reset_requested_at) throw new HttpError(409, 'This person has not asked for a password.');
  const reason = String(req.body?.reason || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  await db.transaction(async (trx) => {
    await trx('users').where({ id: t.id }).update({ reset_requested_at: null, updated_at: trx.fn.now() });
    await audit(req, 'user.reset.refuse', `Password request refused for ${t.full_name}${reason ? `: ${reason}` : ''}`, { schoolId: t.school_id, detail: { userId: t.id } }, trx);
  });
  publish({ topics: ['user'] }, db);
  res.json({ ok: true });
});

router.post('/:id/reset-password', requirePage('staff', 'f'), async (req, res) => {
  const t = await loadTarget(req);
  const temp = tempPassword();
  await db.transaction(async (trx) => {
    await trx('users').where({ id: t.id }).update({
      password_hash: await bcrypt.hash(temp, 12), must_change_password: true, temp_password_expires_at: tempExpiry(),
      reset_requested_at: null, failed_logins: 0, locked_until: null, updated_at: trx.fn.now(),
    });
    await endAllSessions(t.id, trx);
    await audit(req, 'user.reset_password', `Gave a temporary password to ${t.full_name}`, { schoolId: t.school_id, detail: { userId: t.id } }, trx);
  });
  res.json({ ok: true, username: t.username, tempPassword: temp });
});

// ---- One person, many roles (2026-11-20) ----
// Super Admins (2026-11-25): a person can be Super Admin as his main role OR as an extra role (for example the Finance Manager).
// The system must never be left without an active Super Admin.
const hasExtraSuper = async (id) => !!(await db('user_roles').where({ user_id: id, role: 'super', active: true }).first('id'));
async function otherSupers(exceptId) {
  const main = await db('users').where({ role: 'super', active: true }).whereNot('id', exceptId).count('* as n').first();
  const extra = await db('user_roles as r').join('users as u', 'u.id', 'r.user_id').where({ 'r.role': 'super', 'r.active': true, 'u.active': true }).whereNot('u.id', exceptId).countDistinct('u.id as n').first();
  return Number(main.n) + Number(extra.n);
}

// Extra roles of a person. The main role stays on the account; extra roles are added or switched off here.
async function extraRoles(ids) {
  if (!ids.length) return {};
  const rows = await db('user_roles as r').leftJoin('schools as sc', 'sc.id', 'r.school_id').whereIn('r.user_id', ids).where('r.active', true).orderBy('r.id')
    .select('r.id', 'r.user_id', 'r.role', 'r.school_id', 'sc.short_name as school_short');
  const out = {};
  for (const x of rows) (out[x.user_id] ||= []).push(x);
  return out;
}

router.get('/:id/roles', requirePage('staff'), async (req, res) => {
  const t = await loadTarget(req);
  res.json({ main: { role: t.role, label: ROLES[t.role].label }, extra: ((await extraRoles([t.id]))[t.id] || []).map((x) => ({ id: x.id, role: x.role, label: ROLES[x.role].label, schoolId: x.school_id, school: x.school_short })),
    canAdd: (CREATES[req.user.role] || []).map((r) => ({ role: r, label: ROLES[r].label, needsSchool: isSchoolRole(r) })) });
});

router.post('/:id/roles', requirePage('staff', 'f'), async (req, res) => {
  const t = await loadTarget(req);
  const role = String(req.body?.role || '');
  let schoolId = req.body?.schoolId ? Number(req.body.schoolId) : null;
  if (!(CREATES[req.user.role] || []).includes(role)) throw new HttpError(403, `You cannot give the role ${ROLES[role]?.label || role}.`);
  if (req.user.role === 'sadmin') schoolId = req.user.school_id;
  if (isAdminRole(role)) schoolId = null;
  if (isSchoolRole(role) && !schoolId) throw new HttpError(400, `Choose the school for the ${ROLES[role].label} role.`);
  if (isSchoolRole(role) && isSchoolRole(t.role) && schoolId !== t.school_id) throw new HttpError(400, 'A school role must be in the same school as the person\'s main role.');
  if (role === t.role) throw new HttpError(409, `${t.full_name} is already ${ROLES[role].label} (main role).`);
  const have = ((await extraRoles([t.id]))[t.id] || []).map((x) => x.role);
  if (have.includes(role)) throw new HttpError(409, `${t.full_name} already has the role ${ROLES[role].label}.`);
  const bad = clash([t.role, ...have, role]);
  if (bad) throw new HttpError(409, `One person cannot be both ${ROLES[bad[0]].label} and ${ROLES[bad[1]].label}: one checks the other's work.`);
  await db.transaction(async (trx) => {
    await trx('user_roles').insert({ user_id: t.id, role, school_id: schoolId, added_by: req.user.id });
    await audit(req, 'user.role_add', `${t.full_name} also works as ${ROLES[role].label} now (main role ${ROLES[t.role].label})`, { schoolId: schoolId ?? t.school_id, detail: { userId: t.id, role } }, trx);
  });
  res.status(201).json({ ok: true });
});

router.post('/:id/roles/:rid/remove', requirePage('staff', 'f'), async (req, res) => {
  const t = await loadTarget(req);
  const x = await db('user_roles').where({ id: Number(req.params.rid) || 0, user_id: t.id, active: true }).first();
  if (!x) throw new HttpError(404, 'That role was not found.');
  if (!(CREATES[req.user.role] || []).includes(x.role)) throw new HttpError(403, 'You cannot remove this role.');
  if (x.role === 'super' && t.role !== 'super' && (await otherSupers(t.id)) === 0 && t.id !== req.user.id) throw new HttpError(400, 'He is the last active Super Admin. Give the role to somebody else first.');
  await db.transaction(async (trx) => {
    await trx('user_roles').where({ id: x.id }).update({ active: false, removed_by: req.user.id, removed_at: trx.fn.now() });
    await trx('sessions').where({ user_id: t.id, active_role: x.role }).update({ active_role: null });   // back to the main role
    await audit(req, 'user.role_remove', `${t.full_name} no longer works as ${ROLES[x.role].label}`, { schoolId: x.school_id ?? t.school_id, detail: { userId: t.id, role: x.role } }, trx);
  });
  res.json({ ok: true });
});

module.exports = router;
