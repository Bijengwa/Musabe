import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { Empty, ErrorNote, Icon, Kpi, PageHead, Panel, fmtWhen, useToast } from '../components/ui';

// Review an Excel upload before it reaches the items list.
// Shows every row by school: new items, new prices, start/stop selling, and mistakes (in red).
// The uploader (or the Finance Manager) approves it, or discards it.
const KINDS = [
  ['changes', 'Changes and mistakes'],
  ['New item', 'New items'],
  ['New price', 'New prices'],
  ['Start selling', 'Start selling'],
  ['Stop selling here', 'Stop selling'],
  ['mistakes', 'Mistakes'],
  ['all', 'All rows'],
];

export default function ItemReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [school, setSchool] = useState('');
  const [kind, setKind] = useState('changes');
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);

  const load = useCallback(() => api.get(`/items/imports/${id}`).then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  useLive(['item', 'itemimport'], load); // prices changed meanwhile? the check is done again

  const rows = useMemo(() => (d?.rows || []).filter((r) => {
    if (school && r.school !== school) return false;
    if (kind === 'all') return true;
    if (kind === 'mistakes') return !!r.error;
    if (kind === 'changes') return r.error || r.change !== 'No change';
    if (kind === 'New item') return !r.error && r.change === 'New item';
    return !r.error && r.change === kind;
  }), [d, school, kind]);

  // Per school: how many changes each will get.
  const bySchool = useMemo(() => {
    const m = {};
    for (const r of d?.rows || []) {
      const k = r.school || '—';
      m[k] ||= { changes: 0, errors: 0 };
      if (r.error) m[k].errors++; else if (r.change !== 'No change') m[k].changes++;
    }
    return m;
  }, [d]);

  const decide = async (what) => {
    setBusy(true); setError('');
    try {
      const r = await api.post(`/items/imports/${id}/${what}`);
      if (what === 'approve') toast(`Approved: ${r.added} new item${r.added === 1 ? '' : 's'}, ${r.priced} price change${r.priced === 1 ? '' : 's'}`);
      else toast('Upload discarded. Nothing was changed.');
      navigate('/items');
    } catch (e) { setError(e.message); load(); } finally { setBusy(false); setSure(false); }
  };

  if (!d) return <>{error ? <ErrorNote error={error} /> : <Empty>Loading…</Empty>}<Link className="btn" to="/items">Back to items</Link></>;
  const { upload: u, summary: s } = d;
  const pending = u.status === 'pending';
  const count = (k) => (k === 'changes' ? s.changes + s.errors : k === 'mistakes' ? s.errors : k === 'all' ? s.rows
    : k === 'New item' ? d.rows.filter((r) => !r.error && r.change === 'New item').length : d.rows.filter((r) => !r.error && r.change === k).length);

  return (
    <>
      <PageHead title="Check the Excel upload" sub={`${u.fileName} · uploaded by ${u.mine ? 'you' : u.uploadedBy}, ${fmtWhen(u.createdAt)}`}>
        <Link className="btn" to="/items">← Back to items</Link>
      </PageHead>

      {!pending && (
        <Panel><p style={{ margin: 0 }}>This upload was <b>{u.status}</b> by {u.decidedBy} {fmtWhen(u.decidedAt)}.</p></Panel>
      )}

      {pending && (
        <>
          <div className="kpis">
            <Kpi label="New items" value={s.newItems} />
            <Kpi label="New prices" value={s.newPrices} />
            <Kpi label="Start selling" value={s.startSelling} sub="a school starts selling an item" />
            <Kpi label="Stop selling" value={s.stopSelling} sub="a school stops selling an item" />
            <Kpi label="Mistakes" value={s.errors} tone={s.errors ? 'bad' : 'ok'} />
          </div>

          <div className={`reviewbar ${s.errors ? 'bad' : ''}`}>
            {s.errors > 0
              ? <span><b>{s.errors} mistake{s.errors === 1 ? '' : 's'}.</b> Fix the red rows in Excel (the row number is shown), then upload the file again.</span>
              : !s.changes ? <span><b>Nothing to change.</b> Every row is the same as today.</span>
              : <span><b>{s.changes} change{s.changes === 1 ? '' : 's'}</b> will be saved. Check them below. Nothing is in the items list until you approve.</span>}
            <span className="grow" />
            {u.canDecide && <button className="btn danger" disabled={busy} onClick={() => decide('discard')}>Discard</button>}
            {u.canDecide && !sure && <button className="btn p" disabled={busy || s.errors > 0 || !s.changes} onClick={() => setSure(true)}><Icon name="check" /> Approve</button>}
            {u.canDecide && sure && <button className="btn p" disabled={busy} onClick={() => decide('approve')}>{busy ? 'Saving…' : `Yes, save ${s.changes} change${s.changes === 1 ? '' : 's'}`}</button>}
            {!u.canDecide && <span className="pill">Only {u.uploadedBy} or the Finance Manager can approve</span>}
          </div>
        </>
      )}
      <ErrorNote error={error} />

      {pending && (
        <>
          <div className="filters">
            <div className="seg">
              <button className={!school ? 'on' : ''} onClick={() => setSchool('')}>All schools</button>
              {(d.schools || []).filter((x) => bySchool[x.shortName]).map((x) => (
                <button key={x.id} className={school === x.shortName ? 'on' : ''} onClick={() => setSchool(x.shortName)}>
                  {x.shortName} <span className="small muted">{bySchool[x.shortName].changes}{bySchool[x.shortName].errors ? ` · ${bySchool[x.shortName].errors}!` : ''}</span>
                </button>
              ))}
            </div>
            <select aria-label="Show" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map(([k, t]) => <option key={k} value={k}>{t} ({count(k)})</option>)}
            </select>
            <span className="muted small">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
          </div>

          <Panel flush>
            {!rows.length ? <Empty>No rows here.</Empty> : (
              <div className="tw"><table className="reviewtable">
                <thead><tr><th className="n">Row</th><th>Item</th><th>Category</th><th>School</th><th>Change</th><th>Today</th><th>After approval</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.row} className={r.error ? 'bad' : r.change === 'No change' ? 'same' : ''}>
                    <td className="n" data-l="Row">{r.row}</td>
                    <td><b>{r.item || '—'}</b>{r.change === 'New item' && <span className="pill info sm">new</span>}</td>
                    <td data-l="Category">{r.category}</td>
                    <td data-l="School">{r.school || '—'}</td>
                    <td data-l="Change">{r.error ? <span className="pill bad">Mistake</span> : <span className={`pill ${r.change === 'No change' ? '' : r.change === 'Stop selling here' ? 'warn' : 'info'}`}>{r.change}</span>}</td>
                    {r.error
                      ? <td colSpan={2} className="err-t">{r.error}</td>
                      : <><td data-l="Today" className="muted">{r.from}</td><td data-l="After"><b>{r.to}</b></td></>}
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
