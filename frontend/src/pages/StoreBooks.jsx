// Store books (2026-11-20): the administration store-keeper's own ledgers, like the paper books.
// Folders (FOODS, CLEANING ...) -> items (MCHELE kg, SUKARI kg ...) -> lines: received, sent to a place, used, corrected after counting.
// What is left shows for the store and for every place (e.g. BOYS KITCHEN). Lines are never changed: a mistake gets a "corrected" line.
import { useCallback, useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, Modal, PageHead, Panel, fmtWhen, useToast } from '../components/ui';
import { todayStr } from '../components/common';

const fmt = (n) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: 3 });

export default function StoreBooks() {
  return (
    <Routes>
      <Route index element={<Folders />} />
      <Route path="items/:iid" element={<ItemBook />} />
      <Route path=":fid" element={<Folder />} />
    </Routes>
  );
}

function Folders() {
  const toast = useToast();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const load = useCallback(() => api.get('/store-books').then(setD).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useLive(['book'], load);
  const make = async () => {
    try { const r = await api.post('/store-books', { name }); toast(`Folder ${r.folder.name} made`); setAdding(false); setName(''); navigate(`/store-books/${r.folder.id}`); } catch (e) { setError(e.message); }
  };
  return (
    <>
      <PageHead title="Store books" sub="Your own books, like the paper ledgers: make a folder (e.g. FOODS), put the items in it (MCHELE, SUKARI, UNGA ...), and write what came in, where it went and what was used. What is left is counted for you.">
        {d?.canWrite && <button className="btn p" onClick={() => setAdding(true)}><Icon name="plus" /> New folder</button>}
      </PageHead>
      <ErrorNote error={error} />
      {!d ? <Empty>Loading…</Empty> : !d.folders.length ? <Panel><Empty>No folders yet.{d.canWrite ? ' Press "New folder", e.g. FOODS.' : ''}</Empty></Panel> : (
        <div className="kpis">{d.folders.map((f) => (
          <Link key={f.id} to={`/store-books/${f.id}`} className="kpi" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="kl"><Icon name="book" /> Folder</span><b style={{ fontSize: 20 }}>{f.name}</b><span className="small muted">{f.items} item{f.items === 1 ? '' : 's'}</span>
          </Link>
        ))}</div>
      )}
      {adding && (
        <Modal title="New folder" onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn p" disabled={name.trim().length < 2} onClick={make}>Make it</button></>}>
          <label>Folder name<input autoFocus value={name} maxLength={60} placeholder="e.g. FOODS" onChange={(e) => setName(e.target.value)} /></label>
          <ErrorNote error={error} />
        </Modal>
      )}
    </>
  );
}

function Folder() {
  const { fid } = useParams();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', unit: 'kg', reorderLevel: '' });
  const [line, setLine] = useState(null);   // the item to write a line for
  const load = useCallback(() => api.get(`/store-books/${fid}`).then(setD).catch((e) => setError(e.message)), [fid]);
  useEffect(() => { load(); }, [load]);
  useLive(['book'], load);
  const addItem = async () => {
    try { await api.post(`/store-books/${fid}/items`, f); toast(`${f.name.toUpperCase()} added`); setAdding(false); setF({ name: '', unit: 'kg', reorderLevel: '' }); await load(); } catch (e) { setError(e.message); }
  };
  if (!d) return <><Link to="/store-books" className="btn sm">← Store books</Link><ErrorNote error={error} />{!error && <Empty>Loading…</Empty>}</>;
  const low = d.items.filter((i) => i.low).length;
  return (
    <>
      <PageHead title={d.folder.name} sub="What is left in the store and at each place. Open an item for its full book.">
        <Link to="/store-books" className="btn">← Store books</Link>
        <ExcelButton href={`/api/store-books/${fid}/export.xlsx`} />
        {d.canWrite && <button className="btn p" onClick={() => setAdding(true)}><Icon name="plus" /> New item</button>}
      </PageHead>
      <div className="kpis"><Kpi label="Items" value={d.items.length} /><Kpi tone={low ? 'bad' : 'ok'} label="Low in the store" value={low} sub="at or below the warning level" /></div>
      <ErrorNote error={error} />
      <Panel flush>
        {!d.items.length ? <Empty>No items yet.{d.canWrite ? ' Press "New item", e.g. MCHELE in kg.' : ''}</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th className="stick">Item</th><th>In the store</th><th>Received (all)</th><th>Used (all)</th><th>Last line</th></tr></thead>
            <tbody>{d.items.map((i) => (
              <tr key={i.id} className="clickrow" tabIndex={0} onClick={() => navigate(`/store-books/items/${i.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/store-books/items/${i.id}`); }}>
                <td className="stick"><Link to={`/store-books/items/${i.id}`}><b>{i.name}</b></Link><div className="small muted">{i.unit}</div></td>
                <td><b>{fmt(i.inStore)}</b> {i.unit} {i.low && <span className="pill bad">low</span>}</td>
                <td>{fmt(i.received)}</td><td>{fmt(i.used)}</td>
                <td className="small">{i.lastLine || '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {adding && (
        <Modal title={`New item in ${d.folder.name}`} onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn p" disabled={f.name.trim().length < 2} onClick={addItem}>Add</button></>}>
          <div className="stack">
            <label>Item name<input autoFocus value={f.name} maxLength={80} placeholder="e.g. MCHELE" onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label>Counted in<select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{d.units.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
            <label>Warn me when the store has this much or less (not required)<input inputMode="decimal" value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value.replace(/[^\d.]/g, '') })} /></label>
            <ErrorNote error={error} />
          </div>
        </Modal>
      )}
      {line && <LineBox item={line} places={d.places} onClose={() => setLine(null)} onSaved={() => { setLine(null); load(); }} />}
    </>
  );
}

// Write one line in an item's book.
function LineBox({ item, places, onClose, onSaved }) {
  const toast = useToast();
  const [kind, setKind] = useState('received');
  const [f, setF] = useState({ qty: '', counted: '', place: '', party: '', note: '', date: todayStr() });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const num = (v) => v.replace(/[^\d.]/g, '');
  const save = async () => {
    setBusy(true); setError('');
    try {
      await api.post(`/store-books/items/${item.id}/lines`, { kind, qty: Number(f.qty), counted: f.counted === '' ? undefined : Number(f.counted), place: f.place, party: f.party, note: f.note, date: f.date });
      toast(`${item.name}: written`); onSaved();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const tabs = [['received', 'Received'], ['sent', 'Sent to a place'], ['used', 'Used'], ['corrected', 'Correct after counting']];
  return (
    <Modal title={`${item.name} (${item.unit})`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" disabled={busy} onClick={save}>Write it</button></>}>
      <div className="stack">
        <div className="seg">{tabs.map(([k, t]) => <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{t}</button>)}</div>
        <p className="small muted" style={{ margin: 0 }}>In the store now: <b>{fmt(item.inStore)} {item.unit}</b>{item.atPlaces?.length ? ` · ${item.atPlaces.map((p) => `${p.place}: ${fmt(p.qty)}`).join(' · ')}` : ''}</p>
        <datalist id="book-places">{places.map((p) => <option key={p} value={p} />)}</datalist>
        {kind === 'corrected' ? (
          <>
            <label>Where you counted (empty = the store)<input list="book-places" value={f.place} maxLength={60} onChange={(e) => set('place', e.target.value)} /></label>
            <label>How much you counted ({item.unit})<input inputMode="decimal" value={f.counted} onChange={(e) => set('counted', num(e.target.value))} /></label>
          </>
        ) : (
          <>
            <label>Amount ({item.unit})<input autoFocus inputMode="decimal" value={f.qty} onChange={(e) => set('qty', num(e.target.value))} /></label>
            {kind === 'sent' && <label>Sent to (place)<input list="book-places" value={f.place} maxLength={60} placeholder="e.g. BOYS KITCHEN" onChange={(e) => set('place', e.target.value)} /></label>}
            {kind === 'used' && <label>Used at (empty = the store)<input list="book-places" value={f.place} maxLength={60} placeholder="e.g. BOYS KITCHEN" onChange={(e) => set('place', e.target.value)} /></label>}
            {kind === 'received' && <label>Received from (supplier, not required)<input value={f.party} maxLength={120} onChange={(e) => set('party', e.target.value)} /></label>}
            {kind === 'sent' && <label>Given to (person, not required)<input value={f.party} maxLength={120} placeholder="e.g. the cook" onChange={(e) => set('party', e.target.value)} /></label>}
          </>
        )}
        <label>Date<input type="date" max={todayStr()} value={f.date} onChange={(e) => set('date', e.target.value)} /></label>
        <label>Note{kind === 'corrected' ? ' (needed: why it is different)' : ' (not required)'}<input value={f.note} maxLength={300} onChange={(e) => set('note', e.target.value)} /></label>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

function ItemBook() {
  const { iid } = useParams();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [writing, setWriting] = useState(false);
  const [places, setPlaces] = useState([]);
  const load = useCallback(() => api.get(`/store-books/items/${iid}`).then((x) => { setD(x); setError(''); return api.get(`/store-books/${x.item.folderId}`).then((y) => setPlaces(y.places)); }).catch((e) => setError(e.message)), [iid]);
  useEffect(() => { load(); }, [load]);
  useLive(['book'], load);
  if (!d) return <><Link to="/store-books" className="btn sm">← Store books</Link><ErrorNote error={error} />{!error && <Empty>Loading…</Empty>}</>;
  const it = d.item;
  return (
    <>
      <PageHead title={`${it.name} (${it.unit})`} sub={`Folder ${it.folder}. Newest lines first. Lines are never changed: a mistake is fixed with a "corrected" line.`}>
        <Link to={`/store-books/${it.folderId}`} className="btn">← {it.folder}</Link>
        {d.canWrite && <button className="btn p" onClick={() => setWriting(true)}><Icon name="pen" /> Write</button>}
      </PageHead>
      <div className="kpis">
        <Kpi tone={it.reorderLevel != null && it.inStore <= it.reorderLevel ? 'bad' : 'hi'} label="In the store" value={`${fmt(it.inStore)} ${it.unit}`} sub={it.reorderLevel != null ? `warning at ${fmt(it.reorderLevel)}` : ''} />
        {it.atPlaces.map((p) => <Kpi key={p.place} label={p.place} value={`${fmt(p.qty)} ${it.unit}`} />)}
      </div>
      <Panel flush>
        {!d.lines.length ? <Empty>Nothing written yet.</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th>Date</th><th className="stick">What</th><th>Amount</th><th>Place</th><th>From / to</th><th>Store after</th><th>Place after</th><th>Note</th><th>By</th></tr></thead>
            <tbody>{d.lines.map((l) => (
              <tr key={l.id}>
                <td className="small">{l.date}</td>
                <td className="stick"><span className={`pill ${l.kind === 'received' ? 'ok' : l.kind === 'used' ? 'warn' : l.kind === 'corrected' ? 'bad' : 'info'}`}>{l.kindLabel}</span></td>
                <td><b>{l.kind === 'corrected' && l.qty > 0 ? '+' : ''}{fmt(l.qty)}</b></td>
                <td>{l.place}</td><td className="small">{l.party || ''}</td>
                <td>{fmt(l.storeAfter)}</td><td>{l.placeAfter == null ? '' : fmt(l.placeAfter)}</td>
                <td className="small">{l.note || ''}</td><td className="small">{l.by}<div className="muted">{fmtWhen(l.at)}</div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {writing && <LineBox item={it} places={places} onClose={() => setWriting(false)} onSaved={() => { setWriting(false); load(); }} />}
    </>
  );
}
