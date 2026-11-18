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
  storekeeper: { label: 'Store-keeper',            scope: 'all' },
  cashier:   { label: 'Cashier',                   scope: 'all' },
  mapokezi:  { label: 'Mapokezi (reception)',      scope: 'all' },
  sadmin:    { label: 'School Admin',              scope: 'school' },
  head:      { label: 'Head Master',               scope: 'school' },
  acad:      { label: 'Academic Master',           scope: 'school' },
  teacher:   { label: 'Subject Teacher',           scope: 'own' },
  bursar:    { label: 'Bursar',                    scope: 'school' },
  librarian: { label: 'Librarian',                 scope: 'school' },
  sstore:    { label: 'School Store-keeper',       scope: 'school' },   // keeps the school's other stores (linen, uniforms, cleaning...); first signer of general requisitions
};

// Administration roles have no school. School roles must have one.
const ADMIN_ROLES = ['super', 'director', 'adirector', 'manager', 'fm', 'afm', 'acc', 'aacc', 'storekeeper', 'cashier', 'mapokezi'];
const SCHOOL_ROLES = ['sadmin', 'head', 'acad', 'teacher', 'bursar', 'librarian', 'sstore'];

// Who can create (and manage) which accounts.
const CREATES = {
  super: [...ADMIN_ROLES, ...SCHOOL_ROLES],
  sadmin: ['head', 'acad', 'teacher', 'bursar', 'librarian', 'sstore'],
};

// Page access: 'f' = full, 'v' = view only, missing = hidden.
const parse = (s) =>
  Object.fromEntries(s.trim().split(/\s+/).map((x) => { const [k, v] = x.split(':'); return [k, v || 'f']; }));

const ACCESS = {
  super:     parse('home useitems:v schools staff students:v labels idcards requisitions:v issue:v purchases:v counts:v items:v receipts:v bills:v money:v salesdash:v requests:v stockin:v stock:v damage:v payments:v year:v watch:v classes:v marks:v support:v reports audit settings'),
  director:  parse('home useitems:v schools:v staff:v students:v idcards:v requisitions:v issue:v purchases:v counts:v receipts:v bills:v money:v salesdash:v requests:v stockin:v stock:v damage:v items:v payments:v year:v watch:v classes:v marks:v support:v reports audit:v'),
  // Assistant Director (agreed 2026-11-17): own, smaller access — meetings and academics, not money or stock.
  // The academic secretary works under this office.
  adirector: parse('home students:v idcards:v year watch classes marks:v support:v reports audit:v'),
  manager:   parse('home useitems:v schools:v staff:v students:v requisitions issue:v purchases:v counts:v receipts:v bills:v money:v requests:v stockin:v stock:v damage:v items:v payments:v year:v watch:v classes:v support:v reports audit:v'),
  // Library and stock (agreed 2026-11-11 to 2026-11-17):
  // - Store-keeper (administration, one person): registers items the schools use but do not sell, sends stock to a
  //   school's library, handles the librarian's stock requests, puts the QR codes on. The ONLY one who sends stock.
  // - Finance Manager: creates sellable items and sets their prices, approves damaged/lost, sets reorder levels.
  //   (Still to rework: the Finance Manager should set a price on an item the store-keeper already registered,
  //   not create a new item itself — see the Gaps doc, "One shared item list". Not yet changed below.)
  // - Assistant Finance Manager: prices view only; no longer sends stock (that is the store-keeper's job alone).
  // - Accountant: watches bursar receipts live with alerts, confirms each bursar's daily money, approves
  //   damaged/lost, marks control numbers paid, reports and Excel. Confirms purchases (see PURCHASE_CONFIRMERS).
  //   No longer sends stock.
  // - Assistant Accountant: view and reports, plus day-to-day payment approval once Money going out exists.
  // - itemsupload: upload items and prices from Excel. The uploader checks them on a review page and approves.
  // - Stock levels: only the finance office and the accountant office (and the top leaders). Not bursars, librarians, Head Master.
  // - Sales dashboard (salesdash): only the finance office and the accountant office (and Super Admin / Director). Not bursars.
  // - Control numbers (bills): the bursar makes them; the bursar or the accountant marks them paid.
  // - Daily money (money): the accountant confirms each bursar's day; a bursar sees only their own days.
  fm:        parse('home useitems students:v requisitions:v issue:v purchases:v counts:v items itemsupload requests:v receipts:v bills:v money:v salesdash stock damage payments reports audit:v'),
  afm:       parse('home useitems:v students:v requisitions:v issue:v purchases:v counts:v items:v itemsupload requests:v receipts:v bills:v money:v salesdash stock:v damage:v reports audit:v'),
  acc:       parse('home useitems:v students:v requisitions:v issue:v purchases counts items:v requests:v receipts:v bills money salesdash stock damage payments:v reports audit'),
  aacc:      parse('home useitems:v students:v requisitions:v issue:v purchases counts items:v receipts:v bills:v money:v salesdash:v requests:v stock:v damage:v payments reports audit:v'),
  sadmin:    parse('home staff students labels idcards classes:v reports audit:v'),
  head:      parse('home staff:v students:v idcards:v requisitions issue:v counts:v items:v receipts:v bills:v damage:v year watch classes marks:v bank:v support reports audit:v'),
  acad:      parse('home students:v requisitions year watch classes marks bank support reports'),
  teacher:   parse('home students:v requisitions year watch classes marks bank support'),
  bursar:    parse('home students:v items:v sell requisitions receipts bills money:v reports'),
  librarian: parse('home useitems:v items:v issue labels counts give incoming requests damage requisitions receipts:v reports'),
};
// Barcodes, store and issuing (agreed 2026-11-16; store-keeper and sending-stock corrected 2026-11-17):
// - There is NO main store. ONE store-keeper (administration): receives what Mapokezi has already checked and
//   approved against the receipts, registers it, puts the QR codes on, and sends it to the school it is for —
//   without checking it again (Mapokezi already did that). The ONLY one who sends stock to a school; never the
//   Finance office or the Accountant's office (ACCESS.fm/afm/acc no longer have "stockin"). Never sees selling prices.
// - Each school has its own store-keeper, who receives what the administration store-keeper sent, checks it, and
//   delivers it to the kitchen, the library, or any point in the school (routes/purchases.js, routes/requisitions.js
//   still describe the OLD two-administration-store-keeper design and need rewriting to match this — see the Gaps doc).
// - Accountant and Assistant Accountant: confirm purchases and weekly checks (never their own).
// - Librarian: the only one who gives things out (sold items against the bursar's receipt, and issued things), by
//   scanning the student / staff ID and the QR on the thing; takes things back; weekly check of the library.
// - School Admin: uploads students, prints the ID cards of own school, records who received them.
// - Super Admin: views students and the reports of the class lists uploaded (no uploading).
// Pages: useitems = the list of things the schools use (not sold), with the Excel import; issue = scan out / return; labels = QR labels and ID cards; purchases; counts = weekly check and ledger.
// No selling prices for the store-keeper (no Items &prices page), no main store, no issuing: the librarian gives out.
ACCESS.storekeeper = parse('home requisitions purchases useitems items:v stock:v labels stockin requests audit:v');
// Cashier and Mapokezi (new roles, agreed 2026-11-17): the Money going out module they belong to is not built yet,
// so this is a minimal starting access — add the real pages here once that module exists (see the Gaps doc).
// - Cashier: pays out money the Manager has signed, on a Requested Cash Payout Voucher; records how a float was used
//   once Mapokezi accepts the purchase.
// - Mapokezi: receives everything bought, checks it against the receipts, and accepts it before the store-keeper
//   sends it on.
ACCESS.cashier = parse('home payments requisitions:v purchases audit:v');   // sees the paper requisition he pays from (read only; he gives the money on the paper itself)
ACCESS.mapokezi = parse('home requisitions:v purchases audit:v');
// School Store-keeper (agreed 2026-11-18): writes requisitions for staff who have no account (patron, cleaners...) and signs the
// general ones first. Sees the requisitions of his school only.
ACCESS.sstore = parse('home requisitions');

