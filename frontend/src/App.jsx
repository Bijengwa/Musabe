import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { ALL_PAGES } from './nav';
import Shell from './layout/Shell';
import { ScopeProvider } from './layout/scope';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Home from './pages/Home';
import Staff from './pages/Staff';
import Schools from './pages/Schools';
import Audit from './pages/Audit';
import Items from './pages/Items';
import ComingSoon from './pages/ComingSoon';
import Profile from './pages/Profile';
import Settings from './pages/Settings';

const SCREENS = { home: Home, staff: Staff, schools: Schools, audit: Audit, items: Items };

export default function App() {
  const { me } = useAuth();
  if (me === undefined) return <div className="boot"><img className="logo lg" src="/musabe-logo.png" alt="Musabe Schools" /></div>;
  if (!me) return <Login />;
  if (me.user.mustChangePassword) return <ChangePassword />;

  // Only pages this role may see get a route. Anything else goes back to Home.
  const pages = ALL_PAGES.filter((p) => me.pages[p.key]);
  return (
    <ScopeProvider>
      <Routes>
        <Route element={<Shell />}>
          {pages.map((p) => {
            const Screen = SCREENS[p.key];
            const el = Screen ? <Screen /> : <ComingSoon page={p} />;
            return p.path === '/' ? <Route key={p.key} index element={el} /> : <Route key={p.key} path={`${p.path.slice(1)}/*`} element={el} />;
          })}
          {/* Every role has these two. */}
          <Route path="profile" element={<Profile />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ScopeProvider>
  );
}
