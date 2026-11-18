// Notifications: the bell in the top bar.
// Built from the activity log: each person is told only about what concerns their role and school
// (rules in lib/notify.js), never about their own actions.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth/session');
const { ROLES } = require('../auth/roles');
const { groupOf } = require('../lib/activity');
const { forUser, linkFor } = require('../lib/notify');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const base = () => forUser(db('audit_log as a'), req.user);
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
      by: r.by, byRole: ROLES[r.role]?.label, unread: new Date(r.at) > new Date(seen), link: linkFor(r.action, req.user.role) })),
  });
});

router.post('/seen', async (req, res) => {
  await db('users').where({ id: req.user.id }).update({ notif_seen_at: db.fn.now() });
  res.json({ ok: true });
});

module.exports = router;
