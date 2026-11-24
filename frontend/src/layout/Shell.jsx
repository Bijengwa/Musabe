import HelpChat from '../components/HelpChat';
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { NAV, ALL_PAGES, MY_PAGES, navAccess } from '../nav';
import { Avatar, Icon, PageSkeleton, SchoolPill } from '../components/ui';
import { useSchools, useScope } from './scope';
import { useLiveStatus } from '../live';
import Bell from './Bell';
import Shortcuts from '../components/shortcuts';

const PHONE = 900;
const isPhone = () => window.innerWidth <= PHONE;
const readMini = () => { try { return localStorage.getItem('musabe-side-mini') === '1'; } catch { return false; } };

export default function Shell() {
  const { me, user } = useAuth();
  const { pathname } = useLocation();
  const contentRef = useRef(null);
  usePinnedLayout(contentRef, pathname);
  const [open, setOpen] = useState(false);     // phone drawer
  const [mini, setMini] = useState(readMini);  // desktop icon rail
  const schools = useSchools();
  const [scope, setScope] = useScope();

  // Close the drawer when a page is picked (see NavLink onClick), the screen grows, or Esc is pressed.
  useEffect(() => {
    const onResize = () => { if (!isPhone()) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('keydown', onKey); };
  }, []);
  useEffect(() => { document.body.style.overflow = open ? 'hidden' : ''; }, [open]);

  const toggle = () => {
    if (isPhone()) setOpen((o) => !o);
    else setMini((m) => { try { localStorage.setItem('musabe-side-mini', m ? '' : '1'); } catch { /* ignore */ } return !m; });
  };

  // The page we are on: the longest sidebar path that matches (e.g. /students/new is "Add student", /students/12 is "Students").
  const matches = (p) => (p.path === '/' ? pathname === '/' : pathname === p.path || pathname.startsWith(`${p.path}/`));
  const current = [...MY_PAGES, ...ALL_PAGES.filter((p) => navAccess(me.pages, p, me.role))].filter(matches).sort((a, b) => b.path.length - a.path.length)[0];
  const activeKey = current?.key;
  const allScope = user.scope === 'all';

  return (
    <div className={`app${open ? ' open' : ''}${mini ? ' mini' : ''}`}>
      <div className="scrim" onClick={() => setOpen(false)} />
      <aside className="side" aria-label="Main menu">
        <div className="brand">
          <img className="logo" src="/musabe-logo.png" alt="Musabe Schools" />
          <div><b>Musabe Schools</b><span>{user.school ? user.school.shortName : 'Administration'}</span></div>
          <button className="close" onClick={() => setOpen(false)} aria-label="Close menu"><Icon name="x" /></button>
        </div>
        <NavLink to="/profile" className={({ isActive }) => `who${isActive ? ' on' : ''}`} title="My profile" onClick={() => setOpen(false)}>
          <Avatar name={user.fullName} size="sm" />
          <div><b>{user.fullName}</b><span>{user.roleLabel}</span></div>
          <Icon name="chev" />
        </NavLink>
        <RoleSwitch onDone={() => setOpen(false)} />
        <nav className="sidenav">
        {NAV.map((g) => {
          const items = g.items.filter((i) => navAccess(me.pages, i, me.role));
          if (!items.length) return null;
          return (
            <div className="navg" key={g.group || 'main'}>
              {g.group && <h4>{g.group}</h4>}
              {items.map((i) => (
                <NavLink key={i.key} to={i.path} end={i.path === '/'} title={i.label} onClick={() => setOpen(false)} className={`nav${i.key === activeKey ? ' on' : ''}${i.sub ? ' subnav' : ''}`}>
                  <Icon name={i.icon} /><span>{i.label}</span>
                  {navAccess(me.pages, i, me.role) === 'v' && <span className="vo">view</span>}
                </NavLink>
              ))}
            </div>
          );
        })}
        </nav>
        <div className="sidefoot">
          <NavLink to="/settings" title="Settings" onClick={() => setOpen(false)} className={({ isActive }) => `nav${isActive ? ' on' : ''}`}><Icon name="gear" /><span>Settings</span></NavLink>
        </div>
      </aside>
      <div className="main">
        <header className="top">
          <button className="menu" onClick={toggle} aria-label="Open or close menu" aria-expanded={isPhone() ? open : !mini}><Icon name="menu" /></button>
          <span className="crumb">{current?.label || 'Musabe Schools'}</span>
          <LiveDot />
          <div className="right">
            {allScope ? (
              <>
                <div className="seg" role="group" aria-label="School">
                  <button className={scope === '' ? 'on' : ''} onClick={() => setScope('')}>All schools</button>
                  {schools.map((s) => <button key={s.id} className={scope === String(s.id) ? 'on' : ''} onClick={() => setScope(String(s.id))}>{s.shortName}</button>)}
                </div>
                <select className="scope-sel" aria-label="School" value={scope} onChange={(e) => setScope(e.target.value)}>
                  <option value="">All schools</option>
                  {schools.map((s) => <option key={s.id} value={s.id}>{s.shortName}</option>)}
                </select>
              </>
            ) : (
              <SchoolPill code={user.school?.code} name={user.school?.shortName} />
            )}
            <Bell />
            <UserMenu />
          </div>
        </header>
        <main className="content" ref={contentRef}>
          {/* A page that is still downloading shows its skeleton here; the menu and top bar stay. */}
          <Suspense key={pathname.split('/')[1] || 'home'} fallback={<PageSkeleton kpis />}><Outlet /></Suspense>
        </main>
        <HelpChat />
        <Shortcuts />
      </div>
    </div>
  );
}

