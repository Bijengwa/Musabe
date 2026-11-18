// Barcodes & ID cards.
// - Item barcodes: one code per item (uniform, reams, rice). Print labels, or save the maker's own barcode.
// - Pieces: things that come back (text books, instruments) get one barcode for every piece.
// - ID cards: every student and every staff account has an ID code, scanned when receiving and returning.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { Empty, ErrorNote, Icon, Modal, PageHead, Panel, fmtWhen, useToast } from '../components/ui';
import { useSchoolQs } from '../components/common';
import { LabelSheet, PrintButton } from '../components/barcode';
import { CardSheet, IdCardPanel } from '../components/idcard';
import { ScanBox } from '../components/scan';

export default function Labels() {
  const { user, can } = useAuth();
  // Store-keeper: QR labels of items (the labels of each delivery are printed on Purchases). Librarian: also pieces.
  // ID cards: the School Admin (own school) and the Super Admin.
  const tabs = [
    ...(['librarian', 'storekeeper', 'super'].includes(user.role) ? [['items', 'Item QR labels']] : []),
    ...(['librarian', 'super'].includes(user.role) ? [['pieces', 'Pieces (one QR each)']] : []),
    ...(can('idcards') ? [['cards', 'ID cards']] : []),
  ];
  const [params] = useSearchParams();
  const [tab, setTab] = useState(tabs.some(([k]) => k === params.get('tab')) ? params.get('tab') : tabs[0][0]);
  return (
    <>
      <PageHead title="QR labels & ID cards" sub="Print on A4 sticker paper (3 labels across) or plain paper. QR scanners (like in supermarkets) read them." />
      <div className="filters"><div className="seg">{tabs.map(([k, t]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>)}</div></div>
      {tab === 'items' && <Items />}
      {tab === 'pieces' && <Pieces />}
      {tab === 'cards' && <Cards initialKind={params.get('kind')} />}
    </>
  );
}

function useItems(q) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  const load = useCallback(() => api.get(`/store/items${qs}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [qs]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useLive(['store', 'stock', 'item', 'purchase', 'delivery', 'issue'], load);
  return [data, error, load];
}

function Items() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [data, error] = useItems(q);
  const [pick, setPick] = useState({});   // itemId -> how many labels
  const [maker, setMaker] = useState(null);
  const rows = (data?.items || []).filter((i) => !i.returnable);
  const labels = rows.flatMap((i) => Array.from({ length: pick[i.id] || 0 }, () => ({ code: i.code, title: i.name, sub: i.unit === 'pc' ? '' : `per ${i.unit}` })));
  const set = (id, n) => setPick((p) => ({ ...p, [id]: Math.max(0, Math.min(200, n)) }));
  return (
    <>
      <div className="filters">
        <div className="searchbox"><Icon name="search" /><input placeholder="Search item" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <PrintButton label={`Print ${labels.length} label${labels.length === 1 ? '' : 's'}`} disabled={!labels.length}><LabelSheet labels={labels} /></PrintButton>
      </div>
      <ErrorNote error={error} />
      <Panel flush>
        {!data ? <Empty>Loading…</Empty> : !rows.length ? <Empty>No items.</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th className="stick">Item</th><th>Category</th><th>System barcode</th><th>Maker's barcode</th><th className="n">In my store</th><th className="n">Labels to print</th></tr></thead>
            <tbody>{rows.map((i) => (
              <tr key={i.id}>
                <td className="stick"><b>{i.name}</b><div className="small muted">counted in {i.unit}{i.sellable ? '' : ' · not for sale'}</div></td>
                <td>{i.categoryLabel}</td><td className="mono small">{i.code}</td>
                <td className="small">{i.barcodes.map((b) => <span key={b} className="mono">{b} </span>)}{can('labels', 'f') && <button className="btn sm" onClick={() => setMaker(i)}><Icon name="plus" /> Add</button>}</td>
                <td className="n">{i.qty}</td>
                <td className="n"><input className="qtyin" inputMode="numeric" value={pick[i.id] || ''} placeholder="0" onChange={(e) => set(i.id, Number(e.target.value.replace(/\D/g, '')) || 0)} aria-label={`Labels for ${i.name}`} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {maker && <MakerCode item={maker} onClose={() => setMaker(null)} />}
    </>
  );
}

function MakerCode({ item, onClose }) {
  const toast = useToast();
  const [error, setError] = useState('');
  const save = async (code) => {
    try { await api.post(`/store/items/${item.id}/barcodes`, { code }); toast(`${code} saved for ${item.name}`); onClose(); } catch (e) { setError(e.message); }
  };
  return (
    <Modal title={`Maker's barcode for ${item.name}`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="stack"><p style={{ margin: 0 }}>Scan the barcode printed on the packet. From then on, scanning it means <b>{item.name}</b>.</p>
        <ScanBox onScan={save} placeholder="Scan the packet" /><ErrorNote error={error} /></div>
    </Modal>
  );
}

function Pieces() {
  const { user } = useAuth();
  const toast = useToast();
  const keeper = user.role === 'librarian';
  const [data, error] = useItems('');
  const [itemId, setItemId] = useState('');
  const [copies, setCopies] = useState(null);
  const [count, setCount] = useState('');
  const [err, setErr] = useState('');
  const [fresh, setFresh] = useState([]);
  const items = (data?.items || []).filter((i) => i.returnable);
  const item = items.find((i) => String(i.id) === String(itemId));
  const loadCopies = useCallback(() => { if (itemId) api.get(`/store/copies?item=${itemId}`).then((d) => setCopies(d.copies)).catch((e) => setErr(e.message)); }, [itemId]);
  useEffect(() => { loadCopies(); }, [loadCopies]);
  useLive(['store', 'issue'], loadCopies);
  const shown = itemId ? copies : null;
  const free = item ? item.qty - item.pieces.in : 0;
  const make = async () => {
    setErr('');
    try { const d = await api.post('/store/copies', { itemId: Number(itemId), count: Number(count) }); setFresh(d.copies); setCount(''); toast(`${d.copies.length} barcodes made. Print them and stick one on each piece.`); loadCopies(); }
    catch (e) { setErr(e.message); }
  };
  const toLabels = (list) => list.map((c) => ({ code: c.code, title: c.item }));
  const inStore = (shown || []).filter((c) => c.status === 'in');
  return (
    <>
      <ErrorNote error={error || err} />
      <Panel title="Things that come back" sub="every piece has its own barcode, so the system knows who has which one">
        <div className="fg">
          <label>Item<select value={itemId} onChange={(e) => { setItemId(e.target.value); setFresh([]); setErr(''); }}>
            <option value="">Choose…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.qty} in my store, {i.pieces.in + i.pieces.out} with a barcode)</option>)}
          </select></label>
          {item && keeper && <label>Make barcodes for how many pieces? ({Math.max(0, free)} without one)
            <input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} placeholder={String(Math.max(0, free))} /></label>}
          {item && keeper && <button className="btn p" disabled={!Number(count)} onClick={make}><Icon name="plus" /> Make barcodes</button>}
        </div>
        {data && !items.length && <p className="note"><Icon name="alert" /> No item is marked "comes back" yet. The store-keeper or the Finance Manager marks it on "Items to issue" (for example text books and laboratory instruments).</p>}
        {fresh.length > 0 && <div className="filters" style={{ marginTop: 12 }}><span className="okline"><Icon name="check" /> {fresh[0].code} to {fresh[fresh.length - 1].code}</span>
          <PrintButton label={`Print these ${fresh.length}`}><LabelSheet labels={toLabels(fresh)} /></PrintButton></div>}
      </Panel>
      {item && (
        <Panel title={`Pieces of ${item.name}`} flush right={<PrintButton label={`Print all ${inStore.length} in the store`} disabled={!inStore.length}><LabelSheet labels={toLabels(inStore)} /></PrintButton>}>
          {!shown ? <Empty>Loading…</Empty> : !shown.length ? <Empty>No piece has a barcode yet.</Empty> : (
            <div className="tw"><table className="lines"><thead><tr><th>Barcode</th><th>State</th><th>With</th></tr></thead>
              <tbody>{shown.map((c) => (
                <tr key={c.id}><td className="mono">{c.code}</td>
                  <td><span className={`pill ${c.status === 'in' ? 'ok' : c.status === 'out' ? 'warn' : 'bad'}`}>{c.status === 'in' ? 'In the store' : c.status === 'out' ? 'Out' : c.status === 'lost' ? 'Lost' : 'Damaged'}</span></td>
                  <td className="small">{c.holder ? `${c.holder.name}${c.holder.detail ? ` (${c.holder.detail})` : ''} · ${c.holder.issue}` : c.note || ''}</td></tr>
              ))}</tbody></table></div>
          )}
        </Panel>
      )}
    </>
  );
}

