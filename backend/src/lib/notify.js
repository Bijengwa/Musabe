// Who is told about what (the bell). Each role gets only what concerns its own work.
// The Activity page (lib/activity.js) is different: it is the full record for those allowed to read it.
//
// - Administration roles (all schools) get the actions in their rules from every school.
// - School roles get them only for their own school: audit_log.school_id, or detail.schoolIds
//   for changes that touch several schools (e.g. a new item sold in two schools).
// - Nobody is told about their own actions.
const { ROLES, pageAccess } = require('../auth/roles');

const LEADERS = ['super', 'director', 'adirector', 'manager'];
const FINANCE = ['fm', 'afm', 'acc', 'aacc'];

const RULES = [
  // Items and prices: what the bursar charges and what the library holds.
  { actions: ['item.create', 'item.update', 'item.price', 'item.archive', 'item.restore', 'item.import'],
    roles: ['bursar', 'librarian', 'head', ...FINANCE, ...LEADERS], why: 'Prices you work with changed' },
  // Excel uploads of items waiting for approval: only the people who can approve them.
  { actions: ['item.upload', 'item.discard'], roles: ['fm', 'afm'], why: 'Item uploads to approve' },
  // A parent has paid: the library will be asked for these items.
  { actions: ['receipt.create'], roles: ['librarian'], why: 'New receipts to give' },
  { actions: ['receipt.short'], roles: ['librarian', 'storekeeper', 'fm', 'acc'], why: 'Sold while the library has none: to order' },
  // Paid but not given for too long: the library must act, finance and leaders follow up.
  { actions: ['receipt.late'], roles: ['librarian', 'head', 'acc', 'aacc', 'fm', 'manager', 'super'], why: 'Receipts waiting too long' },
  // Stock: deliveries, requests, damaged / lost, low stock (2026-11-14).
  { actions: ['delivery.send', 'delivery.cancel'], roles: ['librarian'], why: 'Stock coming to your library' },
  { actions: ['delivery.confirm'], roles: ['fm', 'afm', 'acc'], why: 'Stock received by a library' },
  { actions: ['delivery.short'], roles: [...FINANCE, 'manager'], why: 'Less stock arrived than was sent' },
  { actions: ['request.create'], roles: ['fm', 'afm', 'acc', 'manager'], why: 'Stock requests to answer' },
  { actions: ['request.sent', 'request.decline'], roles: ['librarian'], why: 'Answers to your stock requests' },
  { actions: ['damage.report'], roles: [...FINANCE], why: 'Damaged / lost items to approve' },
  { actions: ['damage.approve', 'damage.reject'], roles: ['librarian', 'head'], why: 'Damaged / lost decisions' },
  { actions: ['stock.low'], roles: [...FINANCE], why: 'Low stock' },
  // Main store, issuing and the weekly check (2026-11-16).
  // Purchases: one store-keeper buys, the other counts with the accountant office, the accountant confirms.
  { actions: ['purchase.create'], roles: ['storekeeper', 'acc', 'aacc'], why: 'Purchases to count and confirm' },
  { actions: ['purchase.check'], roles: ['acc', 'aacc', 'storekeeper'], why: 'Purchases counted: to confirm' },
  { actions: ['purchase.confirm', 'purchase.reject'], roles: ['storekeeper', 'fm'], why: 'Purchases decided' },
  // Money going out: the Cashier is told when there is money to give; Mapokezi and the store-keeper when it was given
  // (goods will come to be checked); the person who wrote a request hears how it ended.
  { actions: ['payment.create'], roles: ['fm'], why: 'A payment voucher to authorize' },
  { actions: ['payment.authorized', 'payment.float'], roles: ['cashier'], why: 'Money to give out' },
  { actions: ['payment.floatpaid'], roles: ['mapokezi', 'storekeeper'], why: 'Money given to buy: goods to check soon' },
  { actions: ['payment.pay', 'payment.reject'], roles: ['aacc', 'fm', 'manager'], why: 'Your payment vouchers', own: true },
  // School requisitions: each signer is told when it is their turn; the Academic Master follows their own.
  { actions: ['requisition.create'], roles: ['acad'], why: 'Requisitions to sign' },
  { actions: ['requisition.create_gen', 'requisition.fixed_school'], roles: ['sstore'], why: 'Requisitions to sign (school store-keeper)' },
  { actions: ['requisition.acad'], roles: ['head'], why: 'Requisitions to sign' },
  // Whoever asked hears what happened to it (teacher, librarian, bursar).
  { actions: ['requisition.acad', 'requisition.head', 'requisition.amend', 'requisition.store', 'requisition.manager', 'requisition.reject', 'requisition.buying', 'requisition.arrived', 'requisition.sent', 'requisition.done'],
    roles: ['teacher', 'librarian', 'bursar', 'sstore'], why: 'Your requisitions', own: true },
  { actions: ['requisition.head'], roles: ['storekeeper'], why: 'Requisitions to sign' },
  // Sent back to the applicant to correct; and corrected: the one whose turn it is again is told.
  { actions: ['requisition.return'], roles: ['teacher', 'librarian', 'bursar', 'sstore', 'acad', 'head'], why: 'Requisition sent back to you to correct', own: true },
  { actions: ['requisition.fixed_acad'], roles: ['acad'], why: 'Requisitions to sign' },
  { actions: ['requisition.fixed_head'], roles: ['head'], why: 'Requisitions to sign' },
  { actions: ['requisition.fixed_store'], roles: ['storekeeper'], why: 'Requisitions to sign' },
  { actions: ['requisition.fixed_manager'], roles: ['manager'], why: 'Requisitions to sign' },
  { actions: ['requisition.store'], roles: ['manager'], why: 'Requisitions to sign' },
  { actions: ['requisition.manager', 'requisition.done'], roles: ['storekeeper'], why: 'Requisitions to buy or send' },
  { actions: ['requisition.manager', 'requisition.reject', 'requisition.done'], roles: ['head'], why: 'Requisitions of your school' },
  { actions: ['requisition.sent'], roles: ['librarian'], why: 'Stock coming to your library' },
  { actions: ['requisition.acad', 'requisition.amend', 'requisition.head', 'requisition.store', 'requisition.manager', 'requisition.reject', 'requisition.buying', 'requisition.arrived',
    'requisition.sent', 'requisition.done'], roles: ['acad'], why: 'Your requisitions', own: true },
  // ID cards: the person is told when their own card is recorded.
  { actions: ['idcard.issue', 'idcard.close'], roles: Object.keys(ROLES), why: 'Your ID card', own: true },
  { actions: ['count.create'], roles: ['acc', 'aacc'], why: 'Weekly checks to confirm' },
  { actions: ['count.confirm', 'count.reject'], roles: ['storekeeper', 'librarian', 'fm'], why: 'Weekly checks decided' },
  { actions: ['issue.return_bad'], roles: ['fm', 'acc', 'head', 'storekeeper'], why: 'Issued things came back damaged or were lost' },
  { actions: ['request.create', 'delivery.confirm', 'delivery.short'], roles: ['storekeeper'], why: 'Stock for the libraries' },
  // Control numbers: paid ones become receipts (librarian is told by receipt.create); cancellations to the accountant.
  { actions: ['bill.paid'], roles: ['bursar', 'acc', 'aacc'], why: 'Control numbers paid' },
  { actions: ['bill.cancel'], roles: ['acc', 'aacc', 'fm'], why: 'Control numbers cancelled' },
  // Daily money: the bursar hears about their own day; problems go to the finance leaders.
  { actions: ['money.check', 'money.problem'], roles: ['bursar'], why: 'Your daily money was checked', own: true },
  { actions: ['money.problem'], roles: ['fm', 'manager', 'super'], why: 'Cash short or over' },
  // Reminders for work waiting too long (lib/reminders.js).
  { actions: ['delivery.late'], roles: ['librarian', 'fm', 'afm', 'acc'], why: 'Deliveries not yet confirmed' },
  { actions: ['bill.expiring', 'bill.expired'], roles: ['bursar'], why: 'Control numbers about to expire or expired' },
  { actions: ['money.late'], roles: ['acc', 'aacc', 'fm'], why: 'Daily money not yet checked' },
  { actions: ['damage.late'], roles: ['fm', 'acc'], why: 'Damaged / lost waiting for approval' },
  { actions: ['request.late'], roles: ['fm', 'afm', 'acc', 'manager'], why: 'Stock requests waiting' },
  { actions: ['auth.locked'], roles: ['super'], why: 'Accounts locked after wrong passwords' },
  { actions: ['auth.takeover', 'auth.in_use'], roles: ['super', 'sadmin'], why: 'Accounts used from two places' },
  // Accounts: only the people who manage accounts.
  { actions: ['auth.reset_request', 'auth.locked', 'user.create', 'user.update', 'user.switch_on', 'user.switch_off', 'user.reset_password'],
    roles: ['super', 'sadmin'], why: 'Staff accounts you manage' },
  { actions: ['school.create', 'school.update'], roles: ['super', 'director', 'adirector'], why: 'Schools' },
  // Students: class lists loaded or changed in bulk.
  { actions: ['student.import'], roles: ['super', 'sadmin', 'head', 'acad'], why: 'Class lists loaded' },
  // Parents' app: a parent says a child does not show. The School Admin of that school checks and links.
  { actions: ['parent.request'], roles: ['sadmin'], why: "Parents' app requests" },
];

