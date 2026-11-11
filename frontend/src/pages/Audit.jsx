import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useLive } from '../live';
import { useAuth } from '../auth/AuthContext';
import { useScope } from '../layout/scope';
import { Empty, ErrorNote, PageHead, Panel, fmtWhen } from '../components/ui';

export default function Audit() {
  const { user } = useAuth();
  const [scope] = useScope();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    const p = user.scope === 'all' && scope ? `&school=${scope}` : '';
    api.get(`/audit?limit=300${p}`).then((d) => { setRows(d.entries); setError(''); }).catch((e) => setError(e.message));
  }, [scope, user.scope]);
  useEffect(() => { load(); }, [load]);
  useLive(['audit'], load);
  return (
    <>
      <PageHead title="Audit log" sub="Every important action, who did it and when. Nobody can edit or delete this log." />
      <ErrorNote error={error} />
      <Panel title={rows ? `${rows.length} entries` : 'Entries'} flush>
        {!rows ? <Empty>Loading…</Empty> : !rows.length ? <Empty>No activity yet.</Empty> : (
          <div className="list">{rows.map((a) => (
            <div className="li" key={a.id}><div className="grow"><b className="fw5">{a.summary}</b><span>{a.by || 'System'}{a.byRole ? ` · ${a.byRole}` : ''} · {fmtWhen(a.at)}</span></div>
              {a.schoolShort && <span className="pill">{a.schoolShort}</span>}</div>
          ))}</div>
        )}
      </Panel>
    </>
  );
}
