// The two mobile apps share this code. VITE_APP_FLAVOR picks which one is built (see package.json scripts).
// In a normal browser there is no flavor, so no splash is shown — except when testing with ?splash=parents or ?splash=staff.
export const FLAVORS = {
  parents: {
    name: 'Musabe Parents', tagline: "Stay close to your child's school",
    from: '#0f5a3a', to: '#d9b24a', accent: '#f1d27a', motion: 'pulse',
  },
  staff: {
    name: 'Musabe Staff', tagline: 'Musabe Schools, one system',
    from: '#0a2f23', to: '#12806f', accent: '#5fe0c4', motion: 'scan',
  },
};

export function currentFlavor() {
  const fromEnv = import.meta.env.VITE_APP_FLAVOR;
  let f = FLAVORS[fromEnv] ? fromEnv : null;
  if (!f && typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search).get('splash');
    if (FLAVORS[q]) f = q;
  }
  return f;
}
