// Live updates from the server (see backend/src/realtime.js).
// One connection per open tab. Screens say which areas they show, e.g. useLive(['user'], load),
// and their load() runs again whenever someone changes something in that area.
import { useEffect, useRef, useSyncExternalStore } from 'react';

const subs = new Set();          // { topics, fire }
const statusSubs = new Set();
let es = null;
let status = 'off';              // off | connecting | live | lost
let handlers = {};

function setStatus(s) { status = s; statusSubs.forEach((f) => f(s)); }
const fireAll = () => subs.forEach((s) => s.fire());

export function connectLive(h) {
  handlers = h;
  if (es) return;
  setStatus('connecting');
  es = new EventSource('/api/events', { withCredentials: true });
  es.addEventListener('hello', () => {
    // After a dropped connection we may have missed changes, so every screen reloads once.
    if (status === 'lost') fireAll();
    setStatus('live');
  });
  es.addEventListener('change', (e) => {
    let topics = [];
    try { topics = JSON.parse(e.data).topics || []; } catch { return; }
    subs.forEach((s) => { if (s.topics.some((t) => topics.includes(t))) s.fire(); });
  });
  es.addEventListener('signout', () => { disconnectLive(); handlers.onSignedOut?.(); });
  es.onerror = () => {
    if (status !== 'off') setStatus('lost');
    // The server refused (e.g. session ended while offline): let the app check who is signed in.
    if (es && es.readyState === EventSource.CLOSED) { disconnectLive(); handlers.onRefused?.(); }
  };
}

export function disconnectLive() {
  if (es) { es.close(); es = null; }
  setStatus('off');
}

// Run `reload` when any of `topics` changes. Several changes close together cause one reload.
export function useLive(topics, reload) {
  const fn = useRef(reload);
  useEffect(() => { fn.current = reload; });
  const key = topics.join(',');
  useEffect(() => {
    let t;
    const s = { topics: key.split(','), fire: () => { clearTimeout(t); t = setTimeout(() => fn.current(), 200); } };
    subs.add(s);
    return () => { subs.delete(s); clearTimeout(t); };
  }, [key]);
}

const watchStatus = (f) => { statusSubs.add(f); return () => statusSubs.delete(f); };
export const useLiveStatus = () => useSyncExternalStore(watchStatus, () => status);
