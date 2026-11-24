// One place for roles and permissions.
// The sidebar (frontend) and every API check (backend) read from this file.

const ROLES = {
  super:     { label: 'Super Admin',               scope: 'all' },
  director:  { label: 'Director',                  scope: 'all' },
  adirector: { label: 'Assistant Director',        scope: 'all' },
  manager:   { label: 'Manager',                   scope: 'all' },
  amanager:  { label: 'Assistant Manager',         scope: 'all' },   // sent to buy (with the store-keeper); writes payment requisitions (2026-11-20)
  fm:        { label: 'Finance Manager',           scope: 'all' },
  afm:       { label: 'Assistant Finance Manager', scope: 'all' },
  acc:       { label: 'Accountant',                scope: 'all' },
  aacc:      { label: 'Assistant Accountant',      scope: 'all' },
  storekeeper: { label: 'Store-keeper',            scope: 'all' },
  cashier:   { label: 'Cashier',                   scope: 'all' },
  mapokezi:  { label: 'Mapokezi (reception)',      scope: 'all' },
  hr:        { label: 'HR (Human Resources)',      scope: 'all' },   // 2026-11-24: watches teachers' work and conduct (read only)
  secretary: { label: 'Academic Secretary',        scope: 'all' },   // Assistant Director's office: enters admission interview marks (2026-11-20)
  sadmin:    { label: 'School Admin',              scope: 'school' },
  head:      { label: 'Head Master / Mistress',      scope: 'school' },
  second:    { label: 'Second Master / Mistress',    scope: 'school' },   // Deputy Head Master: appoints the Teachers on Duty each week (2026-11-23)
  acad:      { label: 'Academic Master / Mistress',  scope: 'school' },
  disc:      { label: 'Discipline Master / Mistress', scope: 'school' }, // 2026-11-24: a teacher who got the discipline post; still teaches
  teacher:   { label: 'Subject Teacher',           scope: 'own' },
  bursar:    { label: 'Bursar',                    scope: 'school' },
  librarian: { label: 'Librarian',                 scope: 'school' },
  sstore:    { label: 'School Store-keeper',       scope: 'school' },
  patron:    { label: 'Patron / Matron',           scope: 'school' },   // boarding; writes in the Order Book (2026-11-20)   // keeps the school's other stores (linen, uniforms, cleaning...); first signer of general requisitions
};

// Administration roles have no school. School roles must have one.
const ADMIN_ROLES = ['super', 'director', 'adirector', 'manager', 'amanager', 'fm', 'afm', 'acc', 'aacc', 'storekeeper', 'cashier', 'mapokezi', 'secretary', 'hr'];
const SCHOOL_ROLES = ['sadmin', 'head', 'second', 'acad', 'disc', 'teacher', 'bursar', 'librarian', 'sstore', 'patron'];

// Who can create (and manage) which accounts.
const CREATES = {
  super: [...ADMIN_ROLES, ...SCHOOL_ROLES],
  sadmin: ['head', 'second', 'acad', 'disc', 'teacher', 'bursar', 'librarian', 'sstore', 'patron'],
};

// Page access: 'f' = full, 'v' = view only, missing = hidden.
const parse = (s) =>
  Object.fromEntries(s.trim().split(/\s+/).map((x) => { const [k, v] = x.split(':'); return [k, v || 'f']; }));

