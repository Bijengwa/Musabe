import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { ALL_PAGES } from './nav';
import Shell from './layout/Shell';
import { ScopeProvider } from './layout/scope';
import Login from './pages/Login';
import Verify from './pages/Verify';
import ChangePassword from './pages/ChangePassword';
import Home from './pages/Home';
import Staff from './pages/Staff';
import Schools from './pages/Schools';
import Audit from './pages/Audit';
import Items from './pages/Items';
import Sell from './pages/Sell';
import Receipts from './pages/Receipts';
import Give from './pages/Give';
import Students from './pages/Students';
import Stock from './pages/Stock';
import SendStock from './pages/SendStock';
import Incoming from './pages/Incoming';
import Requests from './pages/Requests';
import Damage from './pages/Damage';
import Payments from './pages/Payments';
import Bills from './pages/Bills';
import Money from './pages/Money';
import SalesDashboard from './pages/SalesDashboard';
import Reports from './pages/Reports';
import Issue from './pages/Issue';
import Labels from './pages/Labels';
import Purchases from './pages/Purchases';
import Store from './pages/Store';
import Counts from './pages/Counts';
import Requisitions from './pages/Requisitions';
import Orders from './pages/Orders';
import StoreBooks from './pages/StoreBooks';
import Interviews from './pages/Interviews';
import Suppliers from './pages/Suppliers';
import Lpo from './pages/Lpo';
import Contracts from './pages/Contracts';
import Vehicles from './pages/Vehicles';
import ComingSoon from './pages/ComingSoon';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import Splash from './splash/Splash';

const SCREENS = { home: Home, staff: Staff, schools: Schools, audit: Audit, items: Items, sell: Sell, receipts: Receipts, give: Give, students: Students,
  stock: Stock, stockin: SendStock, incoming: Incoming, requests: Requests, damage: Damage, payments: Payments, bills: Bills, money: Money, salesdash: SalesDashboard, reports: Reports,
  issue: Issue, labels: Labels, purchases: Purchases, useitems: Store, counts: Counts, requisitions: Requisitions, orders: Orders, books: StoreBooks, interviews: Interviews, suppliers: Suppliers, lpo: Lpo, contracts: Contracts, vehicles: Vehicles };

export default function App() {
  return <><Splash /><Routed /></>;
}

function Routed() {
  const { me } = useAuth();
  // The QR on a paper opens this without signing in.
  if (window.location.pathname.startsWith('/verify/')) return <Routes><Route path="verify/:type/:id" element={<Verify />} /></Routes>;
  if (me === undefined) return <div className="boot"><img className="logo lg" src="/musabe-logo.png" alt="Musabe Schools" /></div>;
  if (!me) return <Login />;
  if (me.user.mustChangePassword) return <ChangePassword />;

  // Only pages this role may see get a route. Anything else goes back to Home.
  const pages = ALL_PAGES.filter((p) => !p.sub && me.pages[p.key]); // "sub" items live inside their page's own routes
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
