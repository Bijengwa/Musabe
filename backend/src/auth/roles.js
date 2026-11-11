// One place for roles and permissions.
// The sidebar (frontend) and every API check (backend) read from this file.

const ROLES = {
  super:     { label: 'Super Admin',               scope: 'all' },
  director:  { label: 'Director',                  scope: 'all' },
  adirector: { label: 'Assistant Director',        scope: 'all' },
  manager:   { label: 'Manager',                   scope: 'all' },
  fm:        { label: 'Finance Manager',           scope: 'all' },
  afm:       { label: 'Assistant Finance Manager', scope: 'all' },
  acc:       { label: 'Accountant',                scope: 'all' },
  aacc:      { label: 'Assistant Accountant',      scope: 'all' },
  sadmin:    { label: 'School Admin',              scope: 'school' },
  head:      { label: 'Head Master',               scope: 'school' },
  acad:      { label: 'Academic Master',           scope: 'school' },
  teacher:   { label: 'Subject Teacher',           scope: 'own' },
  bursar:    { label: 'Bursar',                    scope: 'school' },
  librarian: { label: 'Librarian',                 scope: 'school' },
};

// Administration roles have no school. School roles must have one.
const ADMIN_ROLES = ['super', 'director', 'adirector', 'manager', 'fm', 'afm', 'acc', 'aacc'];
const SCHOOL_ROLES = ['sadmin', 'head', 'acad', 'teacher', 'bursar', 'librarian'];

// Who can create (and manage) which accounts.
const CREATES = {
  super: [...ADMIN_ROLES, ...SCHOOL_ROLES],
  sadmin: ['head', 'acad', 'teacher', 'bursar', 'librarian'],
};

// Page access: 'f' = full, 'v' = view only, missing = hidden.
const parse = (s) =>
  Object.fromEntries(s.trim().split(/\s+/).map((x) => { const [k, v] = x.split(':'); return [k, v || 'f']; }));

const ACCESS = {
  super:     parse('home schools staff students items:v receipts:v requests:v stock:v damage:v year:v watch:v classes:v marks:v support:v reports audit settings'),
  director:  parse('home schools:v staff:v students:v receipts:v requests:v stock:v damage:v items:v year:v watch:v classes:v marks:v support:v reports audit:v'),
  manager:   parse('home schools:v staff:v students:v receipts:v requests:v stock:v damage:v items:v year:v watch:v classes:v support:v reports audit:v'),
  // Library (agreed 2026-11-11):
  // - Finance Manager: creates items and prices (sellable at once), sends stock, handles stock requests, approves damaged/lost.
  // - Assistant Finance Manager: sends stock and handles requests (until a Store-keeper role exists). Prices view only.
  // - Accountant: runs the items after they are created: sends stock, handles requests, watches bursar receipts live
  //   with alerts, confirms each bursar's daily money, approves damaged/lost, reports and Excel.
  // - Assistant Accountant: view and reports.
  fm:        parse('home students:v items stockin requests receipts:v stock:v damage reports audit:v'),
  afm:       parse('home students:v items:v stockin requests receipts:v stock:v damage:v reports audit:v'),
  acc:       parse('home students:v items:v stockin requests receipts:v stock:v damage reports audit:v'),
  aacc:      parse('home students:v items:v receipts:v stock:v damage:v reports audit:v'),
  sadmin:    parse('home staff students classes:v reports audit:v'),
  head:      parse('home staff:v students:v items:v receipts:v stock:v damage:v year watch classes marks:v bank:v support reports audit:v'),
  acad:      parse('home students:v year watch classes marks bank support reports'),
  teacher:   parse('home students:v year watch classes marks bank support'),
  bursar:    parse('home students:v items:v sell receipts stock:v reports'),
  librarian: parse('home items:v give incoming stock:v requests damage receipts:v reports'),
};
ACCESS.adirector = ACCESS.director;

const isAdminRole = (r) => ADMIN_ROLES.includes(r);
const isSchoolRole = (r) => SCHOOL_ROLES.includes(r);
const pageAccess = (role, page) => ACCESS[role]?.[page] || null;

// Can `actor` manage (edit, reset, switch off) the account `target`?
function canManage(actor, target) {
  if (!actor || !target || actor.id === target.id) return false;
  const allowed = CREATES[actor.role];
  if (!allowed || !allowed.includes(target.role)) return false;
  if (actor.role === 'sadmin') return target.school_id === actor.school_id;
  return true;
}

module.exports = { ROLES, ADMIN_ROLES, SCHOOL_ROLES, CREATES, ACCESS, isAdminRole, isSchoolRole, pageAccess, canManage };