const ACCESS = {
  super:     parse('home books:v orders:v useitems:v schools staff students:v labels idcards requisitions:v issue:v purchases:v counts:v items:v receipts:v bills:v money:v salesdash:v requests:v stockin:v stock:v damage:v payments:v academics year:v watch:v classes:v marks:v support:v reports audit settings interviews:v classlist'),
  director:  parse('home books:v orders:v useitems:v schools:v staff:v students:v idcards:v requisitions:v issue:v purchases:v counts:v receipts:v bills:v money:v salesdash:v requests:v stockin:v stock:v damage:v items:v payments:v academics year:v watch:v classes:v marks:v support:v reports audit:v interviews:v'),
  // Assistant Director (agreed 2026-11-17): own, smaller access — meetings and academics, not money or stock.
  // The academic secretary works under this office.
  adirector: parse('home students:v idcards:v academics year watch classes marks:v support:v reports audit:v interviews'),
  manager:   parse('home books:v orders useitems:v schools:v staff:v students:v requisitions issue:v purchases:v counts:v receipts:v bills:v money:v requests:v stockin:v stock:v damage:v items:v payments year:v watch:v classes:v support:v reports audit:v interviews:v'),
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
  fm:        parse('home books:v orders:v useitems students:v requisitions issue:v purchases:v counts:v items itemsupload requests:v receipts:v bills:v money:v salesdash stock damage payments reports audit:v'),
  afm:       parse('home useitems:v students:v requisitions:v issue:v purchases:v counts:v items:v itemsupload requests:v receipts:v bills:v money:v salesdash stock:v damage:v reports audit:v'),
  acc:       parse('home books:v useitems:v students:v requisitions:v issue:v purchases counts items:v requests:v receipts:v bills money salesdash stock damage payments:v reports audit'),
  aacc:      parse('home books:v useitems:v students:v requisitions issue:v purchases counts items:v receipts:v bills:v money:v salesdash:v requests:v stock:v damage:v payments reports audit:v'),
  sadmin:    parse('home staff students labels idcards classes:v reports audit:v interviews:v'),
  head:      parse('home orders staff:v students:v idcards:v issue:v counts:v items:v receipts:v bills:v damage:v academics year watch classes marks:v bank:v support reports audit:v interviews:v'),
  acad:      parse('home orders students:v academics year watch classes marks bank support reports classlist interviews:v'),
  teacher:   parse('home academics year watch marks bank support'),
  bursar:    parse('home students:v items:v sell receipts bills money:v reports'),
  librarian: parse('home orders useitems:v items:v issue labels counts give incoming requests damage receipts:v reports'),
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
ACCESS.storekeeper = parse('home books orders requisitions purchases useitems items:v stock:v labels stockin requests audit:v');
// Cashier and Mapokezi (new roles, agreed 2026-11-17): the Money going out module they belong to is not built yet,
// so this is a minimal starting access — add the real pages here once that module exists (see the Gaps doc).
// - Cashier: pays out money the Manager has signed, on a Requested Cash Payout Voucher; records how a float was used
//   once Mapokezi accepts the purchase.
// - Mapokezi: receives everything bought, checks it against the receipts, and accepts it before the store-keeper
//   sends it on.
// Assistant Manager (2026-11-20): the person usually sent to buy, like the store-keeper. Writes payment requisitions
// and purchases; no QR labels or sending to schools (the store-keeper's job).
ACCESS.amanager = parse('home orders:v requisitions purchases useitems:v items:v stock:v requests:v reports audit:v');
ACCESS.cashier = parse('home payments requisitions:v purchases audit:v');   // sees the paper requisition he pays from (read only; he gives the money on the paper itself)
ACCESS.mapokezi = parse('home requisitions:v purchases audit:v');
// School Store-keeper (agreed 2026-11-18): writes requisitions for staff who have no account (patron, cleaners...) and signs the
// general ones first. Sees the requisitions of his school only.
ACCESS.sstore = parse('home orders');
// Patron / Matron (2026-11-20): asks for what the dormitories need with the Order Book.
ACCESS.patron = parse('home orders');
// Office buying (2026-11-21): suppliers + price lists + debts (suppliers), LPOs (lpo), work agreements (contracts), vehicles.
// - Procurement (Assistant Manager, store-keeper) keeps the suppliers and their price lists / proforma invoices and prepares LPOs.
// - Head of Accounts (Accountant) certifies an LPO; the Manager authorises it (the Finance Manager when he is away).
// - Payments to suppliers (debts) are recorded by the accountant office (Accountant, Assistant Accountant) or the Finance Manager.
// - Work agreements: the Assistant Accountant enters them (signed on paper by the Director and the contractor) and records each
//   instalment; the Accountant checks them (Imekaguliwa na).
// - Vehicles and their responsible driver: the Manager and the Assistant Manager.
const OFFICE = {
  suppliers: { f: ['amanager', 'storekeeper', 'acc', 'aacc', 'fm', 'manager'], v: ['super', 'director', 'cashier', 'afm'] },
  lpo: { f: ['amanager', 'storekeeper', 'acc', 'manager', 'fm'], v: ['super', 'director', 'aacc', 'mapokezi'] },
  contracts: { f: ['aacc', 'acc', 'director'], v: ['super', 'manager', 'fm', 'cashier'] },
  vehicles: { f: ['manager', 'amanager'], v: ['super', 'director', 'fm'] },
};
for (const [page, { f, v }] of Object.entries(OFFICE)) {
  for (const r of f) ACCESS[r][page] = 'f';
  for (const r of v) ACCESS[r][page] = ACCESS[r][page] || 'v';
}
// Academic Secretary (2026-11-20, Assistant Director's office): enters the admission interviews (marks from the teacher who
// marked, on paper or Excel). The School Admin of the school registers those who passed as students.
ACCESS.secretary = parse('home interviews students:v reports');
// Teacher on Duty and roll call (2026-11-23):
// - duty = the weekly Teacher on Duty list (and the daily duty reports). The Second Master appoints and reads the reports.
// - rollcall = taking the roll call. Teachers have 'f' but the server lets only this week's Teacher on Duty (or the
//   Second Master) save a roll call; everyone else listed here only looks.
ACCESS.second = parse('home students:v duty rollcall reports audit:v');
// 2026-11-24 teachers and academic leaders.
// - teaching = "My teaching": my classes, my students, my lessons, lesson log, my syllabus progress. Everyone who teaches
//   (Subject Teacher, Academic, Discipline, Second Master). The server shows only what is assigned to the person.
//   The Head Master does not teach in class: no page.
// - acadprogress = Academic progress from start to end, with each teacher's work. Academic Master writes (school-wide tests),
//   the Head Master and the administration offices look.
// - Subject Teacher: no Students and no Classes pages (only own students, inside "My teaching").
ACCESS.disc = parse('home students:v academics year watch marks bank support teaching reports audit:v');
for (const r of ['teacher', 'acad', 'second']) ACCESS[r].teaching = 'f';
ACCESS.disc.teaching = 'f';
ACCESS.acad.acadprogress = 'f'; ACCESS.head.acadprogress = 'v';
for (const r of ['director', 'adirector', 'manager', 'amanager', 'fm', 'super']) ACCESS[r].acadprogress = 'v';
ACCESS.hr = parse('home staff:v reports acadprogress:v');
for (const r of ['teacher', 'acad', 'disc']) Object.assign(ACCESS[r], { duty: 'v', rollcall: 'f' });
for (const r of ['head', 'super', 'director', 'adirector', 'sadmin']) Object.assign(ACCESS[r], { duty: 'v', rollcall: 'v' });
// classlist (2026-11-20): the Academic Master (own school) adds the classes and streams, from the levels built into the
// system (src/lib/levels.js). Everyone with the Students page still SEES the classes.

// School places, Issue Notes and GRN (2026-11-24).
// - notes = Issue Notes: the Second Master writes them; the Librarian (library things) or the School Store-keeper (school store things) gives.
// - grn = Goods Received Note at the school: made when a delivery is confirmed; the Bursar checks it, the Head Master approves it.
// - incoming (for the School Store-keeper): confirms the school-store lines of a delivery.
Object.assign(ACCESS.second, { notes: 'f', grn: 'v' });
Object.assign(ACCESS.head, { notes: 'v', grn: 'f' });
Object.assign(ACCESS.bursar, { notes: 'v', grn: 'f' });
Object.assign(ACCESS.librarian, { notes: 'f', grn: 'f' });
Object.assign(ACCESS.sstore, { notes: 'f', grn: 'f', incoming: 'f' });
for (const r of ['super', 'director', 'adirector', 'manager', 'fm', 'afm', 'acc', 'aacc', 'sadmin']) Object.assign(ACCESS[r], { notes: 'v', grn: 'v' });

// Fees (2026-11-24), the Finance Office: the Finance Manager writes the fee structure, the Manager / Director approves it,
// the Bursar records what parents pay, the Accountant office confirms each payment. The routes check who may do which step.
for (const r of ['fm', 'manager', 'director', 'bursar', 'acc', 'aacc', 'sadmin']) ACCESS[r].fees = 'f';
for (const r of ['afm', 'head', 'super']) ACCESS[r].fees = 'v';
// Internal audit (2026-11-24): the Accountant works the findings; others only look.
ACCESS.acc.intaudit = 'f';
for (const r of ['aacc', 'director', 'adirector', 'manager', 'super']) ACCESS[r].intaudit = 'v';
// School calendar (2026-11-24): the Head Master writes terms and the holiday program; others in the school look.
ACCESS.head.calendar = 'f';
for (const r of ['sadmin']) ACCESS[r].calendar = 'f';
for (const r of ['second', 'acad', 'teacher', 'bursar', 'librarian', 'sstore', 'patron', 'super', 'director', 'adirector', 'manager']) if (ACCESS[r]) ACCESS[r].calendar = 'v';

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
// Payment requisitions (2026-11-20): only administration roles see them; school staff use the Order Book.
// written ONLY by the people sent to buy: the Assistant Manager and the store-keeper.
// Everyone else asks with the Order Book (routes/orders.js). The Manager OR the Finance Manager approves the money.
const REQUISITION_MAKERS = ['amanager', 'storekeeper'];
const MONEY_APPROVERS = ['manager', 'fm'];

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

// One person, many roles (2026-11-20). These pairs may never be held by the same person: they check each other's money or goods.
const BLOCKED_PAIRS = [
  ['bursar', 'acc'], ['bursar', 'aacc'], ['bursar', 'cashier'],          // takes money / checks the money
  ['storekeeper', 'mapokezi'], ['amanager', 'mapokezi'],                 // buys / checks what was bought
  ['storekeeper', 'aacc'], ['amanager', 'aacc'],                         // buys / confirms purchases
  ['storekeeper', 'cashier'], ['amanager', 'cashier'],                   // receives the money to buy / gives it
  ['cashier', 'aacc'], ['cashier', 'mapokezi'],
  ['manager', 'amanager'], ['manager', 'storekeeper'], ['fm', 'amanager'], ['fm', 'storekeeper'],   // approves the money / spends it
];
const clash = (roles) => BLOCKED_PAIRS.find(([a, b]) => roles.includes(a) && roles.includes(b)) || null;

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

module.exports = { ROLES, ADMIN_ROLES, SCHOOL_ROLES, CREATES, ACCESS, DAMAGE_APPROVERS, ISSUERS, PURCHASE_CONFIRMERS, STORE_ITEM_MAKERS, CARD_ISSUERS, REQUISITION_MAKERS, MONEY_APPROVERS, REPORTS, canReport, BLOCKED_PAIRS, clash, isAdminRole, isSchoolRole, pageAccess, canManage };
