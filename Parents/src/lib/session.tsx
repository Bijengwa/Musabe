// Who is signed in, and the app language. Shared by every screen.
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, loadToken, saveToken, setApiLang, setSignedOutHandler, type Parent } from './api';
import { translate, type Key, type Lang } from './i18n';

type Session = {
  ready: boolean;
  signedIn: boolean;
  parent: Parent | null;
  lang: Lang;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  setLang: (l: Lang) => Promise<void>;
  signedInWith: (token: string, parent: Parent) => Promise<void>;
  setParent: (p: Parent) => void;
  signOut: () => Promise<void>;
};

const Ctx = createContext<Session | null>(null);
const LANG = 'musabe_parent_lang';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [parent, setParent] = useState<Parent | null>(null);
  const [lang, setLangState] = useState<Lang>('sw');

  useEffect(() => {
    (async () => {
      let l: Lang = 'sw';
      try { const v = await SecureStore.getItemAsync(LANG); if (v === 'en' || v === 'sw') l = v; } catch { /* default */ }
      setLangState(l); setApiLang(l);
      setSignedIn(!!(await loadToken()));
      setReady(true);
    })();
  }, []);

  // The server said the sign-in is no longer valid: back to the sign-in screen.
  useEffect(() => {
    setSignedOutHandler(() => { setSignedIn(false); setParent(null); router.replace('/login'); });
    return () => setSignedOutHandler(null);
  }, []);

  const setLang = useCallback(async (l: Lang) => {
    setLangState(l); setApiLang(l);
    try { await SecureStore.setItemAsync(LANG, l); } catch { /* this session only */ }
    if (signedIn) api('PATCH', '/me', { locale: l }).catch(() => {});
  }, [signedIn]);

  const signedInWith = useCallback(async (token: string, p: Parent) => {
    await saveToken(token);
    setParent(p); setSignedIn(true);
  }, []);

  const signOut = useCallback(async () => {
    await api('POST', '/auth/logout').catch(() => {});
    await saveToken(null);
    setParent(null); setSignedIn(false);
    router.replace('/login');
  }, []);

  const t = useCallback((key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
  const value = useMemo(() => ({ ready, signedIn, parent, lang, t, setLang, signedInWith, setParent, signOut }),
    [ready, signedIn, parent, lang, t, setLang, signedInWith, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
