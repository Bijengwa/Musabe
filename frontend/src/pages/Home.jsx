import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { useAuth } from '../auth/AuthContext';
import { useSchools, useScope } from '../layout/scope';
import { ADMIN_ROLES, ROLE_LABELS } from '../nav';
import { CopyBox, Empty, Icon, Kpi, Modal, PageSkeleton, Panel, SkeletonTable, SchoolPill, fmtWhen } from '../components/ui';
import { AcademicHome, AccountantHome, BursarHome, CashierHome, DirectorHome, FinanceHome, HeadHome, LibrarianHome, ManagerHome, MapokeziHome, SchoolAdminHome, SuperHome, ToDo, useDashboard, StoreHome } from './home/RoleHomes';

const SCHOOL_ROLES = ['sadmin', 'head', 'second', 'acad', 'teacher', 'bursar', 'librarian', 'sstore'];

function greeting(name) {
  const h = new Date().getHours();
  const first = name.replace(/^(mr|mrs|ms|dr)\.?\s+/i, '').split(' ')[0];
  return `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${first}`;
}

// Each role has its own home page (see ./home/RoleHomes.jsx). Super Admin and School Admin also get the accounts part.
const HOMES = { super: SuperHome, director: DirectorHome, adirector: DirectorHome, manager: ManagerHome, fm: FinanceHome, afm: FinanceHome,
  acc: AccountantHome, aacc: AccountantHome, sadmin: SchoolAdminHome, head: HeadHome, bursar: BursarHome, librarian: LibrarianHome, storekeeper: StoreHome, amanager: StoreHome,
  mapokezi: MapokeziHome, cashier: CashierHome };

export default function Home() {
  const { user, can } = useAuth();
  const { d, error, reload } = useDashboard();
  const Role = HOMES[user.role] || AcademicHome;
  const isAccountAdmin = (user.role === 'super' || user.role === 'sadmin') && can('staff', 'f');
  return (
    <>
      <div className="ph1"><div className="t"><h1>{greeting(user.fullName)}</h1>
        <p>{user.roleLabel}{user.school ? ` · ${user.school.name}` : ' · Administration (all schools)'} · {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div></div>
      {error && !d ? (
        <div className="warnnote" role="alert"><Icon name="alert" /><span><b>The home page could not load.</b> {error}{' '}
          <button className="linkbtn" onClick={reload}>Try again</button></span></div>
      ) : !d ? <PageSkeleton kpis /> : <><ToDo items={d.todo} /><Role d={d} /></>}
      {isAccountAdmin && <><h2 className="sectionh">Staff accounts</h2><AccountsHome /></>}
    </>
  );
}

function AccountsHome() {
  const { user } = useAuth();
  const schools = useSchools();
  const [scope] = useScope();
  const [users, setUsers] = useState(null);
  const [audit, setAudit] = useState([]);
  const [creds, setCreds] = useState(null);

  const load = () => {
    const p = user.role === 'super' && scope ? `?school=${scope}` : '';
    api.get(`/users${p}`).then((d) => setUsers(d.users)).catch(() => setUsers([]));
    api.get(`/audit?limit=8${user.role === 'super' && scope ? `&school=${scope}` : ''}`).then((d) => setAudit(d.entries)).catch(() => {});
  };
  useEffect(load, [scope, user.role]);
  useLive(['user', 'auth', 'audit'], load);

  if (!users) return <SkeletonTable rows={5} columns={5} />;
  const active = users.filter((u) => u.active);
  const requests = users.filter((u) => u.resetRequested && u.active && u.canManage);
  const neverIn = active.filter((u) => u.tempPassword);
  const mySchools = user.role === 'super' ? schools.filter((s) => !scope || String(s.id) === scope) : schools.filter((s) => s.id === user.school.id);

  const giveTemp = async (u) => {
    const r = await api.post(`/users/${u.id}/reset-password`);
    setCreds({ name: u.fullName, username: r.username, password: r.tempPassword });
    load();
  };

  return (
    <>
      <div className="kpis">
        <Kpi label="Active accounts" value={active.length} sub={`${users.length - active.length} switched off`} tone="hi" />
        <Kpi label="Password requests" value={requests.length} sub={requests.length ? 'Waiting for you' : 'None waiting'} tone={requests.length ? 'warn' : ''} />
        <Kpi label="Not signed in yet" value={neverIn.length} sub="Still on a temporary password" />
        <Kpi label={user.role === 'super' ? 'Schools' : 'Your school'} value={user.role === 'super' ? schools.length : user.school.shortName} />
      </div>

      {requests.length > 0 && (
        <Panel title="Password reset requests" sub="Staff who forgot their password" flush>
          <div className="list">{requests.map((u) => (
            <div className="li" key={u.id}><div className="grow"><b>{u.fullName}</b><span>{u.roleLabel}{u.schoolShort ? ` · ${u.schoolShort}` : ''} · @{u.username} · asked {fmtWhen(u.resetRequestedAt)}</span></div>
              <button className="btn sm p" onClick={() => giveTemp(u)}>Give temporary password</button></div>
          ))}</div>
        </Panel>
      )}

      <div className="g-wide">
        <Panel title="Accounts by school" flush right={<Link className="btn sm" to="/staff">Manage accounts</Link>}>
          <div className="tw"><table>
            <thead><tr><th>School</th>{SCHOOL_ROLES.map((r) => <th key={r} className="n">{ROLE_LABELS[r].replace('Subject ', '')}</th>)}</tr></thead>
            <tbody>{mySchools.map((s) => (
              <tr key={s.id}><td><SchoolPill code={s.code} name={s.shortName} /></td>
                {SCHOOL_ROLES.map((r) => { const n = active.filter((u) => u.schoolId === s.id && u.role === r).length;
                  return <td key={r} className="n">{n || <span className="pill bad">0</span>}</td>; })}</tr>
            ))}</tbody>
          </table></div>
        </Panel>
        {user.role === 'super' && !scope && (
          <Panel title="Administration accounts" flush>
            <div className="list">{ADMIN_ROLES.map((r) => { const us = active.filter((u) => u.role === r);
              return <div className="li" key={r}><div className="grow"><b>{ROLE_LABELS[r]}</b><span>{us.map((u) => u.fullName).join(', ') || 'Not created yet'}</span></div>
                {us.length ? <span className="pill ok">Set</span> : <span className="pill bad">Missing</span>}</div>; })}</div>
          </Panel>
        )}
      </div>

      <Panel title="Recent activity" flush right={<Link className="btn sm" to="/audit">Full audit log</Link>}>
        {audit.length ? <div className="list">{audit.map((a) => (
          <div className="li" key={a.id}><div className="grow"><b className="fw5">{a.summary}</b><span>{a.by || 'System'}{a.byRole ? ` · ${a.byRole}` : ''} · {fmtWhen(a.at)}</span></div>
            {a.schoolShort && <span className="pill">{a.schoolShort}</span>}</div>
        ))}</div> : <Empty>No activity yet.</Empty>}
      </Panel>

      {creds && (
        <Modal title="Temporary password" onClose={() => setCreds(null)} footer={<button className="btn p" onClick={() => setCreds(null)}>Done</button>}>
          <p>Give these to <b>{creds.name}</b> in person. They must choose their own password when they sign in.</p>
          <CopyBox label="Username" value={creds.username} />
          <CopyBox label="Temporary password" value={creds.password} />
        </Modal>
      )}
    </>
  );
}
