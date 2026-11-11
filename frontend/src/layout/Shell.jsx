import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { NAV, ALL_PAGES, MY_PAGES } from '../nav';
import { Avatar, Icon, SchoolPill } from '../components/ui';
import { useSchools, useScope } from './scope';
import { useLiveStatus } from '../live';
import Bell from './Bell';

const PHONE = 900;
const isPhone = () => window.innerWidth <= PHONE;
const readMini = () => { try { return localStorage.getItem('musabe-side-mini') === '1'; } catch { return false; } };

export default function Shell() {
  const { me, user } = useAuth();
  const { pathname } = useLocation();
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

  const current = [...MY_PAGES, ...ALL_PAGES].find((p) => (p.path === '/' ? pathname === '/' : pathname.startsWith(p.path)));
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
        <nav className="sidenav">
        {NAV.map((g) => {
          const items = g.items.filter((i) => me.pages[i.key]);
          if (!items.length) return null;
          return (
            <div className="navg" key={g.group || 'main'}>
              {g.group && <h4>{g.group}</h4>}
              {items.map((i) => (
                <NavLink key={i.key} to={i.path} end={i.path === '/'} title={i.label} onClick={() => setOpen(false)} className={({ isActive }) => `nav${isActive ? ' on' : ''}`}>
                  <Icon name={i.icon} /><span>{i.label}</span>
                  {me.pages[i.key] === 'v' && <span className="vo">view</span>}
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
        <main className="content"><Outlet /></main>
      </div>
    </div>
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
