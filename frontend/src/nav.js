// Sidebar items. Which ones a person sees comes from the server (/api/auth/me -> pages).
// "ready: false" pages show a "coming in a later step" screen for now.
export const NAV = [
  { group: '', items: [{ key: 'home', label: 'Home', icon: 'home', path: '/', ready: true }] },
  { group: 'People', items: [
    { key: 'schools', label: 'Schools', icon: 'building', path: '/schools', ready: true },
    { key: 'staff', label: 'Staff accounts', icon: 'key', path: '/staff', ready: true },
  ] },
  // "sub" items are other screens of the Students page (one route); "perm" = which permission they use,
  // "level: 'f'" = only for those who can change students.
  { group: 'Students', items: [
    { key: 'students', label: 'Students', icon: 'users', path: '/students', ready: true },
    { key: 'student-add', perm: 'students', level: 'f', sub: true, label: 'Add student', icon: 'plus', path: '/students/new' },
    { key: 'student-upload', perm: 'students', level: 'f', sub: true, label: 'Upload class list', icon: 'upload', path: '/students/upload' },
    { key: 'student-move', perm: 'students', level: 'f', sub: true, label: 'Move / promote', icon: 'swap', path: '/students/move' },
    { key: 'student-classes', perm: 'students', editPerm: 'classlist', sub: true, label: 'Classes', icon: 'grid', path: '/students/classes' },
    { key: 'student-parents', perm: 'students', sub: true, label: "Parents' app requests", icon: 'users', path: '/students/parents' },
    // Admission interviews (2026-11-20): the Academic Secretary enters them; the School Admin registers those who passed.
    { key: 'interviews', label: 'Admission interviews', icon: 'pen', path: '/interviews', ready: true },
  ] },
  { group: 'Library & Sales', items: [
    { key: 'payments', label: 'Payment requests', icon: 'check', path: '/payments', ready: true },
    { key: 'salesdash', label: 'Sales dashboard', icon: 'trend', path: '/sales-dashboard', ready: true },
    { key: 'sell', label: 'Sell', icon: 'cart', path: '/sell', ready: true },
    { key: 'bills', label: 'Control numbers', icon: 'key', path: '/control-numbers', ready: true },
    { key: 'receipts', label: 'Receipts', icon: 'receipt', path: '/receipts', ready: true },
    { key: 'money', label: 'Daily money', icon: 'check', path: '/money', ready: true },
    { key: 'give', label: 'Give items', icon: 'hand', path: '/give', ready: true },
    { key: 'incoming', label: 'Incoming stock', icon: 'down', path: '/incoming', ready: true },
    { key: 'stockin', label: 'Send stock', icon: 'up', path: '/stock-in', ready: true },
    { key: 'requests', label: 'Stock requests', icon: 'inbox', path: '/requests', ready: true },
    { key: 'stock', label: 'Stock levels', icon: 'box', path: '/stock', ready: true },
    { key: 'damage', label: 'Damaged / lost', icon: 'alert', path: '/damage', ready: true },
    // The store-keeper has view access (needed to pick an item when sending stock) but never sees this page: it's prices, which is not their job.
    { key: 'items', label: 'Items & prices', icon: 'tag', path: '/items', ready: true, hideFor: ['storekeeper'] },
  ] },
  // Everything bought and used has a barcode and is given out by scanning (2026-11-16).
  { group: 'Store & barcodes', items: [
    { key: 'books', label: 'Store books', icon: 'book', path: '/store-books', ready: true },
    { key: 'orders', label: 'Order Book', icon: 'inbox', path: '/orders', ready: true },
    { key: 'requisitions', label: 'Payment requisitions', icon: 'file', path: '/requisitions', ready: true },
    { key: 'issue', label: 'Scan out / return', icon: 'scan', path: '/issue', ready: true },
    { key: 'labels', label: 'QR labels & ID cards', icon: 'tag', path: '/labels', ready: true },
    { key: 'purchases', label: 'Purchases & orders', icon: 'cart', path: '/purchases', ready: true },
    { key: 'useitems', label: 'Items to issue', icon: 'box', path: '/store', ready: true },
    { key: 'counts', label: 'Weekly check', icon: 'check', path: '/counts', ready: true },
  ] },
  // Office buying (2026-11-21): suppliers with price lists and debts, LPOs, work agreements, vehicles.
  { group: 'Office', items: [
    { key: 'suppliers', label: 'Suppliers & debts', icon: 'building', path: '/suppliers', ready: true },
    { key: 'lpo', label: 'LPO', icon: 'file', path: '/lpo', ready: true },
    { key: 'contracts', label: 'Work agreements', icon: 'pen', path: '/contracts', ready: true },
    { key: 'vehicles', label: 'Vehicles', icon: 'key', path: '/vehicles', ready: true },
  ] },
  { group: 'Academic', items: [
    { key: 'year', label: 'Year progress', icon: 'trend', path: '/year', step: 'Step 3: Academic' },
    { key: 'watch', label: 'Students to watch', icon: 'flag', path: '/watch', step: 'Step 3: Academic' },
    { key: 'classes', label: 'Class progress', icon: 'grid', path: '/classes', step: 'Step 3: Academic' },
    { key: 'marks', label: 'Exam sets & marks', icon: 'pen', path: '/marks', step: 'Step 3: Academic' },
    { key: 'bank', label: 'Question bank', icon: 'book', path: '/bank', step: 'Step 3: Academic' },
    { key: 'support', label: 'Support plans', icon: 'heart', path: '/support', step: 'Step 3: Academic' },
  ] },
  { group: 'System', items: [
    { key: 'reports', label: 'Reports', icon: 'file', path: '/reports', ready: true },
    { key: 'audit', label: 'Activity', icon: 'list', path: '/audit', ready: true },
  ] },
];

export const ALL_PAGES = NAV.flatMap((g) => g.items);

// Can this person see a sidebar item? (me.pages comes from the server)
export const navAccess = (pages, i, role) => {
  if (i.hideFor?.includes(role)) return null;
  const a = pages[i.perm || i.key];
  if (a && i.editPerm) return pages[i.editPerm] === 'f' ? 'f' : 'v';   // e.g. Classes: everyone looks, only the Academic Master changes them
  return a && (i.level !== 'f' || a === 'f') ? a : null;
};

// Pages every signed-in person has, whatever their role. Reached from the name card and the top-right menu.
export const MY_PAGES = [
  { key: 'profile', label: 'My profile', icon: 'user', path: '/profile' },
  { key: 'mysettings', label: 'Settings', icon: 'gear', path: '/settings' },
];

export const ADMIN_ROLES = ['super', 'director', 'adirector', 'manager', 'amanager', 'fm', 'afm', 'acc', 'aacc', 'storekeeper', 'cashier', 'mapokezi', 'secretary'];
export const ROLE_LABELS = {
  patron: 'Patron / Matron',
  super: 'Super Admin', director: 'Director', adirector: 'Assistant Director', manager: 'Manager', amanager: 'Assistant Manager',
  fm: 'Finance Manager', afm: 'Assistant Finance Manager', acc: 'Accountant', aacc: 'Assistant Accountant', storekeeper: 'Store-keeper',
  cashier: 'Cashier', mapokezi: 'Mapokezi (reception)', secretary: 'Academic Secretary',
  sadmin: 'School Admin', head: 'Head Master', acad: 'Academic Master', teacher: 'Subject Teacher',
  bursar: 'Bursar', librarian: 'Librarian', sstore: 'School Store-keeper',
};