// One person, many roles (2026-11-20): "Working as" chooses which of my roles this device uses now.
// The sidebar, pages, buttons and "To do" follow it. Only shown to people with more than one role.
function RoleSwitch({ onDone }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user.roles || user.roles.length < 2) return null;
  const change = async (role) => {
    if (role === user.role) return;
    setBusy(true);
    // A fresh start of the app: every page, list and cache is loaded again for the new role.
    try { await api.post('/me/role', { role }); onDone?.(); window.location.assign('/'); } catch { setBusy(false); }
  };
  return (
    <label className="roleswitch">
      <span>Working as</span>
      <select value={user.role} disabled={busy} onChange={(e) => change(e.target.value)} aria-label="Working as">
        {user.roles.map((r) => <option key={r.role} value={r.role}>{r.label}{r.school ? ` · ${r.school}` : ''}</option>)}
      </select>
    </label>
  );
}

// Top-right: the person's initials. Opens a small menu with profile and settings.
// Sign out and Light/Dark are only on the Settings page.
function UserMenu() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="umenu" ref={box}>
      <button className="ubtn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="My account">
        <Avatar name={user.fullName} size="sm" />
      </button>
      {open && (
        <div className="udrop" role="menu">
          <div className="uhead"><Avatar name={user.fullName} /><div><b>{user.fullName}</b><span>{user.roleLabel}</span><span>@{user.username}</span></div></div>
          <Link role="menuitem" to="/profile" onClick={() => setOpen(false)}><Icon name="user" /> My profile</Link>
          <Link role="menuitem" to="/settings" onClick={() => setOpen(false)}><Icon name="gear" /> Settings</Link>
        </div>
      )}
    </div>
  );
}

// Small dot next to the page name: green = live, orange = reconnecting.
function LiveDot() {
  const s = useLiveStatus();
  if (s === 'off') return null;
  const live = s === 'live';
  return (
    <span className={`livedot${live ? ' on' : ''}`} title={live ? 'Live: changes show here at once' : 'Reconnecting… changes will show when the connection is back'}>
      <i />{live ? 'Live' : 'Reconnecting…'}
    </span>
  );
}

// Page layout: the page (.content) is the one thing that scrolls. Cards and headings scroll away; the filter bar stays at
// the top, and the main table (the last block on the page) fills the rest of the screen and scrolls inside itself,
// so its header row stays under the filter bar. Nothing here knows about any one page: it looks at what the page drew.
// (A sticky header cannot work inside a box that scrolls sideways unless that box also scrolls up and down, so the
// table box gets a real height here.)
function usePinnedLayout(ref, route) {
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return undefined;
    let raf = 0;
    const clear = (els) => els.forEach((e) => { e.classList.remove('pinbar', 'pinpanel'); e.style.top = ''; e.style.maxHeight = ''; });
    const run = () => {
      raf = 0;
      let root = c;
      // A page wrapped in one plain <div>: look inside it.
      while (root.children.length === 1 && root.firstElementChild.tagName === 'DIV' && !/\b(panel|filters|kpis|ph1)\b/.test(root.firstElementChild.className)) root = root.firstElementChild;
      const kids = [...root.children].filter((k) => k.tagName !== 'P'); // a short note under the table does not count
      clear([...c.querySelectorAll('.pinbar, .pinpanel')]);
      const last = kids[kids.length - 1];
      if (!last || !last.classList.contains('panel')) return;
      let top = 0;
      kids.slice(0, -1).filter((k) => k.classList.contains('filters')).forEach((k) => {
        k.classList.add('pinbar'); k.style.top = `calc(${top}px - var(--cpt))`; top += k.offsetHeight;
      });
      if (last.querySelector(':scope > .bd > .tw, :scope > .tw')) {
        last.classList.add('pinpanel');
        last.style.top = `calc(${top}px - var(--cpt))`;
        last.style.maxHeight = `${Math.max(240, c.clientHeight - top - 20)}px`;
      }
    };
    const soon = () => { if (!raf) raf = requestAnimationFrame(run); };
    const mo = new MutationObserver(soon);
    mo.observe(c, { childList: true, subtree: true });
    const ro = new ResizeObserver(soon);
    ro.observe(c);
    window.addEventListener('resize', soon);
    run();
    return () => { mo.disconnect(); ro.disconnect(); window.removeEventListener('resize', soon); if (raf) cancelAnimationFrame(raf); };
  }, [ref, route]);
}
