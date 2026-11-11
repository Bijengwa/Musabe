// Activity groups and who sees what. Used by the Activity page and by notifications.
// An activity's group comes from the first part of its action, e.g. "item.price" -> library.
const { ROLES } = require('../auth/roles');

const GROUPS = {
  library: { label: 'Library & sales', prefixes: ['item', 'stock', 'receipt', 'sale', 'give', 'damage', 'request', 'money'] },
  accounts: { label: 'Accounts & sign-in', prefixes: ['user', 'auth', 'profile'] },
  schools: { label: 'Schools', prefixes: ['school'] },
  academic: { label: 'Academic', prefixes: ['student', 'class', 'exam', 'mark', 'topic', 'support'] },
};
const ALL = Object.keys(GROUPS);

// Which groups each role may see (on the Activity page and in notifications).
const SEE = {
  super: ALL, director: ALL, adirector: ALL, manager: ALL,
  fm: ['library'], afm: ['library'], acc: ['library'], aacc: ['library'],
  sadmin: ['accounts', 'schools', 'academic'], head: ALL, acad: ['academic'], teacher: ['academic'],
  bursar: ['library'], librarian: ['library'],
};

// Everyday actions that would only be noise as notifications (still shown on the Activity page).
const QUIET = ['auth.login', 'auth.password_change', 'auth.session_end', 'profile.update'];

const groupOf = (action) => ALL.find((g) => GROUPS[g].prefixes.includes(String(action).split('.')[0])) || 'other';
const prefixesFor = (groups) => groups.flatMap((g) => GROUPS[g]?.prefixes || []);

// Limit a query on audit_log (alias "a") to what this person may see.
function visible(q, user, { group } = {}) {
  const allowed = SEE[user.role] || [];
  const groups = group ? allowed.filter((g) => g === group) : allowed;
  const prefixes = prefixesFor(groups);
  if (!prefixes.length) return q.whereRaw('false');
  q = q.whereRaw(`split_part(a.action, '.', 1) = ANY(?)`, [prefixes]);
  // School staff: their own school, plus administration-wide library changes (e.g. a new item)
  if (ROLES[user.role]?.scope !== 'all') {
    q = q.where((w) => w.where('a.school_id', user.school_id)
      .orWhere((x) => x.whereNull('a.school_id').whereRaw(`split_part(a.action, '.', 1) = 'item'`)));
  }
  return q;
}

module.exports = { GROUPS, SEE, QUIET, groupOf, visible };
