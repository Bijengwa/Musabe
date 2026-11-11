// Notifications: the bell in the top bar.
// Built from the activity log: each person is told about what concerns their role and school
// (lib/activity.js), never about their own actions, and not about everyday sign-ins.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth/session');
const { ROLES } = require('../auth/roles');
const { QUIET, groupOf, visible } = require('../lib/activity');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const base = () => visible(db('audit_log as a'), req.user)
    .whereNotIn('a.action', QUIET)
    .andWhere((w) => w.whereNull('a.user_id').orWhereNot('a.user_id', req.user.id));
  const seen = req.user.notif_seen_at || new Date(0);
  const [rows, [{ n }]] = await Promise.all([
    base().leftJoin('users as u', 'u.id', 'a.user_id').leftJoin('schools as s', 's.id', 'a.school_id')
      .select('a.id', 'a.at', 'a.action', 'a.summary', 's.short_name as school', 'u.full_name as by', 'u.role')
      .orderBy('a.at', 'desc').limit(30),
    base().where('a.at', '>', seen).count('* as n'),
  ]);
  res.json({
    unread: Number(n),
    items: rows.map((r) => ({ id: r.id, at: r.at, group: groupOf(r.action), summary: r.summary, school: r.school,
      by: r.by, byRole: ROLES[r.role]?.label, unread: new Date(r.at) > new Date(seen) })),
  });
});

router.post('/seen', async (req, res) => {
  await db('users').where({ id: req.user.id }).update({ notif_seen_at: db.fn.now() });
  res.json({ ok: true });
});

module.exports = router;
