// Sidebar items. Which ones a person sees comes from the server (/api/auth/me -> pages).
// "ready: false" pages show a "coming in a later step" screen for now.
export const NAV = [
  { group: '', items: [{ key: 'home', label: 'Home', icon: 'home', path: '/', ready: true }] },
  { group: 'People', items: [
    { key: 'schools', label: 'Schools', icon: 'building', path: '/schools', ready: true },
    { key: 'staff', label: 'Staff accounts', icon: 'key', path: '/staff', ready: true },
    { key: 'students', label: 'Students', icon: 'users', path: '/students', step: 'Step 1b: Students' },
  ] },
  { group: 'Library & Sales', items: [
    { key: 'sell', label: 'Sell', icon: 'cart', path: '/sell', step: 'Step 2: Library & Sales' },
    { key: 'receipts', label: 'Receipts', icon: 'receipt', path: '/receipts', step: 'Step 2: Library & Sales' },
    { key: 'give', label: 'Give items', icon: 'hand', path: '/give', step: 'Step 2: Library & Sales' },
    { key: 'incoming', label: 'Incoming stock', icon: 'down', path: '/incoming', step: 'Step 2: Library & Sales' },
    { key: 'stockin', label: 'Send stock', icon: 'up', path: '/stock-in', step: 'Step 2: Library & Sales' },
    { key: 'requests', label: 'Stock requests', icon: 'inbox', path: '/requests', step: 'Step 2: Library & Sales' },
    { key: 'stock', label: 'Stock levels', icon: 'box', path: '/stock', step: 'Step 2: Library & Sales' },
    { key: 'damage', label: 'Damaged / lost', icon: 'alert', path: '/damage', step: 'Step 2: Library & Sales' },
    { key: 'items', label: 'Items & prices', icon: 'tag', path: '/items', step: 'Step 2: Library & Sales' },
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
    { key: 'reports', label: 'Reports', icon: 'file', path: '/reports', step: 'Step 4: Reports' },
    { key: 'audit', label: 'Audit log', icon: 'list', path: '/audit', ready: true },
  ] },
];

export const ALL_PAGES = NAV.flatMap((g) => g.items);

// Pages every signed-in person has, whatever their role. Reached from the name card and the top-right menu.
export const MY_PAGES = [
  { key: 'profile', label: 'My profile', icon: 'user', path: '/profile' },
  { key: 'mysettings', label: 'Settings', icon: 'gear', path: '/settings' },
];

export const ADMIN_ROLES = ['super', 'director', 'adirector', 'manager', 'fm', 'afm', 'acc', 'aacc'];
export const ROLE_LABELS = {
  super: 'Super Admin', director: 'Director', adirector: 'Assistant Director', manager: 'Manager',
  fm: 'Finance Manager', afm: 'Assistant Finance Manager', acc: 'Accountant', aacc: 'Assistant Accountant',
  sadmin: 'School Admin', head: 'Head Master', acad: 'Academic Master', teacher: 'Subject Teacher',
  bursar: 'Bursar', librarian: 'Librarian',
};
