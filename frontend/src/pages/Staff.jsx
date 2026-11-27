import { IdCardPanel } from '../components/idcard';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useLive } from '../live';
import { useAuth } from '../auth/AuthContext';
import { useSchools, useScope } from '../layout/scope';
import { ADMIN_ROLES, ROLE_LABELS, roleLabelFor } from '../nav';
import { Pager, SortTh, useTable } from '../components/table';
import { CopyBox, Empty, ErrorNote, ExcelButton, Icon, Loading, Modal, PageHead, Panel, PhoneInput, SchoolPill, cleanPhone, fmtPhone, fmtWhen, phoneProblem, useToast } from '../components/ui';

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

  const t = useTable(rows, { pageSize: 25, getters: { name: (u) => u.fullName, role: (u) => u.roleLabel, seen: (u) => u.lastLoginAt || '', status: (u) => (!u.active ? 2 : u.resetRequested ? 1 : 0) } });
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
        <ExcelButton href={`/api/users/export.xlsx`} />
        {user.role === 'super' && <button className="btn" onClick={() => setModal({ kind: 'bulk' })}><Icon name="excel" /> Register from Excel</button>}
        {canCreate ? <button className="btn p" onClick={() => setModal({ kind: 'new' })}><Icon name="plus" /> New account</button>
          : <span className="pill"><Icon name="eye" /> View only</span>}
      </PageHead>

      <div className="filters">
        <div className="seg">
          {[['', 'All'], ['reset', 'Asked for password'], ['temp', 'Temporary password'], ['off', 'Switched off']].map(([k, t]) => (
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
        {!rows ? <Loading /> : !rows.length ? <Empty icon="users" title="No accounts match">Try a different role, status or search word.</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><SortTh t={t} k="name">Name</SortTh><SortTh t={t} k="role">Role</SortTh><th>Place</th><th>Username</th><SortTh t={t} k="seen">Last sign-in</SortTh><SortTh t={t} k="status">Status</SortTh><th /></tr></thead>
            <tbody>{t.rows.map((u) => {
              const s = schoolOf(u.schoolId);
              return (
                <tr key={u.id}>
                  <td data-l="Name"><b>{u.fullName}</b>{u.phone && <div className="small muted">{fmtPhone(u.phone)}</div>}</td>
                  <td data-l="Role">{u.roleLabel}{u.extraRoles?.length > 0 && <div className="small muted">also: {u.extraRoles.map((x) => x.label).join(', ')}</div>}</td>
                  <td data-l="Place"><SchoolPill code={s?.code} name={s?.shortName || u.schoolShort} /></td>
                  <td data-l="Username" className="muted">@{u.username}</td>
                  <td data-l="Last sign-in" className="small">{fmtWhen(u.lastLoginAt)}</td>
                  <td data-l="Status">{!u.active ? <span className="pill bad">Off</span>
                    : u.resetRequested ? <span className="pill warn">Asked for password</span>
                      : u.tempPassword ? <span className="pill info">Temporary password</span>
                        : <span className="pill ok">Active</span>}</td>
                  <td className="acts-cell">{(u.canManage || can('idcards')) && (
                    <div className="row nowrap">
                      {can('idcards') && <button className="btn sm" onClick={() => setModal({ kind: 'card', user: u })}><Icon name="tag" /> ID card</button>}
                      {u.canManage && <>
                      <button className="btn sm" onClick={() => setModal({ kind: 'edit', user: u })}><Icon name="edit" /> Edit</button>
                      <button className="btn sm" onClick={() => setModal({ kind: 'roles', user: u })}>Roles</button>
                      <button className={`btn sm${u.resetRequested ? ' p' : ''}`} onClick={() => setModal({ kind: 'reset', user: u })}>Reset password</button>
                      {u.resetRequested && <button className="btn sm danger" onClick={() => setModal({ kind: 'refuse', user: u })}>Refuse</button>}
                      <button className={`btn sm${u.active ? ' danger' : ''}`} onClick={() => (u.active ? setModal({ kind: 'off', user: u }) : toggle(u))}>{u.active ? 'Switch off' : 'Switch on'}</button>
                      </>}
                    </div>
                  )}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        {rows && <Pager t={t} />}
      </Panel>

      {modal?.kind === 'card' && <Modal wide title={`ID card · ${modal.user.fullName}`} onClose={() => setModal(null)} footer={<button className="btn" onClick={() => setModal(null)}>Close</button>}>
        <IdCardPanel kind="staff" id={modal.user.id} flush /></Modal>}
      {modal?.kind === 'roles' && <RolesBox u={modal.user} onClose={() => { setModal(null); load(); }} />}
      {modal?.kind === 'refuse' && <RefuseReset u={modal.user} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); toast('Request refused'); }} />}
      {modal?.kind === 'bulk' && <BulkStaff onClose={() => { setModal(null); load(); }} />}
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
          <p>Give these to <b>{modal.data.fullName}</b> in person. The password is shown only now. They will choose their own password the first time they sign in. It works for 3 days only; after that, give a new one.</p>
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
  const [f, setF] = useState({ fullName: '', role: allowed[0], gender: '', schoolId: user.role === 'super' ? scope : '', phone: '', username: '' });
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
    if (!f.gender) return setError('Choose male or female: it gives Mr. or Ms. and the name of the post.');
    if (phoneProblem(f.phone)) return setError(`Phone: ${phoneProblem(f.phone)}`);
    setBusy(true);
    try {
      const body = { fullName: f.fullName, role: f.role, gender: f.gender, phone: f.phone, username: f.username };
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
        <label>Full name<input id="n-name" value={f.fullName} onChange={set('fullName')} onBlur={suggest} placeholder="e.g. Peter Mwakalinga (Mr. or Ms. is added)" required autoFocus /></label>
        <div className="field"><span className="l">Gender</span>
          <div className="seg" role="radiogroup" aria-label="Gender">
            {[['m', 'Male (Mr.)'], ['f', 'Female (Ms.)']].map(([k, t]) => <button key={k} type="button" role="radio" aria-checked={f.gender === k} className={f.gender === k ? 'on' : ''} onClick={() => setF((x) => ({ ...x, gender: k }))}>{t}</button>)}
          </div></div>
        <div className="fg">
          <label>Role<select id="n-role" value={f.role} onChange={set('role')}>
            {adminOpts.length > 0 && <optgroup label="Administration (all schools)">{adminOpts.map((r) => <option key={r} value={r}>{roleLabelFor(r, f.gender)}</option>)}</optgroup>}
            {schoolOpts.length > 0 && <optgroup label="One school">{schoolOpts.map((r) => <option key={r} value={r}>{roleLabelFor(r, f.gender)}</option>)}</optgroup>}
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
  const [f, setF] = useState({ fullName: u.fullName, username: u.username, gender: u.gender || '', phone: cleanPhone(u.phone) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (phoneProblem(f.phone)) return setError(`Phone: ${phoneProblem(f.phone)}`);
    setBusy(true);
    try { await api.patch(`/users/${u.id}`, { ...f, gender: f.gender || undefined }); onDone(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Edit ${u.fullName}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" form="editacc" disabled={busy}>Save</button></>}>
      <form id="editacc" className="stack" onSubmit={submit}>
        <label>Full name<input id="e-name" value={f.fullName} onChange={set('fullName')} required /></label>
        <div className="field"><span className="l">Gender</span>
          <div className="seg" role="radiogroup" aria-label="Gender">
            {[['m', 'Male (Mr.)'], ['f', 'Female (Ms.)']].map(([k, t]) => <button key={k} type="button" role="radio" aria-checked={f.gender === k} className={f.gender === k ? 'on' : ''} onClick={() => setF((x) => ({ ...x, gender: k }))}>{t}</button>)}
          </div>
          {!u.gender && <span className="small muted">Not set yet. The name gets Mr. or Ms. and the post name follows (Head Master or Head Mistress).</span>}</div>
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

// One person, many roles (2026-11-20): the main role stays; extra roles are added or switched off here.
// The person chooses "Working as" in the menu. Some pairs are refused (one checks the other's money or goods).
function RolesBox({ u, onClose }) {
  const toast = useToast();
  const schools = useSchools();
  const [d, setD] = useState(null);
  const [role, setRole] = useState('');
  const [school, setSchool] = useState(u.schoolId ? String(u.schoolId) : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get(`/users/${u.id}/roles`).then(setD).catch((e) => setError(e.message)), [u.id]);
  useEffect(() => { load(); }, [load]);
  const pick = d?.canAdd.find((x) => x.role === role);
  const add = async () => {
    setBusy(true); setError('');
    try { await api.post(`/users/${u.id}/roles`, { role, schoolId: pick?.needsSchool ? Number(school) : null }); toast('Role added'); setRole(''); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const remove = async (x) => {
    setBusy(true); setError('');
    try { await api.post(`/users/${u.id}/roles/${x.id}/remove`, {}); toast('Role removed'); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Roles · ${u.fullName}`} onClose={onClose} footer={<button className="btn p" onClick={onClose}>Done</button>}>
      {!d ? <Loading /> : (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>One person keeps one account. Give extra roles here (for example a librarian who is also the School Store-keeper). They choose "Working as" in the menu; everything they do is written with the role they used.</p>
          <div><b>Main role:</b> {d.main.label}</div>
          {d.extra.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>{d.extra.map((x) => (
              <div key={x.id} className="row" style={{ alignItems: 'center' }}><span className="pill info">{x.label}{x.school ? ` · ${x.school}` : ''}</span><span className="grow" />
                <button className="btn sm danger" disabled={busy} onClick={() => remove(x)}>Remove</button></div>
            ))}</div>
          )}
          <div className="row" style={{ alignItems: 'end' }}>
            <label style={{ flex: 1 }}>Add a role<select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Choose…</option>{d.canAdd.filter((x) => x.role !== d.main.role && !d.extra.some((e) => e.role === x.role)).map((x) => <option key={x.role} value={x.role}>{x.label}</option>)}</select></label>
            {pick?.needsSchool && schools.length > 0 && <label>School<select value={school} onChange={(e) => setSchool(e.target.value)}><option value="">Choose…</option>{schools.map((sc) => <option key={sc.id} value={sc.id}>{sc.shortName}</option>)}</select></label>}
            <button className="btn p" disabled={busy || !role || (pick?.needsSchool && schools.length > 0 && !school)} onClick={add}>Add</button>
          </div>
          <ErrorNote error={error} />
        </div>
      )}
    </Modal>
  );
}

// Register many staff from one Excel file. The file is checked first; nothing is saved until the Super Admin presses Register.
function BulkStaff({ onClose }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [chk, setChk] = useState(null);
  const [done, setDone] = useState(null);
  const send = async (f, check) => {
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/users/bulk${check ? '?check=1' : ''}`, { method: 'POST', credentials: 'include', headers: { 'X-File-Name': encodeURIComponent(f.name).slice(0, 200) }, body: f });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'The file could not be read.');
      if (check) setChk(j); else setDone(j);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const pick = (f) => { setFile(f); setChk(null); setDone(null); if (f) send(f, true); };
  const csv = () => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['S/N', 'Full name', 'Phone', 'Role', 'School', 'Username', 'Temporary password'], ...done.created.map((c, i) => [i + 1, c.fullName, c.phone || '', c.role, c.school, c.username, c.tempPassword])].map((l) => l.map(q).join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv' }));
    a.download = 'musabe-new-staff-passwords.csv'; a.click();
  };
  return (
    <Modal wide title="Register staff from Excel" onClose={onClose}
      footer={done ? <button className="btn p" onClick={onClose}>Done</button> : <><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" disabled={busy || !chk || !chk.ok} onClick={() => send(file, false)}>{busy ? 'Working…' : `Register ${chk?.ok || 0} people`}</button></>}>
      {!done && <>
        <p className="small muted" style={{ marginTop: 0 }}>Columns: Full name, Role, School, Phone. The system makes each username (first.last) and a temporary password. <a className="linkbtn" href="/api/users/bulk-template.xlsx" download>Download the template</a></p>
        <label className="filepick">
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={(e) => pick(e.target.files[0])} />
          <Icon name="excel" /> {busy ? 'Checking the file…' : file ? file.name : 'Choose the Excel file (.xlsx)'}
        </label>
        <ErrorNote error={error} />
        {chk && <>
          <p><b>{chk.ok}</b> ready to register{chk.errors.length ? <>, <b style={{ color: 'var(--bad, #b00020)' }}>{chk.errors.length}</b> with mistakes (left out)</> : ''}.</p>
          {chk.errors.length > 0 && <ul className="small">{chk.errors.map((e) => <li key={e.row}>Row {e.row} {e.name}: {e.message}</li>)}</ul>}
          {chk.people.length > 0 && <div className="tw"><table className="stafftable"><thead><tr><th>S/N</th><th>Full name</th><th>Phone</th><th>Role</th><th>School</th></tr></thead><tbody>{chk.people.map((p, i) => <tr key={p.row}><td>{i + 1}</td><td>{p.fullName}</td><td className="mono">{p.phone || '—'}</td><td>{p.role}</td><td>{p.school}</td></tr>)}</tbody></table></div>}
        </>}
      </>}
      {done && <>
        <p><b>{done.created.length}</b> accounts made. Copy the passwords now: they are shown only once.</p>
        <button className="btn" onClick={csv}><Icon name="excel" /> Download usernames and passwords</button>
        <div className="tw" style={{ marginTop: 8 }}><table className="stafftable"><thead><tr><th>S/N</th><th>Full name</th><th>Phone</th><th>Role</th><th>School</th><th>Username</th><th>Temporary password</th></tr></thead><tbody>{done.created.map((c, i) => <tr key={c.id}><td>{i + 1}</td><td>{c.fullName}</td><td className="mono">{c.phone || '—'}</td><td>{c.role}</td><td>{c.school}</td><td><code>{c.username}</code></td><td><code>{c.tempPassword}</code></td></tr>)}</tbody></table></div>
      </>}
    </Modal>
  );
}

// Refuse a password request: the person gets no new password.
function RefuseReset({ u, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const go = () => api.post(`/users/${u.id}/refuse-reset`, { reason }).then(onDone).catch((e) => setError(e.message));
  return (
    <Modal title="Refuse this password request?" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p danger-bg" onClick={go}>Refuse</button></>}>
      <p style={{ marginTop: 0 }}><b>{u.fullName}</b> asked for a new password. If you refuse, no password is given and the request leaves the list. They can ask again.</p>
      <label className="small">Why (optional)</label>
      <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} style={{ width: '100%' }} />
      <ErrorNote error={error} />
    </Modal>
  );
}