function Cards({ initialKind }) {
  const { user } = useAuth();
  const toast = useToast();
  const school = useSchoolQs();
  const [kind, setKind] = useState(initialKind === 'staff' ? 'staff' : 'student');
  const [cls, setCls] = useState('');
  const [state, setState] = useState('');      // '' all | 'no' not issued | 'yes' issued
  const [cards, setCards] = useState(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState({});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const needSchool = kind === 'student' && user.scope === 'all' && !school;
  const qs = `kind=${kind}${school ? `&school=${school}` : ''}`;
  const load = useCallback(() => {
    if (needSchool) return;
    api.get(`/store/cards?${qs}`).then((d) => { setCards({ qs, list: d.cards, canIssue: d.canIssue }); setError(''); }).catch((e) => setError(e.message));
  }, [qs, needSchool]);
  useEffect(() => { load(); }, [load]);
  useLive(['idcard', 'student', 'user'], load);
  const list = useMemo(() => (cards?.qs === qs && !needSchool ? cards.list : null), [cards, qs, needSchool]);
  const classes = useMemo(() => [...new Set((list || []).map((c) => c.detail))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })), [list]);
  const shown = (list || []).filter((c) => (kind === 'staff' || !cls || c.detail === cls) && (!state || (state === 'yes') === !!c.issued));
  const notIssued = (list || []).filter((c) => !c.issued).length;
  const canIssue = !!cards?.canIssue;
  const picked = shown.filter((c) => tick[c.code] && !c.issued);
  const issue = async () => {
    setBusy(true);
    try {
      const d = await api.post('/idcards/issue', { kind, ids: picked.map((c) => c.id) });
      toast(`${d.issued} ID card${d.issued === 1 ? '' : 's'} recorded as given${d.skipped ? ` (${d.skipped} already had one)` : ''}`); setTick({}); load();
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const allTicked = shown.filter((c) => !c.issued).length > 0 && shown.filter((c) => !c.issued).every((c) => tick[c.code]);
  return (
    <>
      <div className="filters">
        <div className="seg">{[['student', 'Students'], ['staff', 'Staff']].map(([k, t]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => { setKind(k); setCls(''); setTick({}); }}>{t}</button>)}</div>
        {kind === 'student' && <select value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Class"><option value="">All classes</option>{classes.map((c) => <option key={c} value={c}>{c}</option>)}</select>}
        <div className="seg">{[['', 'All'], ['no', `Not issued${list ? ` (${notIssued})` : ''}`], ['yes', 'Issued']].map(([k, t]) => <button key={k} className={state === k ? 'on' : ''} onClick={() => setState(k)}>{t}</button>)}</div>
        <PrintButton className="btn" label={`Print ${shown.length} card${shown.length === 1 ? '' : 's'}`} disabled={!shown.length}><CardSheet cards={shown} /></PrintButton>
        {canIssue && <button className="btn p" disabled={!picked.length || busy} onClick={issue}><Icon name="check" /> {picked.length ? `Mark ${picked.length} as issued` : 'Tick who received the card'}</button>}
      </div>
      <ErrorNote error={error} />
      <Panel flush>
        {needSchool ? <Empty>Choose a school at the top of the page to see its students.</Empty> : !list ? <Empty>Loading…</Empty> : !shown.length ? <Empty>Nobody here.</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr>
              {canIssue && <th className="ck"><input type="checkbox" aria-label="Tick all not issued" checked={allTicked}
                onChange={(e) => setTick(Object.fromEntries(shown.filter((c) => !c.issued).map((c) => [c.code, e.target.checked])))} /></th>}
              <th className="stick">Name</th><th>{kind === 'student' ? 'Class' : 'Role'}</th>{kind === 'student' && <th>Admission No.</th>}<th>School</th><th>ID code</th><th>ID card</th><th />
            </tr></thead>
            <tbody>{shown.slice(0, 300).map((c) => (
              <tr key={c.code}>
                {canIssue && <td className="ck">{!c.issued && <input type="checkbox" checked={!!tick[c.code]} onChange={(e) => setTick((t) => ({ ...t, [c.code]: e.target.checked }))} aria-label={`${c.name} received the card`} />}</td>}
                <td className="stick"><b>{c.name}</b></td><td>{c.detail}</td>{kind === 'student' && <td>{c.admissionNo}</td>}<td className="small">{c.school}</td>
                <td className="mono small">{c.code}</td>
                <td>{c.issued ? <span className="pill ok" title={`Given ${fmtWhen(c.issued.at)}`}>Issued{c.issued.no > 1 ? ` (card ${c.issued.no})` : ''}</span> : <span className="pill warn">Not issued</span>}</td>
                <td><button className="btn sm" onClick={() => setOpen(c)}>Open</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {shown.length > 300 && <p className="small muted" style={{ margin: 0 }}>Showing the first 300 of {shown.length}. Printing prints all {shown.length}; choose a class to print fewer.</p>}
      <p className="small muted" style={{ margin: 0 }}>10 cards fit on one A4 page. Give each card by hand, then tick the names and press "Mark as issued", so everyone can see who has taken their ID. The QR code is only a number: it opens nothing by itself.</p>
      {open && <Modal wide title={open.name} onClose={() => setOpen(null)} footer={<button className="btn" onClick={() => setOpen(null)}>Close</button>}>
        <IdCardPanel kind={kind} id={open.id} flush /></Modal>}
    </>
  );
}
