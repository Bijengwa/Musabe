import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useLive } from '../live';
import { useAuth } from '../auth/AuthContext';
import { useSchools, useScope } from '../layout/scope';
import { ADMIN_ROLES, ROLE_LABELS } from '../nav';
import { CopyBox, Empty, ErrorNote, Icon, Modal, PageHead, Panel, PhoneInput, SchoolPill, cleanPhone, fmtPhone, fmtWhen, phoneProblem, useToast } from '../components/ui';

export default function Staff() {
  const { user, me, can } = useAuth();
  const schools = useSchools();
  const [scope] = useScope();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null); // { kind, user?, data? }

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (user.scope === 'all' && scope) p.set('school', scope);
    if (role) p.set('role', role);
    if (status) p.set('status', status);
    if (q.trim()) p.set('q', q.trim());
    try { setRows((await api.get(`/users?${p}`)).users); setError(''); } catch (e) { setError(e.message); }
  }, [user.scope, scope, role, status, q]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useLive(['user', 'auth'], load);

  const schoolOf = (id) => schools.find((s) => s.id === id);
  const canCreate = can('staff', 'f') && me.canCreate.length > 0;
  const roleOptions = useMemo(() => Object.entries(ROLE_LABELS).filter(([k]) => user.scope === 'all' || !ADMIN_ROLES.includes(k)), [user.scope]);

  const sub = user.role === 'super'
    ? 'You create administration accounts and School Admins. School Admins create the staff of their own school.'
    : user.role === 'sadmin'
      ? `Create accounts for the staff of ${user.school.name}. Each person sees only their own work.`
      : 'Staff accounts you are allowed to see.';

  const toggle = async (u) => {
    try {
      await api.patch(`/users/${u.id}`, { active: !u.active });
      toast(u.active ? `${u.fullName} is switched off and signed out` : `${u.fullName} is switched on`);
      setModal(null); load();
    } catch (e) { toast(e.message); }
  };
  const reset = async (u) => {
    try {
      const r = await api.post(`/users/${u.id}/reset-password`);
      setModal({ kind: 'creds', data: { fullName: u.fullName, username: r.username, password: r.tempPassword, reset: true } });
      load();
    } catch (e) { toast(e.message); }
  };

  return (
    <>
      <PageHead title="Staff accounts" sub={sub}>
        {canCreate ? <button className="btn p" onClick={() => setModal({ kind: 'new' })}><Icon name="plus" /> New account</button>
          : <span className="pill"><Icon name="eye" /> View only</span>}
      </PageHead>

      <div className="filters">
        <div className="seg">
          {[['', 'All'], ['reset', 'Asked for password'], ['off', 'Switched off']].map(([k, t]) => (
            <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t}</button>
          ))}
        </div>
        <select id="f-role" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          {roleOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <div className="searchbox"><Icon name="search" /><input id="f-q" placeholder="Search name or username" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {rows && <span className="muted small">{rows.length} accounts</span>}
      </div>

      <ErrorNote error={error} />
      <Panel flush>
        {!rows ? <Empty>Loading…</Empty> : !rows.length ? <Empty>No accounts match.</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th>Name</th><th>Role</th><th>Place</th><th>Username</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((u) => {
              const s = schoolOf(u.schoolId);
              return (
                <tr key={u.id}>
                  <td data-l="Name"><b>{u.fullName}</b>{u.phone && <div className="small muted">{fmtPhone(u.phone)}</div>}</td>
                  <td data-l="Role">{u.roleLabel}</td>
                  <td data-l="Place"><SchoolPill code={s?.code} name={s?.shortName || u.schoolShort} /></td>
                  <td data-l="Username" className="muted">@{u.username}</td>
                  <td data-l="Last sign-in" className="small">{fmtWhen(u.lastLoginAt)}</td>
                  <td data-l="Status">{!u.active ? <span className="pill bad">Off</span>
                    : u.resetRequested ? <span className="pill warn">Asked for password</span>
                      : u.tempPassword ? <span className="pill info">Temporary password</span>
                        : <span className="pill ok">Active</span>}</td>
                  <td className="acts-cell">{u.canManage && (
                    <div className="row nowrap">
                      <button className="btn sm" onClick={() => setModal({ kind: 'edit', user: u })}><Icon name="edit" /> Edit</button>
                      <button className={`btn sm${u.resetRequested ? ' p' : ''}`} onClick={() => setModal({ kind: 'reset', user: u })}>Reset password</button>
                      <button className={`btn sm${u.active ? ' danger' : ''}`} onClick={() => (u.active ? setModal({ kind: 'off', user: u }) : toggle(u))}>{u.active ? 'Switch off' : 'Switch on'}</button>
                    </div>
                  )}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Panel>

      {modal?.kind === 'new' && <NewAccount onClose={() => setModal(null)} onDone={(d) => { setModal({ kind: 'creds', data: d }); load(); }} />}
      {modal?.kind === 'edit' && <EditAccount u={modal.user} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); toast('Saved'); }} />}
      {modal?.kind === 'off' && (
        <Modal title="Switch off this account?" onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn p danger-bg" onClick={() => toggle(modal.user)}>Switch off</button></>}>
          <p><b>{modal.user.fullName}</b> ({modal.user.roleLabel}) will be signed out on every device and cannot sign in until the account is switched on again. Their records stay in the system.</p>
        </Modal>
      )}
      {modal?.kind === 'reset' && (
        <Modal title="Give a temporary password?" onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn p" onClick={() => reset(modal.user)}>Give temporary password</button></>}>
          <p><b>{modal.user.fullName}</b> will be signed out everywhere. You will see a temporary password to hand over in person. They must choose their own password when they sign in.</p>
        </Modal>
      )}
      {modal?.kind === 'creds' && (
        <Modal title={modal.data.reset ? 'Temporary password' : 'Account created'} onClose={() => setModal(null)}
          footer={<button className="btn p" onClick={() => setModal(null)}>Done</button>}>
          <p>Give these to <b>{modal.data.fullName}</b> in person. The password is shown only now. They will choose their own password the first time they sign in.</p>
          <CopyBox label="Username" value={modal.data.username} />
          <CopyBox label="Temporary password" value={modal.data.password} />
          <p className="small muted">The system never sends passwords by SMS or email.</p>
        </Modal>
      )}
    </>
  );
}

