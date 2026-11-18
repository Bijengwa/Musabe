import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { useAuth } from '../auth/AuthContext';
import { FLAVORS, currentFlavor } from './flavors';
import './splash.css';

const MIN_MS = 1800; // always play the intro
const MAX_MS = 4000; // never keep someone waiting longer than this

// Animated opening screen for the Parents and Staff apps. Sits on top of the app while the session is checked.
export default function Splash() {
  const flavor = currentFlavor();
  const { me } = useAuth();
  const [minDone, setMinDone] = useState(false);
  const [maxDone, setMaxDone] = useState(false);
  const [gone, setGone] = useState(false);
  const ready = me !== undefined; // session check finished
  const leaving = minDone && (ready || maxDone);

  useEffect(() => {
    if (!flavor) return undefined;
    // Hand over from the still native splash to this animated one.
    if (Capacitor.isNativePlatform()) SplashScreen.hide({ fadeOutDuration: 150 }).catch(() => {});
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const a = setTimeout(() => setMinDone(true), reduce ? 600 : MIN_MS);
    const b = setTimeout(() => setMaxDone(true), MAX_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [flavor]);

  useEffect(() => {
    if (!leaving) return undefined;
    const t = setTimeout(() => setGone(true), 500);
    return () => clearTimeout(t);
  }, [leaving]);

  if (!flavor || gone) return null;
  const f = FLAVORS[flavor];
  return (
    <div className={`splash sp-${f.motion}${leaving ? ' out' : ''}`}
      style={{ '--s-from': f.from, '--s-to': f.to, '--s-acc': f.accent }} role="status" aria-label={`${f.name} is starting`}>
      <i className="orb o1" /><i className="orb o2" /><i className="orb o3" />
      <div className="crestwrap">
        <span className="ring r1" /><span className="ring r2" />
        <div className="glass"><img src="/musabe-logo.png" alt="" /><span className="sweep" /></div>
      </div>
      <h1 className="sname">{f.name}</h1>
      <p className="stag">{f.tagline}</p>
      <div className="sbar"><span /></div>
    </div>
  );
}
