/* eslint-disable react-refresh/only-export-components */
// Purchases and orders for ONE school (there is no main store). The Assistant Manager or the store-keeper buys or
// orders; when the goods are at the office, Mapokezi checks them against the receipts; the Accountant or the
// Assistant Accountant confirms. A delivery to the school's library is made at once: the store-keeper prints the QR
// labels and sticks them on, and the librarian checks what arrived and signs. The store-keeper never sees selling prices.
// The goods received note (GRN) is printed with the three names and signature lines.
import { useCallback, useEffect, useState } from 'react';
import { useSchools } from '../layout/scope';
import { api } from '../api';
import { useLive } from '../live';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, Modal, PageHead, Panel, SchoolPill, tsh, useToast } from '../components/ui';
import { todayStr } from '../components/common';
import { PinBox } from '../components/signing';
import { NewItem } from './Store';
import { Route, Routes, useNavigate } from 'react-router-dom';
import Manunuzi, { ManunuziView } from './Manunuzi';

const TONE = { pending: 'warn', checked: 'info', confirmed: 'ok', rejected: 'bad' };
const SchoolTag = ({ p }) => (p.school ? <SchoolPill code={p.school.code} name={p.school.short} /> : <span className="muted">Main store (old)</span>);

export default function Purchases() {
  return (
    <Routes>
      <Route index element={<PurchasesList />} />
      <Route path="buy/:id" element={<Manunuzi />} />
      <Route path="form/:id" element={<ManunuziView />} />
    </Routes>
  );
}

