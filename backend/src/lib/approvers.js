// Who may approve money now (2026-11-25): the Manager first; when he is away, the Assistant Manager; when both are away, the Finance Manager.
// "Away" is a switch the Manager or the Assistant Manager sets in My profile. A person is counted by his main role and his extra roles.
const db = require('../db');

const OLDER = { manager: [], amanager: ['manager'], fm: ['manager', 'amanager'] };

// Is somebody with one of these roles in the office now (active and not away)?
async function present(roles) {
  const main = await db('users').where({ active: true, away: false }).whereIn('role', roles).first('id');
  if (main) return true;
  const extra = await db('user_roles as x').join('users as y', 'y.id', 'x.user_id').where({ 'x.active': true, 'y.active': true, 'y.away': false }).whereIn('x.role', roles).first('y.id');
  return !!extra;
}

// May this user (in the role he is using now) approve money at this moment?
async function canApproveMoney(user) {
  const before = OLDER[user.role];
  if (!before) return false;
  if (!before.length) return true;
  for (const r of before) if (await present([r])) return false;
  return true;
}

module.exports = { canApproveMoney, present };