function NewAccount({ onClose, onDone }) {
  const { user, me } = useAuth();
  const schools = useSchools();
  const [scope] = useScope();
  const allowed = me.canCreate;
  const [f, setF] = useState({ fullName: '', role: allowed[0], schoolId: user.role === 'super' ? scope : '', phone: '', username: '' });
  const [touchedUser, setTouchedUser] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const adminRole = ADMIN_ROLES.includes(f.role);

  const suggest = async () => {
    if (touchedUser || f.fullName.trim().length < 4) return;
    try { const r = await api.get(`/users/suggest-username?name=${encodeURIComponent(f.fullName)}`); setF((x) => ({ ...x, username: r.username })); } catch { /* ignore */ }
  };

  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (phoneProblem(f.phone)) return setError(`Phone: ${phoneProblem(f.phone)}`);
    setBusy(true);
    try {
      const body = { fullName: f.fullName, role: f.role, phone: f.phone, username: f.username };
      if (user.role === 'super' && !adminRole) body.schoolId = f.schoolId;
      const r = await api.post('/users', body);
      onDone({ fullName: r.user.fullName, username: r.user.username, password: r.tempPassword });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const adminOpts = allowed.filter((r) => ADMIN_ROLES.includes(r));
  const schoolOpts = allowed.filter((r) => !ADMIN_ROLES.includes(r));
  return (
    <Modal title="New account" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" form="newacc" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button></>}>
      <form id="newacc" className="stack" onSubmit={submit}>
        <label>Full name<input id="n-name" value={f.fullName} onChange={set('fullName')} onBlur={suggest} placeholder="e.g. Mr. Peter Mwakalinga" required autoFocus /></label>
        <div className="fg">
          <label>Role<select id="n-role" value={f.role} onChange={set('role')}>
            {adminOpts.length > 0 && <optgroup label="Administration (all schools)">{adminOpts.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</optgroup>}
            {schoolOpts.length > 0 && <optgroup label="One school">{schoolOpts.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</optgroup>}
          </select></label>
          {user.role === 'super' ? (
            <label>School<select id="n-school" value={adminRole ? '' : f.schoolId} onChange={set('schoolId')} disabled={adminRole} required={!adminRole}>
              <option value="">{adminRole ? 'Administration (no school)' : 'Choose a school'}</option>
              {!adminRole && schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          ) : (
            <label>School<input value={user.school?.name || ''} disabled /></label>
          )}
        </div>
        <div className="fg">
          <label>Username<input id="n-user" value={f.username} onChange={(e) => { setTouchedUser(true); set('username')(e); }} placeholder="Made from the name" autoCapitalize="none" /></label>
          <label>Phone (optional)<PhoneInput id="n-phone" value={f.phone} onChange={(v) => setF((x) => ({ ...x, phone: v }))} /></label>
        </div>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function EditAccount({ u, onClose, onDone }) {
  const [f, setF] = useState({ fullName: u.fullName, username: u.username, phone: cleanPhone(u.phone) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (phoneProblem(f.phone)) return setError(`Phone: ${phoneProblem(f.phone)}`);
    setBusy(true);
    try { await api.patch(`/users/${u.id}`, f); onDone(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Edit ${u.fullName}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" form="editacc" disabled={busy}>Save</button></>}>
      <form id="editacc" className="stack" onSubmit={submit}>
        <label>Full name<input id="e-name" value={f.fullName} onChange={set('fullName')} required /></label>
        <div className="fg">
          <label>Username<input id="e-user" value={f.username} onChange={set('username')} autoCapitalize="none" /></label>
          <label>Phone<PhoneInput id="e-phone" value={f.phone} onChange={(v) => setF((x) => ({ ...x, phone: v }))} /></label>
        </div>
        <p className="small muted">Role: {u.roleLabel}{u.schoolShort ? ` · ${u.schoolShort}` : ''}. To change someone's role, switch this account off and create a new one, so the history stays clear.</p>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