function PurchasesList() {
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [writing, setWriting] = useState(false);
  const navigate = useNavigate();
  const qs = status ? `?status=${status}` : '';
  const load = useCallback(() => api.get(`/purchases${qs}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [qs]);
  useEffect(() => { load(); }, [load]);
  useLive(['purchase'], load);
  const act = (p) => (p.canCheck ? 'Check' : p.canDecide ? (p.canSettle ? 'Money back' : 'Confirm') : 'Open');
  return (
    <>
      <PageHead title="Purchases & orders" sub="Bought or ordered for one school. When the goods are at the office, Mapokezi checks them against the receipts; the accountant confirms and they go to the school's library.">
        <ExcelButton href="/api/purchases/export.xlsx" />
        {data?.canWrite && <button className="btn" onClick={() => setWriting('order')}><Icon name="clock" /> New order</button>}
        {data?.canWrite && <button className="btn p" onClick={() => setWriting('bought')}><Icon name="plus" /> Bought now</button>}
      </PageHead>
      {data && <div className="kpis">
        <Kpi tone={data.pending ? 'warn' : 'ok'} label="Ordered / to check" value={data.pending} sub="checked by Mapokezi" />
        <Kpi tone={data.checked ? 'warn' : 'ok'} label="Checked: waiting for the Cashier or accountant" value={data.checked} />
        <Kpi label="Confirmed this month" value={`TSh ${tsh(data.confirmedThisMonth)}`} />
      </div>}
      <div className="filters"><div className="seg">{[['', 'All'], ['open', 'Waiting'], ['confirmed', 'Confirmed'], ['rejected', 'Rejected']].map(([k, t]) =>
        <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t}</button>)}</div></div>
      <ErrorNote error={error} />
      <Panel flush>
        {!data ? <Empty>Loading…</Empty> : !data.purchases.length ? <Empty>Nothing here.</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th>No.</th><th>Date</th><th>For</th><th className="stick">Supplier</th><th>Items</th><th className="n">Cost (TSh)</th><th>Written by</th><th>Checked by</th><th>Status</th><th /></tr></thead>
            <tbody>{data.purchases.map((p) => (
              <tr key={p.id}>
                <td className="mono small">{p.number}{p.requisition && <div className="muted">for {p.requisition.number}</div>}</td><td className="small">{p.boughtOn}{p.expectedOn && p.waitingGoods && <div className="muted">expected {p.expectedOn}</div>}</td>
                <td><SchoolTag p={p} /></td>
                <td className="stick"><b>{p.supplier}</b>{p.invoiceNo && <div className="small muted">{p.invoiceNo}</div>}</td>
                <td className="small">{p.lines.slice(0, 3).map((l) => `${l.qty} ${l.unit} ${l.item}`).join(', ')}{p.lines.length > 3 ? ` +${p.lines.length - 3}` : ''}</td>
                <td className="n"><b>{tsh(p.total)}</b></td><td className="small">{p.by}</td><td className="small">{p.checkedBy || <span className="muted">—</span>}</td>
                <td><span className={`pill ${p.waitingGoods ? 'info' : TONE[p.status]}`}>{p.statusLabel}</span>{p.delivery && <div className="small muted">{p.delivery.number} · {p.delivery.status === 'received' ? 'received by the library' : 'on the way'}</div>}</td>
                <td><button className={`btn sm${p.canCheck || p.canDecide ? ' p' : ''}`} onClick={() => navigate(`/purchases/form/${p.id}`)}>{act(p)}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {writing && <Write ordered={writing === 'order'} onClose={() => setWriting(false)} />}
    </>
  );
}

// The goods received note: bought by, counted by, confirmed by.
export function Write({ onClose, requisition, ordered: orderedStart = false }) {
  const toast = useToast();
  const [store, setStore] = useState(null);
  const schools = useSchools().filter((x) => x.active !== false);
  const [f, setF] = useState({ supplier: '', invoiceNo: '', boughtOn: todayStr(), note: '', ordered: orderedStart, expectedOn: '', schoolId: requisition?.schoolId || '' });
  const [lines, setLines] = useState([]);
  const [pick, setPick] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const loadItems = useCallback(() => api.get('/store/items').then(setStore).catch((e) => setError(e.message)), []);
  useEffect(() => { loadItems(); }, [loadItems]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const add = (i) => setLines((ls) => (ls.some((l) => l.itemId === i.id) ? ls : [...ls, { itemId: i.id, name: i.name, unit: i.unit, qty: '', unitCost: '' }]));
  const setLine = (id, k, v) => setLines((ls) => ls.map((l) => (l.itemId === id ? { ...l, [k]: v.replace(/\D/g, '') } : l)));
  const total = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unitCost || 0), 0);
  const [ask, setAsk] = useState(false);
  const save = async ({ pin, smsCode } = {}) => {
    setBusy(true); setError('');
    try {
      const d = await api.post('/purchases', { pin, smsCode, ...f, schoolId: Number(f.schoolId) || null, expectedOn: f.ordered ? f.expectedOn || null : null, requisitionId: requisition?.id, lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty), unitCost: Number(l.unitCost || 0) })) });
      toast(f.ordered ? `${d.purchase.number}: order saved. When the goods arrive, Mapokezi checks them against the receipts.` : `${d.purchase.number} saved: Mapokezi checks it against the receipts`); onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal wide title={requisition ? `Buy or order for ${requisition.number} · ${requisition.school}` : f.ordered ? 'New order' : 'Bought now'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" disabled={busy || f.supplier.trim().length < 3 || !f.schoolId || !lines.length || lines.some((l) => !Number(l.qty))} onClick={() => setAsk(true)}>{busy ? 'Saving…' : `${f.ordered ? 'Save order' : 'Save for counting'} · TSh ${tsh(total)}`}</button></>}>
      <div className="stack">
        {requisition && (
          <div className="stack" style={{ gap: 4 }}>
            <p className="small" style={{ margin: 0 }}><b>Approved on the form (the applicant's words):</b></p>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{requisition.lines.filter((l) => (l.approvedQty ?? l.qty ?? 1) > 0 && (l.approvedTotal ?? l.amount ?? 1) > 0).map((l) => <li key={l.id}>{l.qty != null ? `${l.approvedQty ?? l.qty} × ` : ''}{l.item}{l.amount != null ? ` · TSh ${tsh(l.approvedTotal ?? l.amount)}` : ''}</li>)}</ul>
            <p className="small muted" style={{ margin: 0 }}>Choose the stock item for each one below (or add a new item if it was never bought before). Write what you really buy or order.</p>
          </div>
        )}
        <div className="seg">{[[false, 'Bought now (goods are here)'], [true, 'Order (goods come later)']].map(([k, t]) =>
          <button key={t} type="button" className={f.ordered === k ? 'on' : ''} onClick={() => set('ordered', k)}>{t}</button>)}</div>
        <div className="fg">
          <label>Goes to (school)<select value={f.schoolId} disabled={!!requisition} onChange={(e) => set('schoolId', e.target.value)}>
            <option value="">Choose the school…</option>{schools.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          {f.ordered && <label>Expected on (not required)<input type="date" min={todayStr()} value={f.expectedOn} onChange={(e) => set('expectedOn', e.target.value)} /></label>}
        </div>
        <div className="fg">
          <label>Shop / supplier<input autoFocus value={f.supplier} maxLength={120} onChange={(e) => set('supplier', e.target.value)} placeholder="e.g. MWANZA TRADERS" /></label>
          <label>Invoice or receipt number<input value={f.invoiceNo} maxLength={60} onChange={(e) => set('invoiceNo', e.target.value)} /></label>
          <label>{f.ordered ? 'Ordered on' : 'Bought on'}<input type="date" value={f.boughtOn} max={todayStr()} onChange={(e) => set('boughtOn', e.target.value)} /></label>
        </div>
        <div className="fg">
          <label>Add an item<select value={pick} onChange={(e) => { const i = store.items.find((x) => String(x.id) === e.target.value); if (i) add(i); setPick(''); }}>
            <option value="">{store ? 'Choose…' : 'Loading…'}</option>{(store?.items || []).filter((i) => !lines.some((l) => l.itemId === i.id)).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.categoryLabel}, {i.unit})</option>)}
          </select></label>
          {store?.canAdd && <button type="button" className="btn" onClick={() => setAdding(true)}><Icon name="plus" /> Item not in the list</button>}
        </div>
        {lines.length > 0 && (
          <div className="tw"><table className="lines">
            <thead><tr><th>Item</th><th className="n">Quantity</th><th className="n">Cost of one (TSh)</th><th className="n">Amount</th><th /></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.itemId}><td><b>{l.name}</b></td>
                <td className="n"><input className="qtyin" inputMode="numeric" value={l.qty} onChange={(e) => setLine(l.itemId, 'qty', e.target.value)} aria-label={`${l.name} quantity`} /> <span className="small muted">{l.unit}</span></td>
                <td className="n"><input className="qtyin" style={{ width: 110 }} inputMode="numeric" value={l.unitCost} onChange={(e) => setLine(l.itemId, 'unitCost', e.target.value)} aria-label={`${l.name} cost`} /></td>
                <td className="n">{tsh(Number(l.qty || 0) * Number(l.unitCost || 0))}</td>
                <td className="n"><button className="iconbtn" onClick={() => setLines((ls) => ls.filter((x) => x.itemId !== l.itemId))} aria-label={`Remove ${l.name}`}><Icon name="x" /></button></td></tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={3}>Total</td><td className="n">{tsh(total)}</td><td /></tr></tfoot>
          </table></div>
        )}
        <label>Note (not required)<input value={f.note} maxLength={300} onChange={(e) => set('note', e.target.value)} /></label>
        <ErrorNote error={error} />
      </div>
      {ask && <PinBox type="purchase" id={0} title="Sign" onCancel={() => setAsk(false)} onConfirm={async (x) => { setAsk(false); await save(x); }} />}
      {adding && store && <NewItem d={store} onClose={() => setAdding(false)} onSaved={(i) => { add(i); loadItems(); }} />}
    </Modal>
  );
}
