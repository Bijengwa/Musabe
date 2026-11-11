const express = require('express');
const db = require('../db');
const { requireAuth, requirePage } = require('../auth/session');
const { ROLES } = require('../auth/roles');

const router = express.Router();
router.use(requireAuth);

router.get('/', requirePage('audit'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  let q = db('audit_log as a')
    .leftJoin('users as u', 'u.id', 'a.user_id')
    .leftJoin('schools as s', 's.id', 'a.school_id')
    .select('a.id', 'a.at', 'a.action', 'a.summary', 'a.school_id', 's.short_name as school_short', 'u.full_name', 'u.role')
    .orderBy('a.at', 'desc').limit(limit);
  if (ROLES[req.user.role].scope !== 'all') q = q.where('a.school_id', req.user.school_id);
  else if (req.query.school === 'admin') q = q.whereNull('a.school_id');
  else if (req.query.school) q = q.where('a.school_id', Number(req.query.school));
  const rows = await q;
  res.json({
    entries: rows.map((r) => ({ id: r.id, at: r.at, action: r.action, summary: r.summary, schoolId: r.school_id,
      schoolShort: r.school_short, by: r.full_name, byRole: ROLES[r.role]?.label })),
  });
});

module.exports = router;
