import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { useScope } from '../layout/scope';
import { ROLE_LABELS } from '../nav';
import { Empty, ErrorNote, ExcelButton, Icon, PageHead, Panel, fmtWhen } from '../components/ui';

const GROUP_ICON = { library: 'box', accounts: 'key', schools: 'building', academic: 'book', other: 'list' };

// Activity: everything that happens, live. Filter by area, role, date or words. Download to Excel.
export default function Audit() {
  const { user } = useAuth();
  const [scope] = useScope();
  const [rows, setRows] = useState(null);
  const [groups, setGroups] = useState([]);
  const [error, setError] = useState('');
  const [group, setGroup] = useState('');
  const [role, setRole] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (user.scope === 'all' && scope) p.set('school', scope);
    if (group) p.set('group', group);
    if (role) p.set('role', role);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [user.scope, scope, group, role, from, to, q]);

  const load = useCallback(() => {
    api.get(`/audit?limit=300&${params}`).then((d) => { setRows(d.entries); setGroups(d.groups); setError(''); }).catch((e) => setError(e.message));
  }, [params]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useLive(['audit'], load);

  const filtered = group || role || from || to || q;
  const clear = () => { setGroup(''); setRole(''); setFrom(''); setTo(''); setQ(''); };

  return (
    <>
      <PageHead title="Activity" sub={user.role === 'super' || user.scope === 'all' && groups.length > 2
        ? 'Everything that happens in the system, as it happens: who did it and when. Nobody can change or delete it.'
        : 'What happens in your area, as it happens: who did it and when.'}>
        <ExcelButton href={`/api/audit/export.xlsx?${params}`} />
      </PageHead>

      {groups.length > 1 && (
        <div className="seg grouptabs" role="tablist">
          <button className={group === '' ? 'on' : ''} onClick={() => setGroup('')}>All</button>
          {groups.map((g) => <button key={g.key} className={group === g.key ? 'on' : ''} onClick={() => setGroup(g.key)}><Icon name={GROUP_ICON[g.key]} /> {g.label}</button>)}
        </div>
      )}

      <div className="filters">
        <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Everyone</option>
          {Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="datein">From<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="datein">To<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="searchbox"><Icon name="search" /><input placeholder="Search words or a name" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {filtered && <button className="btn sm" onClick={clear}><Icon name="x" /> Clear</button>}
      </div>

      <ErrorNote error={error} />
      <Panel title={rows ? `${rows.length}${rows.length === 300 ? '+' : ''} entries` : 'Entries'} sub={rows?.length === 300 ? 'Showing the newest 300. The Excel file has all of them.' : ''} flush>
        {!rows ? <Empty>Loading…</Empty> : !rows.length ? <Empty>Nothing found.</Empty> : (
          <div className="list">{rows.map((a) => (
            <div className="li" key={a.id}>
              <span className={`gic g-${a.group}`}><Icon name={GROUP_ICON[a.group] || 'list'} /></span>
              <div className="grow"><b className="fw5">{a.summary}</b><span>{a.by || 'System'}{a.byRole ? ` · ${a.byRole}` : ''} · {fmtWhen(a.at)}</span></div>
              {a.schoolShort && <span className="pill">{a.schoolShort}</span>}
            </div>
          ))}</div>
        )}
      </Panel>
    </>
  );
}
