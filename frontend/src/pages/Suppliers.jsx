// Suppliers, price lists / proforma invoices and supplier debts (2026-11-21).
// Procurement keeps the list and types each price list as on the paper (with a photo of it). Goods bought on credit make
// a debt; the accountant office records each payment to the supplier.
import { useCallback, useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, Modal, PageHead, Panel, PhoneInput, fmtPhone, phoneProblem, tsh, useToast, DetailSkeleton, Loading } from '../components/ui';
import { todayStr } from '../components/common';

const TERMS = [['cash', 'Cash'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['other', 'Other']];

export default function Suppliers() {
  return (
    <Routes>
      <Route index element={<SupplierList />} />
      <Route path="price-lists/new" element={<NewPriceList />} />
      <Route path=":id" element={<SupplierPage />} />
    </Routes>
  );
}

function SupplierList() {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);
  const [lists, setLists] = useState(null);
  const load = useCallback(() => {
    api.get(`/suppliers?all=1${q ? `&q=${encodeURIComponent(q)}` : ''}`).then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message));
    api.get('/suppliers/price-lists').then((x) => setLists(x.priceLists)).catch(() => {});
  }, [q]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useLive(['supplier', 'pricelist', 'purchase'], load);
  const owing = (d?.suppliers || []).filter((s) => s.owed > 0);
  return (
    <>
      <PageHead title="Suppliers" sub="Shops and suppliers, their payment terms, the price lists they gave, and what we owe them.">
        <ExcelButton href="/api/suppliers/export.xlsx" />
        {d?.canAddList && <Link className="btn" to="/suppliers/price-lists/new"><Icon name="file" /> Add price list / proforma</Link>}
        {d?.canEdit && <button className="btn p" onClick={() => setForm({})}><Icon name="plus" /> New supplier</button>}
      </PageHead>
      <ErrorNote error={error} />
      {d && <div className="kpis">
        <Kpi tone="hi" label="Suppliers" value={d.suppliers.filter((s) => s.active).length} />
        <Kpi tone={d.owed ? 'warn' : 'ok'} label="We owe (goods on credit)" value={`TSh ${tsh(d.owed)}`} sub={owing.length ? `${owing.length} supplier${owing.length === 1 ? '' : 's'}` : 'nothing owed'} />
        <Kpi label="Price lists / proformas" value={lists ? lists.length : '…'} sub={lists ? `${lists.filter((l) => l.expired).length} expired` : ''} />
      </div>}
      <div className="filters"><div className="searchbox"><Icon name="search" /><input placeholder="Supplier name" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      <Panel flush>
        {!d ? <Loading /> : !d.suppliers.length ? <Empty icon="cart" title="No suppliers yet"
          steps={['Add each shop or supplier with its payment terms.', 'Attach the price lists or proformas they give you.', 'Buy from them: anything taken on credit shows under "We owe".']}
          action={d.canEdit && <button className="btn p" onClick={() => setForm({})}><Icon name="plus" /> New supplier</button>} /> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th className="stick">Supplier</th><th>Phone</th><th>Place</th><th>Terms</th><th className="n">Price lists</th><th>Last bought</th><th className="n">Owed (TSh)</th></tr></thead>
            <tbody>{d.suppliers.map((s) => (
              <tr key={s.id} className={`clickrow${s.active ? '' : ' off'}`} tabIndex={0} onClick={() => navigate(`/suppliers/${s.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/suppliers/${s.id}`)}>
                <td className="stick"><b>{s.name}</b>{!s.active && <span className="pill sm">Off</span>}{s.tin && <div className="small muted">TIN {s.tin}</div>}</td>
                <td className="nowrap">{s.phone ? fmtPhone(s.phone) : <span className="muted">—</span>}</td>
                <td>{s.place || <span className="muted">—</span>}</td>
                <td><span className={`pill ${s.terms === 'cash' ? '' : 'info'}`}>{s.termsLabel}</span>{s.termsNote && <div className="small muted">{s.termsNote}</div>}</td>
                <td className="n">{s.priceLists}</td>
                <td className="nowrap">{s.lastBought || <span className="muted">—</span>}</td>
                <td className="n">{s.owed > 0 ? <b style={{ color: 'var(--warn)' }}>{tsh(s.owed)}</b> : <span className="muted">0</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {lists && lists.length > 0 && (
        <Panel title="Latest price lists and proformas" flush>
          <div className="tw"><table className="stafftable">
            <thead><tr><th>No.</th><th className="stick">Supplier</th><th>Paper</th><th>Date</th><th>Valid until</th><th className="n">Items</th><th>Entered by</th></tr></thead>
            <tbody>{lists.slice(0, 10).map((l) => (
              <tr key={l.id} onClick={() => setForm({ view: l })} style={{ cursor: 'pointer' }}><td className="mono small">{l.number}</td><td className="stick"><b>{l.supplier}</b></td><td>{l.kindLabel}{l.refNo ? ` ${l.refNo}` : ''}</td>
                <td className="nowrap">{l.docDate}</td><td className="nowrap">{l.validUntil ? <span className={l.expired ? 'pill bad' : ''}>{l.validUntil}</span> : <span className="muted">—</span>}</td>
                <td className="n">{l.lines.length}</td><td className="small">{l.by}</td></tr>
            ))}</tbody>
          </table></div>
        </Panel>
      )}
      {form && !form.view && <SupplierForm onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
      {form?.view && <PriceListView l={form.view} onClose={() => setForm(null)} />}
    </>
  );
}

export function PriceListView({ l, onClose }) {
  return (
    <Modal wide title={`${l.kindLabel} ${l.number} · ${l.supplier}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button>
      {l.hasFile && <a className="btn p" href={`/api/suppliers/price-lists/${l.id}/file`} target="_blank" rel="noreferrer"><Icon name="eye" /> See the paper</a>}</>}>
      <p className="small muted" style={{ marginTop: 0 }}>{l.refNo ? `Their no. ${l.refNo} · ` : ''}Date {l.docDate}{l.validUntil ? ` · valid until ${l.validUntil}` : ''} · entered by {l.by}{!l.hasFile ? ' · no photo of the paper' : ''}</p>
      <div className="tw"><table className="stafftable">
        <thead><tr><th>S/N</th><th>Item</th><th>Unit</th><th className="n">Price (TSh)</th></tr></thead>
        <tbody>{l.lines.map((x, i) => <tr key={x.id}><td>{i + 1}</td><td>{x.item}</td><td>{x.unit || ''}</td><td className="n">{tsh(x.price)}</td></tr>)}</tbody>
      </table></div>
      {l.note && <p className="small">{l.note}</p>}
    </Modal>
  );
}

function SupplierForm({ s, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: s?.name || '', phone: s?.phone || '', tin: s?.tin || '', place: s?.place || '', terms: s?.terms || 'cash', termsNote: s?.termsNote || '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => {
    e.preventDefault(); setError('');
    if (phoneProblem(f.phone)) { setError(`Phone: ${phoneProblem(f.phone)}`); return; }
    setBusy(true);
    try { const r = s ? await api.patch(`/suppliers/${s.id}`, f) : await api.post('/suppliers', f); toast(`${r.supplier.name} saved`); onSaved(r.supplier); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={s ? `Edit ${s.name}` : 'New supplier'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" form="supform" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="supform" className="stack" onSubmit={save}>
        <label>Name<input value={f.name} onChange={(e) => set('name', e.target.value)} required autoFocus placeholder="e.g. MWANZA HARDWARE LTD" /></label>
        <div className="fg">
          <label>Phone<PhoneInput value={f.phone} onChange={(v) => set('phone', v)} /></label>
          <label>TIN (if any)<input value={f.tin} onChange={(e) => set('tin', e.target.value)} /></label>
        </div>
        <label>Place / address<input value={f.place} onChange={(e) => set('place', e.target.value)} placeholder="e.g. Kariakoo Mwanza" /></label>
        <div className="lab">Payment terms (agreed)<div className="seg">{TERMS.map(([k, t]) => <button type="button" key={k} className={f.terms === k ? 'on' : ''} onClick={() => set('terms', k)}>{t}</button>)}</div></div>
        <label>Terms note<input value={f.termsNote} onChange={(e) => set('termsNote', e.target.value)} placeholder="e.g. pay by the 5th of the next month" /></label>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function SupplierPage() {
  const { id } = useParams();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);
  const [view, setView] = useState(null);
  const load = useCallback(() => api.get(`/suppliers/${id}`).then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  useLive(['supplier', 'pricelist', 'purchase'], load);
  if (!d) return <><Link to="/suppliers" className="btn sm">← Suppliers</Link><ErrorNote error={error} />{!error && <DetailSkeleton />}</>;
  const s = d.supplier;
  return (
    <>
      <div className="row"><Link to="/suppliers" className="btn sm">← Suppliers</Link></div>
      <PageHead title={s.name} sub={[s.phone && fmtPhone(s.phone), s.place, s.tin && `TIN ${s.tin}`, `Terms: ${s.termsLabel}${s.termsNote ? ` (${s.termsNote})` : ''}`].filter(Boolean).join(' · ')}>
        {d.canEdit && <button className="btn" onClick={() => setEdit(true)}><Icon name="edit" /> Edit</button>}
        {d.canEdit && <button className={`btn${s.active ? ' danger' : ''}`} onClick={async () => { try { await api.patch(`/suppliers/${s.id}`, { active: !s.active }); toast(s.active ? 'Switched off' : 'Switched on'); load(); } catch (e) { setError(e.message); } }}>{s.active ? 'Switch off' : 'Switch on'}</button>}
        {d.canPay && s.owed > 0 && <button className="btn p" onClick={() => setPay(true)}><Icon name="check" /> Record a payment</button>}
      </PageHead>
      <ErrorNote error={error} />
      <div className="kpis">
        <Kpi tone={s.owed > 0 ? 'warn' : 'ok'} label="We owe now" value={`TSh ${tsh(s.owed)}`} />
        <Kpi label="Bought on credit" value={`TSh ${tsh(s.credit)}`} />
        <Kpi label="Paid" value={`TSh ${tsh(s.paid)}`} />
      </div>
      <Panel title="Account (credit and payments)" flush>
        {!d.statement.length ? <Empty>No goods on credit and no payments yet.</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th>Date</th><th className="stick">Details</th><th className="n">Goods on credit</th><th className="n">Paid</th><th className="n">Balance</th></tr></thead>
            <tbody>{d.statement.map((m, i) => <tr key={i}><td className="nowrap">{m.day}</td><td className="stick">{m.what}</td><td className="n">{m.credit ? tsh(m.credit) : ''}</td><td className="n">{m.paid ? tsh(m.paid) : ''}</td><td className="n"><b>{tsh(m.balance)}</b></td></tr>)}</tbody>
          </table></div>
        )}
      </Panel>
      <div className="grid2">
        <Panel title="Price lists / proformas" flush>
          {!d.priceLists.length ? <Empty>None yet.</Empty> : <div className="list">{d.priceLists.map((l) => (
            <button key={l.id} className="li libtn" onClick={() => setView(l)}><div className="grow"><b>{l.number} · {l.kindLabel}{l.refNo ? ` ${l.refNo}` : ''}</b><span>{l.docDate}{l.validUntil ? ` · valid until ${l.validUntil}` : ''} · {l.lines.length} items</span></div>{l.expired && <span className="pill bad">Expired</span>}</button>
          ))}</div>}
        </Panel>
        <Panel title="Purchases and LPOs" flush>
          {!d.purchases.length && !d.lpos.length ? <Empty>Nothing bought yet.</Empty> : <div className="list">
            {d.lpos.map((l) => <Link key={`l${l.id}`} className="li libtn" to={`/lpo/${l.id}`}><div className="grow"><b>{l.number}</b><span>LPO · {l.day}{l.total != null ? ` · TSh ${tsh(l.total)}` : ''}</span></div><span className="pill">{l.status}</span></Link>)}
            {d.purchases.map((p) => <Link key={p.id} className="li libtn" to={`/purchases/form/${p.id}`}><div className="grow"><b>{p.number}</b><span>{p.day} · {p.school || 'office'} · TSh {tsh(p.worth)}{p.onCredit ? ' · on credit' : ''}</span></div><span className="pill">{p.status}</span></Link>)}
          </div>}
        </Panel>
      </div>
      {edit && <SupplierForm s={s} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); load(); }} />}
      {pay && <PayForm s={s} onClose={() => setPay(false)} onSaved={() => { setPay(false); load(); toast('Payment saved'); }} />}
      {view && <PriceListView l={view} onClose={() => setView(null)} />}
    </>
  );
}

function PayForm({ s, onClose, onSaved }) {
  const [f, setF] = useState({ amount: '', paidOn: todayStr(), ref: '', note: '' });
  const [error, setError] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => { e.preventDefault(); setError(''); try { await api.post(`/suppliers/${s.id}/payments`, { ...f, amount: Number(f.amount) }); onSaved(); } catch (err) { setError(err.message); } };
  return (
    <Modal title={`Payment to ${s.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" form="payform">Save</button></>}>
      <form id="payform" className="stack" onSubmit={save}>
        <p className="small muted" style={{ margin: 0 }}>We owe TSh {tsh(s.owed)}. A payment cannot be more than that.</p>
        <div className="fg">
          <label>Amount (TSh)<input inputMode="numeric" value={f.amount} onChange={(e) => set('amount', e.target.value.replace(/\D/g, ''))} required autoFocus /></label>
          <label>Paid on<input type="date" max={todayStr()} value={f.paidOn} onChange={(e) => set('paidOn', e.target.value)} /></label>
        </div>
        <label>Reference (voucher, cheque or bank no.)<input value={f.ref} onChange={(e) => set('ref', e.target.value)} required /></label>
        <label>Note<input value={f.note} onChange={(e) => set('note', e.target.value)} /></label>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

// Typing a price list / proforma as on the paper, then adding the photo of the paper.
function NewPriceList() {
  const navigate = useNavigate();
  const toast = useToast();
  const [sups, setSups] = useState([]);
  const [f, setF] = useState({ supplierId: '', kind: 'proforma', refNo: '', docDate: todayStr(), validUntil: '', note: '' });
  const [rows, setRows] = useState(() => Array.from({ length: 5 }, () => ({ k: Math.random(), item: '', unit: '', price: '' })));
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/suppliers').then((d) => setSups(d.suppliers)).catch((e) => setError(e.message)); }, []);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setRow = (k, key, v) => setRows((rs) => rs.map((r) => (r.k === k ? { ...r, [key]: v } : r)));
  const used = rows.filter((r) => r.item.trim() || r.price);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const d = await api.post('/suppliers/price-lists', { ...f, supplierId: Number(f.supplierId), lines: used.map((r) => ({ item: r.item, unit: r.unit, price: r.price })) });
      if (file) {
        const r = await fetch(`/api/suppliers/price-lists/${d.priceList.id}/file`, { method: 'POST', credentials: 'include', body: file });
        if (!r.ok) throw new Error(`${d.priceList.number} saved, but the photo was not: ${(await r.json().catch(() => ({}))).error || 'upload failed'}`);
      }
      toast(`${d.priceList.number} saved`); navigate(`/suppliers/${f.supplierId}`);
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <>
      <div className="row"><Link to="/suppliers" className="btn sm">← Suppliers</Link></div>
      <PageHead title="Add price list / proforma invoice" sub="Type it as it is on the supplier's paper, and add a photo (or PDF) of the paper. It is never changed after saving." />
      <Panel>
        <div className="stack">
          <div className="fg">
            <label>Supplier<select value={f.supplierId} onChange={(e) => set('supplierId', e.target.value)}><option value="">Choose…</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <div className="lab">Paper<div className="seg">{[['proforma', 'Proforma invoice'], ['pricelist', 'Price list']].map(([k, t]) => <button type="button" key={k} className={f.kind === k ? 'on' : ''} onClick={() => set('kind', k)}>{t}</button>)}</div></div>
          </div>
          <div className="fg">
            <label>Their number on the paper<input value={f.refNo} onChange={(e) => set('refNo', e.target.value)} placeholder="e.g. PF-0881" /></label>
            <label>Date on the paper<input type="date" value={f.docDate} max={todayStr()} onChange={(e) => set('docDate', e.target.value)} /></label>
            <label>Valid until (if written)<input type="date" value={f.validUntil} onChange={(e) => set('validUntil', e.target.value)} /></label>
          </div>
          <div className="tw"><table className="lines">
            <thead><tr><th>S/N</th><th>Item / description</th><th>Unit</th><th className="n">Price (TSh)</th><th /></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={r.k}><td>{i + 1}</td><td><input value={r.item} onChange={(e) => setRow(r.k, 'item', e.target.value)} aria-label={`Item ${i + 1}`} /></td>
                <td style={{ width: 110 }}><input value={r.unit} onChange={(e) => setRow(r.k, 'unit', e.target.value)} placeholder="bag, kg…" aria-label={`Unit ${i + 1}`} /></td>
                <td style={{ width: 150 }}><input className="n" inputMode="numeric" value={r.price} onChange={(e) => setRow(r.k, 'price', e.target.value.replace(/\D/g, ''))} aria-label={`Price ${i + 1}`} /></td>
                <td><button className="iconbtn" onClick={() => setRows((rs) => rs.filter((x) => x.k !== r.k))} aria-label="Remove"><Icon name="x" /></button></td></tr>
            ))}</tbody>
          </table></div>
          <div><button className="btn sm" onClick={() => setRows((rs) => [...rs, ...Array.from({ length: 3 }, () => ({ k: Math.random(), item: '', unit: '', price: '' }))])}><Icon name="plus" /> More lines</button></div>
          <label className="filepick"><input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files[0] || null)} /><Icon name="camera" /> {file ? file.name : 'Photo or PDF of the paper (up to 3 MB)'}</label>
          <label>Note<input value={f.note} onChange={(e) => set('note', e.target.value)} /></label>
          <ErrorNote error={error} />
          <div className="row"><button className="btn p" disabled={busy || !f.supplierId || !used.length} onClick={save}>{busy ? 'Saving…' : `Save ${used.length} price${used.length === 1 ? '' : 's'}`}</button></div>
        </div>
      </Panel>
    </>
  );
}

// For the buying forms: choose an existing supplier, or register one here and select it immediately.
export function SupplierPick({ value, onChange, allowCredit = true, allowLpo = true }) {
  const toast = useToast();
  const [sups, setSups] = useState([]);
  const [lpos, setLpos] = useState([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const loadSuppliers = useCallback(() => api.get('/suppliers').then((d) => setSups(d.suppliers)).catch(() => {}), []);
  useEffect(() => { loadSuppliers(); }, [loadSuppliers]);
  const sid = value.supplierId;
  useEffect(() => { if (allowLpo && sid) api.get(`/lpos/open?supplier=${sid}`).then((d) => setLpos(d.lpos)).catch(() => setLpos([])); }, [sid, allowLpo]);
  const sup = sups.find((s) => String(s.id) === String(sid));
  const set = (patch) => onChange({ ...value, ...patch });
  const register = async () => {
    setError('');
    try {
      const d = await api.post('/suppliers', { name });
      await loadSuppliers();
      set({ supplierId: String(d.supplier.id), supplier: d.supplier.name, lpoId: '', onCredit: allowCredit && d.supplier.terms !== 'cash' });
      toast(`${d.supplier.name} registered`);
      setAdding(false); setName('');
    } catch (e) { setError(e.message); }
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="fg">
        <label>Supplier<select value={sid || ''} onChange={(e) => { const s = sups.find((x) => String(x.id) === e.target.value); set({ supplierId: e.target.value, supplier: s ? s.name : '', lpoId: '', onCredit: allowCredit && !!s && s.terms !== 'cash' }); }}>
          <option value="">Choose or register…</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}{s.terms !== 'cash' ? ` (${s.termsLabel})` : ''}</option>)}</select></label>
        {!sid && <div><label>Shop name<input value={value.supplier || ''} maxLength={120} onChange={(e) => set({ supplier: e.target.value })} placeholder="e.g. NYANZA STATIONERY" /></label>
          <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => { setName(value.supplier || ''); setAdding(true); }}><Icon name="plus" /> Register this name</button></div>}
        {allowLpo && sid && <label>From an LPO<select value={value.lpoId || ''} onChange={(e) => { const l = lpos.find((x) => String(x.id) === e.target.value); set({ lpoId: e.target.value, onCredit: l ? l.terms !== 'cash' : value.onCredit }); }}>
          <option value="">{lpos.length ? 'No LPO' : 'No authorised LPO'}</option>{lpos.map((l) => <option key={l.id} value={l.id}>{l.number}{l.total != null ? ` · TSh ${tsh(l.total)}` : ''}</option>)}</select></label>}
      </div>
      {allowCredit && sid && (
        <label style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'flex-start' }}><input type="checkbox" checked={!!value.onCredit} onChange={(e) => set({ onCredit: e.target.checked })} style={{ width: 'auto' }} />
          <span>On credit: the supplier is paid later{sup ? ` (${sup.termsLabel}${sup.termsNote ? `: ${sup.termsNote}` : ''})` : ''}</span></label>
      )}
      {adding && <Modal title="Register supplier" onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn p" disabled={name.trim().length < 3} onClick={register}>Register and select</button></>}>
        <label>Supplier name<input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value.toUpperCase())} placeholder="e.g. NYANZA STATIONERY" /></label>
        <ErrorNote error={error} />
      </Modal>}
    </div>
  );
}
