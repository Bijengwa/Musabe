/* eslint-disable react-refresh/only-export-components */
// The bell in the top bar: live notifications with a sound.
// What each person is told about is decided on the server (backend/src/lib/activity.js).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { Empty, Icon, fmtWhen, useToast } from '../components/ui';

// ---- sound: a short two-note chime made in the browser (no sound file needed) ----
let ctx = null;
function audio() {
  try { ctx ||= new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
// Browsers only allow sound after the person has clicked or tapped once.
if (typeof window !== 'undefined') {
  const unlock = () => { audio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}
export function chime() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  [[880, 0], [1318.5, 0.13]].forEach(([f, d]) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.45);
    o.connect(g).connect(a.destination);
    o.start(t + d); o.stop(t + d + 0.5);
  });
}

const ICON = { library: 'box', accounts: 'key', schools: 'building', academic: 'book', other: 'list' };

export default function Bell() {
  const { user, can } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const last = useRef(null); // newest notification id we have already announced

  // New list from the server: announce the newest one if it is new (sound, toast, pop-up).
  const handle = useCallback((d) => {
    setData(d);
    const newest = d.items[0];
    if (last.current !== null && newest && newest.id !== last.current && newest.unread) {
      if (user.preferences?.sound !== false) chime();
      toast(newest.summary);
      if (document.hidden && window.Notification?.permission === 'granted') {
        try { new window.Notification('Musabe Schools', { body: newest.summary, icon: '/musabe-logo.png', tag: 'musabe' }); } catch { /* not allowed */ }
      }
    }
    last.current = newest ? newest.id : 0;
  }, [toast, user.preferences?.sound]);
  const load = useCallback(() => api.get('/notifications').then(handle).catch(() => {}), [handle]);

  useEffect(() => { load(); }, [load]);
  useLive(['audit', 'item'], load);

  // Number of unread in the browser tab title, e.g. "(3) Musabe Schools"
  useEffect(() => {
    document.title = data?.unread ? `(${data.unread}) Musabe Schools` : 'Musabe Schools System';
  }, [data?.unread]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && data?.unread) {
      api.post('/notifications/seen').catch(() => {});
      setData((d) => d && { ...d, unread: 0 });
    }
  };

  const n = data?.unread || 0;
  return (
    <div className="bell" ref={box}>
      <button className="bbtn" onClick={toggle} aria-label={n ? `${n} new notifications` : 'Notifications'} aria-expanded={open}>
        <Icon name="bell" />{n > 0 && <span className="bcount">{n > 99 ? '99+' : n}</span>}
      </button>
      {open && (
        <div className="bdrop" role="dialog" aria-label="Notifications">
          <div className="bhead"><b>Notifications</b>
            <Link to="/settings#notifications" onClick={() => setOpen(false)} title="Notification settings"><Icon name="gear" /></Link>
          </div>
          {!data ? <Empty>Loading…</Empty> : !data.items.length ? <Empty>Nothing yet. New activity will show here.</Empty> : (
            <div className="blist">
              {data.items.map((i) => (
                <div key={i.id} className={`bi${i.unread ? ' new' : ''}`}>
                  <span className={`gic g-${i.group}`}><Icon name={ICON[i.group] || 'list'} /></span>
                  <div className="grow"><b>{i.summary}</b><span>{i.by || 'System'}{i.byRole ? ` · ${i.byRole}` : ''}{i.school ? ` · ${i.school}` : ''} · {fmtWhen(i.at)}</span></div>
                </div>
              ))}
            </div>
          )}
          {can('audit') && <Link className="ball" to="/audit" onClick={() => setOpen(false)}>See all activity</Link>}
        </div>
      )}
    </div>
  );
}
