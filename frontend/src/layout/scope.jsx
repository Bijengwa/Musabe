/* eslint-disable react-refresh/only-export-components */
// School list + the "All schools / one school" filter used by administration accounts.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api';
import { useLive } from '../live';

const Ctx = createContext(null);

export function ScopeProvider({ children }) {
  const [schools, setSchools] = useState([]);
  const [scope, setScopeState] = useState(() => { try { return localStorage.getItem('musabe-scope') || ''; } catch { return ''; } });
  const reloadSchools = useCallback(() => api.get('/schools').then((d) => setSchools(d.schools)).catch(() => {}), []);
  useEffect(() => { reloadSchools(); }, [reloadSchools]);
  useLive(['school', 'user'], reloadSchools); // names, staff counts, School Admins
  const setScope = (v) => { setScopeState(v); try { localStorage.setItem('musabe-scope', v); } catch { /* ignore */ } };
  return <Ctx.Provider value={{ schools, reloadSchools, scope, setScope }}>{children}</Ctx.Provider>;
}

export const useSchools = () => useContext(Ctx).schools;
export const useReloadSchools = () => useContext(Ctx).reloadSchools;
export const useScope = () => { const c = useContext(Ctx); return [c.scope, c.setScope]; };