const actionsFor = (role) => [...new Set(RULES.filter((r) => r.roles.includes(role)).flatMap((r) => r.actions))];
// "own: true" rules: only when the change is about this person (detail.userId), e.g. the bursar's own daily money.
const ownOnly = (role) => {
  const own = new Set(RULES.filter((r) => r.own && r.roles.includes(role)).flatMap((r) => r.actions));
  for (const r of RULES) if (!r.own && r.roles.includes(role)) r.actions.forEach((a) => own.delete(a));
  return [...own];
};

// Limit a query on audit_log (alias "a") to this person's notifications.
function forUser(q, user) {
  const actions = actionsFor(user.role);
  if (!actions.length) return q.whereRaw('false');
  const own = ownOnly(user.role);
  q.whereIn('a.action', actions).andWhere((w) => w.whereNull('a.user_id').orWhereNot('a.user_id', user.id));
  if (own.length) q.andWhere((w) => w.whereNotIn('a.action', own).orWhereRaw(`a.detail ->> 'userId' = ?`, [String(user.id)]));
  if (ROLES[user.role]?.scope !== 'all') {
    q.andWhere((w) => w.where('a.school_id', user.school_id)
      .orWhereRaw(`a.detail -> 'schoolIds' @> ?::jsonb`, [JSON.stringify([user.school_id])]));
  }
  return q;
}