const ISSUERS = ['librarian'];                           // gives out and takes back by scanning, counts the library (no main store)
const PURCHASE_CONFIRMERS = ['aacc'];             // confirm purchases and weekly checks
const STORE_ITEM_MAKERS = ['storekeeper'];               // add things the school uses but does not sell (not the Finance Manager); for things that ARE sold, the store-keeper only picks from the Finance Manager's existing list and records how many came in — never creates a new sellable item
// ID cards (2026-11-16): the School Admin records that a card was handed over (own school, students and staff);
// the Super Admin does it for administration staff and can do it everywhere.
const CARD_ISSUERS = ['sadmin', 'super'];
// Purchases (2026-11-16, corrected 2026-11-17): the Assistant Manager or the store-keeper buys. Mapokezi receives
// the goods and checks them against the receipts; the ONE administration store-keeper then puts the QR codes on
// and sends them on (no second store-keeper cross-check); the Accountant / Assistant Accountant confirms.
// Requisitions: Academic Master asks, Head Master signs, store-keeper signs, Manager signs; then the store-keeper
// buys or sends. routes/purchases.js and routes/requisitions.js still have the OLD two-store-keeper wording and
// need rewriting to match this (see the Gaps doc).
const REQUISITION_MAKERS = ['acad', 'head', 'teacher', 'librarian', 'sstore', 'bursar'];

// Who approves damaged / lost items (agreed 2026-11-11): only these two.
const DAMAGE_APPROVERS = ['fm', 'acc'];

// Reports (Reports page). Each report lists the roles that may download it.
// School roles always get their own school only. Bursars get only their own receipts in the money reports.
const FIN = ['fm', 'afm', 'acc', 'aacc'];
const TOP = ['super', 'director', 'adirector'];
const REPORTS = {
  'sales-book':      [...FIN, ...TOP, 'manager', 'bursar'],
  'items-sold':      [...FIN, ...TOP, 'manager', 'bursar'],
  'daily-money':     [...FIN, ...TOP, 'manager', 'bursar'],
  'control-numbers': [...FIN, ...TOP, 'manager', 'bursar'],
  'library-waiting': [...FIN, ...TOP, 'manager', 'head', 'librarian'],
  'stock-levels':    [...FIN, ...TOP, 'manager'],
  'stock-card':      [...FIN, ...TOP, 'manager'],
  'deliveries':      [...FIN, ...TOP, 'manager', 'librarian', 'storekeeper'],
  'requests':        [...FIN, ...TOP, 'manager', 'librarian', 'storekeeper'],
  'damage':          [...FIN, ...TOP, 'manager', 'head', 'librarian'],
  // Students: the School Admins upload class lists; the Super Admin follows them here (2026-11-16).
  'student-uploads': [...TOP, 'sadmin', 'head'],
  'students-list':   [...TOP, 'sadmin', 'head'],
};
const canReport = (role, key) => !!REPORTS[key]?.includes(role);

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

module.exports = { ROLES, ADMIN_ROLES, SCHOOL_ROLES, CREATES, ACCESS, DAMAGE_APPROVERS, ISSUERS, PURCHASE_CONFIRMERS, STORE_ITEM_MAKERS, CARD_ISSUERS, REQUISITION_MAKERS, REPORTS, canReport, isAdminRole, isSchoolRole, pageAccess, canManage };
