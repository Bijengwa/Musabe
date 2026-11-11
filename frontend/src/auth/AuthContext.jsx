import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { applyPrefs } from '../prefs';
import { Icon, Modal, useToast } from '../components/ui';
import { connectLive, disconnectLive, useLive } from '../live';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  // state: undefined = still checking, null = signed out, object = signed in
  const [me, setMe] = useState(undefined);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try { setMe(await api.get('/auth/me')); } catch { setMe(null); }
  }, []);

  useEffect(() => {
    let alive = true;
    api.get('/auth/me').then((d) => alive && setMe(d)).catch(() => alive && setMe(null));
    const out = () => setMe(null);
    window.addEventListener('musabe:signed-out', out);
    return () => { alive = false; window.removeEventListener('musabe:signed-out', out); };
  }, []);

  // Live updates while signed in (not on the "choose your password" page).
  const toast = useToast();
  const liveUser = me?.user && !me.user.mustChangePassword ? me.user.id : null;
  useEffect(() => {
    if (!liveUser) return undefined;
    connectLive({
      onSignedOut: () => { setMe(null); navigate('/', { replace: true }); toast('You were signed out. Your account was changed or signed out from another device.'); },
      onRefused: () => refresh(),
    });
    return () => disconnectLive();
  }, [liveUser, navigate, refresh, toast]);
  // My own details or look changed (on another device, or by the administrator): reload them.
  useLive(['me'], refresh);

  // Use the person's saved look as soon as we know who they are.
  useEffect(() => { if (me?.user) applyPrefs(me.user.preferences); }, [me]);

  // Save a look setting (theme / text size). It shows at once, then is stored on the server.
  const savePrefs = async (change) => {
    const next = { ...(me?.user?.preferences || {}), ...change };
    applyPrefs(next);
    const r = await api.put('/me/preferences', change);
    setMe((m) => (m ? { ...m, user: { ...m.user, preferences: r.preferences } } : m));
  };

  const login = async (username, password, remember) => {
    await api.post('/auth/login', { username, password, remember });
    navigate('/', { replace: true }); // every sign-in starts at Home
    await refresh();
  };
  // Every "Sign out" button asks first, so nobody is signed out by a wrong tap.
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const askLogout = () => setAsking(true);
  const confirmLogout = async () => {
    setLeaving(true);
    try { await logout(); } finally { setLeaving(false); setAsking(false); }
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } finally { setMe(null); navigate('/', { replace: true }); }
  };

  // can('staff') -> may see; can('staff', 'f') -> may change
  const can = (page, level = 'v') => {
    const a = me?.pages?.[page];
    return !!a && (level === 'v' || a === 'f');
  };

  return <AuthCtx.Provider value={{ me, user: me?.user, refresh, login, logout, askLogout, can, savePrefs }}>
      {children}
      {asking && (
        <Modal title="Sign out?" onClose={() => !leaving && setAsking(false)} footer={<>
          <button className="btn" onClick={() => setAsking(false)} disabled={leaving}>Cancel</button>
          <button className="btn danger-bg" onClick={confirmLogout} disabled={leaving} autoFocus><Icon name="logout" /> {leaving ? 'Signing out…' : 'Yes, sign out'}</button>
        </>}>
          <p>Are you sure you want to sign out{me?.user ? `, ${me.user.fullName}` : ''}? You will need your username and password to come back in.</p>
        </Modal>
      )}
    </AuthCtx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthCtx);
