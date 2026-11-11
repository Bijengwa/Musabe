// Activity: everything that happens in the system, who did it and when. Nobody can edit or delete it.
// Super Admin and the directors see everything. Others see the areas that concern them (lib/activity.js).
const express = require('express');
const db = require('../db');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES } = require('../auth/roles');
const { GROUPS, SEE, groupOf, visible } = require('../lib/activity');
const { sendExcel } = require('../lib/excel');

const router = express.Router();
router.use(requireAuth);

function query(req, limit) {
  const { group, role, school, from, to, q } = req.query;
  let qb = db('audit_log as a')
    .leftJoin('users as u', 'u.id', 'a.user_id')
    .leftJoin('schools as s', 's.id', 'a.school_id')
    .select('a.id', 'a.at', 'a.action', 'a.summary', 'a.school_id', 's.short_name as school_short', 'u.full_name', 'u.role')
    .orderBy('a.at', 'desc').limit(limit);
  qb = visible(qb, req.user, { group: group || undefined });
  if (ROLES[req.user.role].scope === 'all') {
    if (school === 'admin') qb = qb.whereNull('a.school_id');
    else if (school) qb = qb.where('a.school_id', Number(school));
  }
  if (role) qb = qb.where('u.role', String(role));
  if (from) qb = qb.where('a.at', '>=', new Date(`${from}T00:00:00`));
  if (to) qb = qb.where('a.at', '<', new Date(new Date(`${to}T00:00:00`).getTime() + 86400000));
  if (q) qb = qb.where((w) => w.whereILike('a.summary', `%${q}%`).orWhereILike('u.full_name', `%${q}%`));
  return qb;
}

const shape = (r) => ({
  id: r.id, at: r.at, action: r.action, group: groupOf(r.action), summary: r.summary, schoolId: r.school_id,
  schoolShort: r.school_short, by: r.full_name, byRole: ROLES[r.role]?.label,
});

router.get('/', requirePage('audit'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const rows = await query(req, limit);
  const groups = (SEE[req.user.role] || []).map((g) => ({ key: g, label: GROUPS[g].label }));
  res.json({ entries: rows.map(shape), groups });
});

router.get('/export.xlsx', requirePage('audit'), async (req, res) => {
  const rows = (await query(req, 20000)).map(shape);
  await sendExcel(res, 'musabe-activity', [{
    name: 'Activity',
    title: 'Musabe Schools: activity',
    columns: [
      { header: 'Date and time', key: 'at', type: 'date', width: 20 },
      { header: 'What happened', key: 'summary', width: 70 },
      { header: 'Area', key: 'area', width: 18 },
      { header: 'By', key: 'by', width: 24 },
      { header: 'Role', key: 'byRole', width: 22 },
      { header: 'School', key: 'school', width: 18 },
    ],
    rows: rows.map((r) => ({ ...r, at: new Date(r.at), area: GROUPS[r.group]?.label || 'Other', by: r.by || 'System', school: r.schoolShort || 'Administration' })),
  }]);
});

module.exports = router;
