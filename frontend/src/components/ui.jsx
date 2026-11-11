/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const P = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10', building: 'M4 21V6l8-3 8 3v15M9 21v-5h6v5M8 9h1M15 9h1M8 13h1M15 13h1',
  key: 'M14.5 4a5.5 5.5 0 1 1-4.9 8H3v4h3v3h3v-3h1.6', users: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  cart: 'M3 3h2l2.4 12h11l2-8H6M9 20h.01M18 20h.01', receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h3',
  hand: 'M20 12V8a2 2 0 0 0-4 0M16 8V5a2 2 0 0 0-4 0v1M12 6a2 2 0 0 0-4 0v6M8 10a2 2 0 0 0-4 0v3a8 8 0 0 0 16 0v-1',
  down: 'M12 3v13M6 11l6 6 6-6M4 21h16', up: 'M12 21V8M6 13l6-6 6 6M4 3h16', inbox: 'M3 13h5l1 3h6l1-3h5M5 5h14l2 8v6H3v-6z',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10', alert: 'M12 3l10 18H2zM12 10v4M12 17v.5', tag: 'M3 3h8l10 10-8 8L3 11zM7.5 7.5h.01',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6', flag: 'M5 21V4h11l-2 4 2 4H5', grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  pen: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4', book: 'M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z',
  heart: 'M12 20s-8-5-8-11a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 6-8 11-8 11z', file: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', gear: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  menu: 'M3 6h18M3 12h18M3 18h18', swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7', x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14', check: 'M5 12l5 5L20 7', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4', copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  logout: 'M9 21H5V3h4M16 17l5-5-5-5M21 12H9', user: 'M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  phone: 'M7 2h10v20H7zM11 18h2', monitor: 'M3 4h18v12H3zM8 20h8M12 16v4', mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z', auto: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v18', text: 'M4 7V5h12v2M10 5v14M8 19h4M14 13v-1h7v1M17.5 12v7M16 19h3',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', chev: 'M9 6l6 6-6 6', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3', edit: 'M4 20h4L19 9l-4-4L4 16z',
};
export const Icon = ({ name, size }) => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" style={size ? { width: size, height: size } : undefined}><path d={P[name] || ''} /></svg>
);

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="mwrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="mh"><h2>{title}</h2><button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="mb">{children}</div>
        {footer && <div className="mf">{footer}</div>}
      </div>
    </div>
  );
}

const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null);
  const t = useRef();
  const show = useCallback((m) => { setMsg(m); clearTimeout(t.current); t.current = setTimeout(() => setMsg(null), 2800); }, []);
  return <ToastCtx.Provider value={show}>{children}{msg && <div className="toast" role="status">{msg}</div>}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

export const PageHead = ({ title, sub, children }) => (
  <div className="ph1"><div className="t"><h1>{title}</h1>{sub && <p>{sub}</p>}</div>{children && <div className="acts">{children}</div>}</div>
);
export const Panel = ({ title, sub, right, flush, children }) => (
  <section className="panel">
    {title && <div className="hd"><h2>{title}</h2>{sub && <span className="sub">{sub}</span>}{right && <div className="r">{right}</div>}</div>}
    <div className={`bd${flush ? ' flush' : ''}`}>{children}</div>
  </section>
);
export const Kpi = ({ label, value, sub, tone }) => (
  <div className={`kpi ${tone || ''}`}><span className="l">{label}</span><span className="v">{value}</span>{sub && <span className="s">{sub}</span>}</div>
);
export const SchoolPill = ({ code, name }) =>
  code ? <span className={`sp sp-${['pre', 'boys', 'girls'].includes(code) ? code : 'other'}`}>{name}</span> : <span className="pill">Administration</span>;
// Round badge with the person's initials (titles like Mr./Dr. are skipped).
export function initials(name = '') {
  const w = name.replace(/^(mr|mrs|ms|miss|dr|prof|rev|sr|fr)\.?\s+/i, '').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase() || '?';
}
export const Avatar = ({ name, size = 'md' }) => <span className={`avatar ${size}`} aria-hidden="true">{initials(name)}</span>;

// ---- Phone numbers: Tanzanian mobile, exactly 10 digits, starting with 06 or 07 ----
// Keeps only digits, turns +255 / 255 into 0, and stops at 10 digits.
export function cleanPhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('255')) d = `0${d.slice(3)}`;
  return d.slice(0, 10);
}
// "0754123456" -> "0754 123 456" (also groups a number that is still being typed)
export const fmtPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return [d.slice(0, 4), d.slice(4, 7), d.slice(7, 10)].filter(Boolean).join(' ');
};
// What is wrong with a number, in plain words ('' when it is fine or empty).
export function phoneProblem(d) {
  if (!d) return '';
  if (d[0] !== '0') return 'Start with 0, e.g. 0754 123 456.';
  if (d.length > 1 && d[1] !== '6' && d[1] !== '7') return 'Tanzanian mobile numbers start with 06 or 07.';
  if (d.length < 10) return `${10 - d.length} more digit${10 - d.length > 1 ? 's' : ''} needed (10 in total).`;
  return '';
}
// Phone box: type or paste any way; it keeps 10 digits and shows them as 0754 123 456.
export function PhoneInput({ id, value, onChange, autoFocus }) {
  const problem = phoneProblem(value);
  return (
    <>
      <input id={id} type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="0754 123 456"
        value={fmtPhone(value)} onChange={(e) => onChange(cleanPhone(e.target.value))} autoFocus={autoFocus}
        aria-invalid={!!problem} className={problem ? 'bad' : ''} />
      {problem && <span className="fieldhint">{problem}</span>}
    </>
  );
}

export const Empty = ({ children }) => <div className="empty">{children}</div>;
export const ErrorNote = ({ error }) => (error ? <p className="err" role="alert">{error}</p> : null);

export function CopyBox({ label, value }) {
  const toast = useToast();
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); toast('Copied'); } catch { toast('Select the text and copy it'); }
  };
  return (
    <div className="copybox"><span className="l">{label}</span><div className="row"><code>{value}</code>
      <button className="btn sm" onClick={copy} type="button"><Icon name="copy" /> Copy</button></div></div>
  );
}

export function fmtWhen(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} ${time}`;
}
