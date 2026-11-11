// Personal look of the app: Light / Dark / System, and text size.
// Saved on the server (follows the person to every device) and copied here so the
// sign-in page and the first paint already use it (see the small script in index.html).
const KEY = 'musabe-prefs';
const dark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches;

export function readPrefs() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

function paint({ theme = 'system', textSize = 'normal' }) {
  const isDark = theme === 'dark' || (theme === 'system' && dark());
  const root = document.documentElement;
  root.dataset.theme = isDark ? 'dark' : 'light';
  root.dataset.text = textSize;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#08120d' : '#0c3a29');
}

export function applyPrefs(p = {}) {
  const clean = { theme: p.theme || 'system', textSize: p.textSize || 'normal' };
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { /* private mode */ }
  paint(clean);
}

// When "System" is chosen, follow the phone or computer when it switches between day and night.
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => paint(readPrefs()));
