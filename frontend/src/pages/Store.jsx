// Items to issue: the things the schools buy and use but do not sell (text books, ream papers, chalk, lab
// instruments, rice ...). There is no main store: the store-keeper buys or orders for one school and the goods go to
// that school's library. Here the store-keeper (or the Finance Manager) keeps the list: add one, mark what comes back
// after use (one QR per piece), or upload many at once from Excel. Choose a school to see what its library holds.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useLive } from '../live';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, Modal, PageHead, Panel, tsh, useToast } from '../components/ui';
import { useSchoolQs } from '../components/common';

export default function Store() {
  const school = useSchoolQs();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState(null);
  const p = new URLSearchParams();
  if (q.trim()) p.set('q', q.trim());
  if (school) p.set('school', school);
  const qs = p.toString();
  const load = useCallback(() => api.get(`/store/items?${qs}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [qs]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useLive(['store', 'stock', 'purchase', 'delivery', 'issue', 'count'], load);
  const rows = (data?.items || []).filter((i) => !i.sellable);
  const upload = async (file) => {
    setError('');
    try {
      const r = await fetch('/api/store/items/import', { method: 'POST', credentials: 'include', body: file });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setResult({ error: d.error || 'Could not read the file.', mistakes: d.mistakes || [] }); return; }
      setResult(d); toast(`${d.added} item${d.added === 1 ? '' : 's'} added`); load();
    } catch (e) { setError(e.message); }
  };
  const showQty = !!data?.store;
  return (
    <>
      <PageHead title="Items to issue" sub="Things the schools use and do not sell: text books, ream papers, chalk, lab instruments, food. Sold things (uniform, socks) are on Items & prices.">
        {data?.canAdd && <ExcelButton href="/api/store/items/template.xlsx" label="Excel template" />}
        {data?.canAdd && <label className="btn filepick"><Icon name="upload" /> Upload Excel<input type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) upload(f); }} /></label>}
        {data?.canAdd && <button className="btn p" onClick={() => setAdding(true)}><Icon name="plus" /> New item</button>}
      </PageHead>
      {data && <div className="kpis">
        <Kpi tone="hi" label="Items" value={rows.length} />
        <Kpi label="Come back after use" value={rows.filter((r) => r.returnable).length} sub="one QR per piece" />
        {showQty && <Kpi tone={rows.some((r) => !r.qty) ? 'warn' : 'ok'} label={`None in ${data.store.name}`} value={rows.filter((r) => !r.qty).length} />}
      </div>}
      {result && (result.error
        ? <div className="err"><b>{result.error}</b><ul className="small">{result.mistakes.map((m) => <li key={m}>{m}</li>)}</ul></div>
        : <p className="note">{result.added} added, {result.already} already in the list{result.already ? ` (${result.alreadyNames.slice(0, 6).join(', ')}${result.already > 6 ? ' …' : ''})` : ''}.</p>)}
      <div className="filters"><div className="searchbox"><Icon name="search" /><input placeholder="Search item" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {!showQty && <span className="small muted">Choose a school at the top to see what its library holds.</span>}</div>
      <ErrorNote error={error} />
      <Panel flush>
        {!data ? <Empty>Loading…</Empty> : !rows.length ? <Empty>No items yet. Add one, or download the Excel template, fill it and upload it.</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th className="stick">Item</th><th>Category</th><th>QR code</th><th>Unit</th><th>Comes back?</th>{showQty && <th className="n">In the library</th>}{showQty && <th className="n">Pieces given out</th>}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className={showQty && !r.qty ? 'lateRow' : ''}>
                <td className="stick"><b>{r.name}</b></td>
                <td>{r.categoryLabel}</td><td className="mono small">{r.code}</td><td>{r.unit === 'pc' ? 'pieces' : r.unit}</td>
                <td>{data.canAdd ? <Returnable r={r} onDone={load} /> : r.returnable ? 'Yes' : 'No'}</td>
                {showQty && <td className="n"><b>{tsh(r.qty)}</b></td>}
                {showQty && <td className="n">{r.returnable ? r.pieces.out : <span className="muted">—</span>}</td>}
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {adding && <NewItem d={data} onClose={() => setAdding(false)} onSaved={load} />}
    </>
  );
}

function Returnable({ r, onDone }) {
  const toast = useToast();
  const flip = async (e) => {
    try { await api.patch(`/store/items/${r.id}`, { returnable: e.target.checked }); toast(`${r.name}: ${e.target.checked ? 'comes back (a barcode for every piece)' : 'does not come back'}`); onDone?.(); } catch (x) { toast(x.message); }
  };
  return <label className="checkline"><input type="checkbox" checked={r.returnable} onChange={flip} /> {r.returnable ? 'Yes' : 'No'}</label>;
}

export function NewItem({ d, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', category: '', unit: 'pc', returnable: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true); setError('');
    try { const r = await api.post('/store/items', f); toast(`${r.item.name} added`); onSaved?.(r.item); onClose(); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal title="New item the school buys and uses" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" disabled={busy || f.name.trim().length < 2 || !f.category} onClick={save}>{busy ? 'Saving…' : 'Add item'}</button></>}>
      <div className="stack">
        <label>Name<input autoFocus value={f.name} maxLength={80} onChange={(e) => set('name', e.target.value)} placeholder="e.g. RICE, MICROSCOPE, BIOLOGY FORM 2 (TIE)" /></label>
        <div className="fg">
          <label>Category<select value={f.category} onChange={(e) => set('category', e.target.value)}><option value="">Choose…</option>{d.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
          <label>Counted in<select value={f.unit} onChange={(e) => set('unit', e.target.value)}>{d.units.map((u) => <option key={u} value={u}>{u === 'pc' ? 'pieces' : u}</option>)}</select></label>
        </div>
        <label className="checkline"><input type="checkbox" checked={f.returnable} onChange={(e) => set('returnable', e.target.checked)} /> It comes back after use (text book, instrument): every piece gets its own barcode</label>
        <p className="small muted" style={{ margin: 0 }}>Things for sale with a price are made by the Finance Manager on "Items & prices".</p>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
