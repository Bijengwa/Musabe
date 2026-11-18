// Incoming stock: the librarian counts what arrived and confirms each line. Stock goes up only then.
// Fewer than sent? Type what arrived and write a note (e.g. "3 missing"); the finance office is told.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { Empty, ErrorNote, Icon, PageHead, Panel, useToast } from '../components/ui';
import { DeliveryList } from './SendStock';

export default function Incoming() {
  const { user } = useAuth();
  const [tab, setTab] = useState('sent');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get(`/stock/deliveries?status=${tab}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [tab]);
  useEffect(() => { load(); }, [load]);
  useLive(['delivery'], load);
  return (
    <>
      <PageHead title="Incoming stock" sub={`${user.school?.name || ''} · Count what arrived. Confirm each line, or "All arrived" when everything is as sent.`} />
      <div className="seg">{[['sent', `To confirm${data && tab === 'sent' ? ` (${data.deliveries.length})` : ''}`], ['received', 'Received']].map(([k, t]) =>
        <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>)}</div>
      <ErrorNote error={error} />
      <Panel flush>
        {data && !data.deliveries.length ? <Empty>{tab === 'sent' ? 'Nothing on the way to your library.' : 'Nothing received yet.'}</Empty> : (
          <DeliveryList data={data} openAll={tab === 'sent'}>{tab === 'sent' ? (d) => <ConfirmLines d={d} /> : null}</DeliveryList>
        )}
      </Panel>
    </>
  );
}

function ConfirmLines({ d }) {
  const toast = useToast();
  const [got, setGot] = useState(() => Object.fromEntries(d.lines.map((l) => [l.id, String(l.qty)])));
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const one = async (l) => {
    setBusy(l.id); setError('');
    try {
      await api.post(`/stock/deliveries/${d.id}/lines/${l.id}/confirm`, { receivedQty: Number(got[l.id] || 0), note: notes[l.id] || '' });
      toast(`${l.name}: confirmed`);
    } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const all = async () => {
    setBusy('all'); setError('');
    try { await api.post(`/stock/deliveries/${d.id}/confirm-all`, {}); toast(`${d.number}: all received`); } catch (e) { setError(e.message); }
    setBusy(null);
  };
  const waiting = d.lines.filter((l) => l.received == null);
  return (
    <div className="stack">
      <div className="tw"><table className="lines">
        <thead><tr><th>Item</th><th className="n">Sent</th><th className="n">Arrived</th><th>Note (if fewer)</th><th /></tr></thead>
        <tbody>{d.lines.map((l) => {
          const n = Number(got[l.id] || 0);
          const fewer = l.received == null && n < l.qty;
          return (
            <tr key={l.id}>
              <td><b>{l.name}</b></td><td className="n">{l.qty}</td>
              <td className="n">{l.received != null ? <span className={`pill ${l.short ? 'bad' : 'ok'}`}><Icon name="check" /> {l.received}</span>
                : <input className="qtyin" inputMode="numeric" value={got[l.id]} onChange={(e) => setGot((x) => ({ ...x, [l.id]: e.target.value.replace(/\D/g, '') }))} aria-label={`${l.name} arrived`} />}</td>
              <td>{l.received != null ? <span className="small muted">{l.note}</span>
                : <input value={notes[l.id] || ''} onChange={(e) => setNotes((x) => ({ ...x, [l.id]: e.target.value }))} placeholder={fewer ? 'Needed: e.g. 3 missing, 2 torn' : 'Optional'} className={fewer && !notes[l.id] ? 'bad' : ''} />}</td>
              <td className="n">{l.received == null && <button className="btn sm p" disabled={busy != null || n > l.qty || (fewer && !notes[l.id])} onClick={() => one(l)}>{busy === l.id ? '…' : 'Confirm'}</button>}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <ErrorNote error={error} />
      {waiting.length > 1 && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn p" disabled={busy != null} onClick={all}><Icon name="check" /> All {waiting.length} lines arrived as sent</button></div>}
    </div>
  );
}
