import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { ALL_PAGES } from './nav';
import Shell from './layout/Shell';
import { ScopeProvider } from './layout/scope';
import Login from './pages/Login';
import Verify from './pages/Verify';
import ChangePassword from './pages/ChangePassword';
const Home = lazy(() => import('./pages/Home'));
const Staff = lazy(() => import('./pages/Staff'));
const Schools = lazy(() => import('./pages/Schools'));
const Audit = lazy(() => import('./pages/Audit'));
const Items = lazy(() => import('./pages/Items'));
const Sell = lazy(() => import('./pages/Sell'));
const Receipts = lazy(() => import('./pages/Receipts'));
const Give = lazy(() => import('./pages/Give'));
const Students = lazy(() => import('./pages/Students'));
const Stock = lazy(() => import('./pages/Stock'));
const SendStock = lazy(() => import('./pages/SendStock'));
const Incoming = lazy(() => import('./pages/Incoming'));
const Requests = lazy(() => import('./pages/Requests'));
const Damage = lazy(() => import('./pages/Damage'));
const Payments = lazy(() => import('./pages/Payments'));
const Bills = lazy(() => import('./pages/Bills'));
const Money = lazy(() => import('./pages/Money'));
const SalesDashboard = lazy(() => import('./pages/SalesDashboard'));
const Reports = lazy(() => import('./pages/Reports'));
const Issue = lazy(() => import('./pages/Issue'));
const Labels = lazy(() => import('./pages/Labels'));
const Purchases = lazy(() => import('./pages/Purchases'));
const Store = lazy(() => import('./pages/Store'));
const Counts = lazy(() => import('./pages/Counts'));
const Requisitions = lazy(() => import('./pages/Requisitions'));
const Orders = lazy(() => import('./pages/Orders'));
const StoreBooks = lazy(() => import('./pages/StoreBooks'));
const Interviews = lazy(() => import('./pages/Interviews'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Lpo = lazy(() => import('./pages/Lpo'));
const Contracts = lazy(() => import('./pages/Contracts'));
const Vehicles = lazy(() => import('./pages/Vehicles'));
const Academic = lazy(() => import('./pages/Academic'));
import ComingSoon from './pages/ComingSoon';
const Profile = lazy(() => import('./pages/Profile'));
const Settings = lazy(() => import('./pages/Settings'));
import Splash from './splash/Splash';

const SCREENS = { home: Home, staff: Staff, schools: Schools, audit: Audit, items: Items, sell: Sell, receipts: Receipts, give: Give, students: Students,
  stock: Stock, stockin: SendStock, incoming: Incoming, requests: Requests, damage: Damage, payments: Payments, bills: Bills, money: Money, salesdash: SalesDashboard, reports: Reports,
  issue: Issue, labels: Labels, purchases: Purchases, useitems: Store, counts: Counts, requisitions: Requisitions, orders: Orders, books: StoreBooks, interviews: Interviews, suppliers: Suppliers, lpo: Lpo, contracts: Contracts, vehicles: Vehicles, academics: Academic };

export default function App() {
  return <><Splash /><Routed /></>;
}

function PageLoader() {
  return <div className="page-loader"><span className="route-progress" /><div className="route-loader-brand"><span className="spinner spinner-lg" aria-label="Loading page" /></div></div>;
}

function RouteProgress() {
  const { pathname } = useLocation();
  return <span key={pathname} className="route-progress route-progress-active" aria-hidden="true" />;
}

function Routed() {
  const { me } = useAuth();
  // The QR on a paper opens this without signing in.
  if (window.location.pathname.startsWith('/verify/')) return <Routes><Route path="verify/:type/:id" element={<Verify />} /></Routes>;
  if (me === undefined) return <div className="boot boot-loading"><img className="logo lg boot-logo" src="/musabe-logo.png" alt="Musabe Schools" /><span className="boot-line"><i /></span><span className="boot-caption">Preparing your workspace…</span></div>;
  if (!me) return <Login />;
  if (me.user.mustChangePassword) return <ChangePassword />;

  // Only pages this role may see get a route. Anything else goes back to Home.
  const pages = ALL_PAGES.filter((p) => !p.sub && me.pages[p.key]); // "sub" items live inside their page's own routes
  return (
    <ScopeProvider>
      <RouteProgress />
      <Suspense fallback={<PageLoader />}>
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
      </Suspense>
    </ScopeProvider>
  );
}
