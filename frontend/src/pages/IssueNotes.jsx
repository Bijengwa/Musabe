// Issue Notes (2026-11-24): the Second Master writes, the keeper of the place gives. Also the stock of the place.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, Loading, Modal, PageHead, Panel, Tabs, fmtWhen, useToast } from '../components/ui';

const TONE = { open: 'warn', part: 'warn', given: 'ok', cancelled: '' };

export default function IssueNotes() {
  const { user, can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('todo');
  const [place, setPlace] = useState('');
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [write, setWrite] = useState(false);
  const load = useCallback(() => {
    const qs = new URLSearchParams({ ...(tab === 'todo' ? { status: 'todo' } : {}), ...(place ? { place } : {}) });
    return api.get(`/notes?${qs}`).then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message));
  }, [tab, place]);
  useEffect(() => { load(); }, [load]);
  useLive(['note', 'stock'], load);
  const keeper = ['librarian', 'sstore'].includes(user.role);
  return (
    <>
      <PageHead title="Issue Notes" sub="The Second Master writes a note; the keeper of the place gives the things and stock goes down.">
        <ExcelButton href="/api/notes/export.xlsx" />
        {d?.canWrite && <button className="btn p" onClick={() => setWrite(true)}><Icon name="plus" /> Write Issue Note</button>}
      </PageHead>
      <ErrorNote error={error} />
      {d && <div className="kpis"><Kpi tone={d.todo ? 'warn' : 'ok'} label="Waiting to give" value={d.todo} /></div>}
      <Tabs tabs={[['todo', 'To give'], ['all', 'All notes'], ...(keeper || ['sadmin', 'super'].includes(user.role) ? [['stock', 'Stock of my place']] : [])]} value={tab} onChange={setTab} />
      {tab !== 'stock' && (
        <>
          <div className="row" style={{ margin: '8px 0' }}>
            <div className="seg">{[['', 'Both places'], ['school_store', 'School store'], ['library', 'Library']].map(([k, t]) => <button key={k} type="button" className={place === k ? 'on' : ''} onClick={() => setPlace(k)}>{t}</button>)}</div>
          </div>
          <Panel flush>
            {!d ? <Loading /> : !d.notes.length ? <Empty icon="inbox" title="No Issue Notes here"
              steps={['The parent pays and the Bursar writes the receipt.', 'The Second Master writes the Issue Note from the receipt.', 'The Librarian or the School Store-keeper gives the things against the note.']} /> : (
              <div className="tw"><table className="stafftable">
                <thead><tr><th className="stick">Note</th><th>For</th><th>Place</th><th>Status</th><th>Written</th></tr></thead>
                <tbody>{d.notes.map((n) => (
                  <tr key={n.id} onClick={() => setOpen(n.id)} style={{ cursor: 'pointer' }}>
                    <td className="stick nowrap"><b className="mono">{n.number}</b></td>
                    <td>{n.kind === 'receipt' ? <>{n.student} <span className="small muted">({n.receipt})</span></> : n.recipient}<div className="small muted">{n.kindLabel}</div></td>
                    <td>{n.placeLabel}</td><td><span className={`pill ${TONE[n.status]}`}>{n.statusLabel}</span></td>
                    <td className="small nowrap">{fmtWhen(n.writtenAt)}<div className="muted">{n.writtenBy}</div></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
        </>
      )}
      {tab === 'stock' && <PlaceStock />}
      {open && <NoteModal id={open} onClose={() => setOpen(null)} onChanged={() => { load(); }} toast={toast} />}
      {write && <WriteModal onClose={() => setWrite(false)} onSaved={(n) => { setWrite(false); load(); toast(`${n.length} note${n.length > 1 ? 's' : ''} written`); }} />}
      {['sadmin', 'super'].includes(user.role) && user.school && <Strict toast={toast} />}
    </>
  );
}

function Strict({ toast }) {
  const [on, setOn] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/notes/stock').then((x) => setOn(x.strict)).catch(() => {}); }, []);
  if (on === null) return null;
  const flip = async () => { setError(''); try { const r = await api.post('/notes/strict', { strict: !on }); setOn(r.strict); toast(r.strict ? 'Library and School store are kept apart' : 'The Librarian may handle both places'); } catch (e) { setError(e.message); } };
  return (
    <Panel title="Keep the two places apart">
      <p className="small muted" style={{ marginTop: 0 }}>When ON, the Librarian handles only the library (books, exercise books, stationery) and the School Store-keeper only the rest (uniforms, cleaning, laboratory, food, equipment). Turn it ON after you create the School Store-keeper account.</p>
      <button className={`btn ${on ? '' : 'p'}`} onClick={flip}>{on ? 'Turn OFF' : 'Turn ON'}</button> <span className={`pill ${on ? 'ok' : ''}`}>{on ? 'ON' : 'OFF'}</span>
      <ErrorNote error={error} />
    </Panel>
  );
}

function PlaceStock() {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/notes/stock').then(setD).catch((e) => setError(e.message)); }, []);
  useLive(['stock'], () => api.get('/notes/stock').then(setD).catch(() => {}));
  return (
    <Panel flush>
      <ErrorNote error={error} />
      {!d ? <Loading /> : !d.items.length ? <Empty icon="box" title="Nothing in stock yet" steps={['Stock comes in when you confirm a delivery.']} /> : (
        <div className="tw"><table className="stafftable"><thead><tr><th className="stick">Item</th><th>Place</th><th>Left</th><th>Reorder at</th></tr></thead>
          <tbody>{d.items.map((i) => <tr key={i.itemId}><td className="stick"><b>{i.name}</b></td><td>{i.place === 'library' ? 'Library' : 'School store'}</td>
            <td><b>{i.qty}</b> {i.unit}{i.low && <span className="pill warn sm">Low</span>}</td><td>{i.reorder || ''}</td></tr>)}</tbody></table></div>
      )}
    </Panel>
  );
}

function NoteModal({ id, onClose, onChanged, toast }) {
  const [n, setN] = useState(null);
  const [error, setError] = useState('');
  const [give, setGive] = useState({});
  const [by, setBy] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get(`/notes/${id}`).then((x) => setN(x.note)).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn, msg) => { setError(''); setBusy(true); try { const r = await fn(); setN(r.note); setGive({}); toast(msg); onChanged(); } catch (e) { setError(e.message); } setBusy(false); };
  if (!n) return <Modal title="Issue Note" onClose={onClose}>{error ? <ErrorNote error={error} /> : <Loading />}</Modal>;
  const lines = Object.entries(give).filter(([, q]) => Number(q) > 0).map(([lineId, qty]) => ({ lineId: Number(lineId), qty: Number(qty) }));
  return (
    <Modal wide title={`${n.number} · ${n.placeLabel}`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <p style={{ marginTop: 0 }}><span className={`pill ${TONE[n.status]}`}>{n.statusLabel}</span> {n.kind === 'receipt' ? <>for <b>{n.student}</b>, receipt {n.receipt}</> : <>for <b>{n.recipient}</b></>} <span className="small muted">· written by {n.writtenBy}, {fmtWhen(n.writtenAt)}</span></p>
      {n.note && <p className="small">{n.note}</p>}
      {n.cancelReason && <p className="err">Cancelled: {n.cancelReason}</p>}
      <div className="tw"><table className="stafftable"><thead><tr><th>Item</th><th>Asked</th><th>Given</th><th>Left</th>{n.canGive && <th>Give now</th>}</tr></thead>
        <tbody>{n.lines.map((l) => (
          <tr key={l.id}><td><b>{l.name}</b></td><td>{l.qty}</td><td>{l.given}</td><td>{l.left}</td>
            {n.canGive && <td>{l.left > 0 && <input type="number" min="0" max={l.left} style={{ width: 80 }} value={give[l.id] ?? ''} onChange={(e) => setGive((g) => ({ ...g, [l.id]: e.target.value }))} />}</td>}</tr>
        ))}</tbody></table></div>
      {n.canGive && (
        <div className="fg" style={{ marginTop: 10 }}>
          <label>Collected by<input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Parent, student or staff name" /></label>
          <div style={{ alignSelf: 'end' }}><button className="btn p" disabled={busy || !lines.length} onClick={() => act(() => api.post(`/notes/${n.id}/give`, { lines, collectedBy: by }), 'Given')}>Give</button>
            <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setGive(Object.fromEntries(n.lines.filter((l) => l.left > 0).map((l) => [l.id, l.left])))}>Give all</button></div>
        </div>
      )}
      {n.gives.length > 0 && <><h4>Given</h4><ul className="small">{n.gives.map((g) => <li key={g.id}>{g.qty} × {g.name} · {fmtWhen(g.at)} · by {g.by}{g.collectedBy ? ` · collected by ${g.collectedBy}` : ''}</li>)}</ul></>}
      {n.canCancel && (
        <div className="fg" style={{ marginTop: 10 }}>
          <label>Cancel this note<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why?" /></label>
          <div style={{ alignSelf: 'end' }}><button className="btn" disabled={busy || reason.trim().length < 3} onClick={() => act(() => api.post(`/notes/${n.id}/cancel`, { reason }), 'Cancelled')}>Cancel note</button></div>
        </div>
      )}
      <ErrorNote error={error} />
    </Modal>
  );
}

function WriteModal({ onClose, onSaved }) {
  const [kind, setKind] = useState('receipt');
  const [rs, setRs] = useState(null);
  const [receiptId, setReceiptId] = useState('');
  const [place, setPlace] = useState('school_store');
  const [items, setItems] = useState([]);
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([{ itemId: '', qty: 1 }]);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/notes/to-write').then((x) => setRs(x.receipts)).catch((e) => setError(e.message)); }, []);
  useEffect(() => { if (kind !== 'receipt') api.get(`/notes/items?place=${place}`).then((x) => setItems(x.items)).catch(() => {}); }, [kind, place]);
  const save = async (e) => {
    e.preventDefault(); setError('');
    try {
      const body = kind === 'receipt' ? { kind, receiptId: Number(receiptId), note } : { kind, place, recipient, note, lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: Number(l.itemId), qty: Number(l.qty) })) };
      const r = await api.post('/notes', body); onSaved(r.notes);
    } catch (err) { setError(err.message); }
  };
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <Modal wide title="Write Issue Note" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" form="nform">Write note</button></>}>
      <form id="nform" className="stack" onSubmit={save}>
        <div className="seg">{[['receipt', 'From a paid receipt'], ['staff', 'To a staff member'], ['place', 'To a place']].map(([k, t]) => <button type="button" key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{t}</button>)}</div>
        {kind === 'receipt' ? (
          !rs ? <Loading /> : !rs.length ? <p className="muted">Every paid receipt already has its Issue Note or is fully given.</p> : (
            <label>Paid receipt<select value={receiptId} onChange={(e) => setReceiptId(e.target.value)} required><option value="">Choose…</option>
              {rs.map((r) => <option key={r.id} value={r.id}>{r.number} · {r.student} ({r.class || ''}) · {r.lines.map((l) => `${l.qty} ${l.name}`).join(', ')}</option>)}</select></label>
          )
        ) : (
          <>
            <div className="fg"><label>Gives from<select value={place} onChange={(e) => { setPlace(e.target.value); setLines([{ itemId: '', qty: 1 }]); }}><option value="school_store">School store</option><option value="library">Library</option></select></label>
              <label>{kind === 'staff' ? 'Staff member' : 'Place that receives'}<input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={kind === 'staff' ? 'Name' : 'Kitchen, Dormitory…'} required /></label></div>
            {lines.map((l, i) => (
              <div className="fg" key={i}><label>Item<select value={l.itemId} onChange={(e) => setLine(i, 'itemId', e.target.value)}><option value="">Choose…</option>{items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}</select></label>
                <label>Quantity<input type="number" min="1" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} /></label></div>
            ))}
            <button type="button" className="btn sm" onClick={() => setLines((ls) => [...ls, { itemId: '', qty: 1 }])}>+ Add item</button>
          </>
        )}
        <label>Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