// Where a notification opens: the page that deals with it, if this person may open that page.
const LINKS = [
  [/^receipt\./, ['give', '/give'], ['receipts', '/receipts']],
  [/^give\./, ['receipts', '/receipts']],
  [/^item\.(upload|discard)$/, ['itemsupload', '/items'], ['items', '/items']],
  [/^item\./, ['items', '/items']],
  [/^delivery\./, ['incoming', '/incoming'], ['stockin', '/stock-in'], ['stock', '/stock']],
  [/^request\./, ['requests', '/requests']],
  [/^damage\./, ['damage', '/damage']],
  [/^stock\./, ['stock', '/stock']],
  [/^purchase\./, ['purchases', '/purchases']],
  [/^count\./, ['counts', '/counts']],
  [/^issue\./, ['issue', '/issue']],
  [/^requisition\./, ['requisitions', '/requisitions']],
  [/^payment\./, ['payments', '/payments'], ['requisitions', '/requisitions']],
  [/^idcard\./, ['home', '/profile']],
  [/^bill\./, ['bills', '/control-numbers']],
  [/^money\./, ['money', '/money']],
  [/^(auth|user)\./, ['staff', '/staff']],
  [/^school\./, ['schools', '/schools']],
  [/^student\./, ['students', '/students']],
  [/^parent\./, ['students', '/students/parents']],
];
function linkFor(action, role) {
  const row = LINKS.find(([re]) => re.test(action));
  if (!row) return null;
  const hit = row.slice(1).find(([page]) => pageAccess(role, page));
  return hit ? hit[1] : null;
}

module.exports = { RULES, actionsFor, forUser, linkFor };
