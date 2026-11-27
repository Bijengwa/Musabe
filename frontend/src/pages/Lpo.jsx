// LPO — Local Purchase Order, as on the paper (book No. 0651): To; Our Ref; Ship to; Date; SL No. | Description | Unit | Rate | Amount;
// Total; Prepared by, Certified by, Authorised by. Prepared by the procurement, certified by the Head of Accounts (Accountant),
// authorised by the Manager (the Finance Manager when he is away). Each signs with his PIN.
import { useCallback, useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { useSchools } from '../layout/scope';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, PageHead, Panel, tsh, useToast, DetailSkeleton, Loading } from '../components/ui';
import { todayStr } from '../components/common';
import { PrintButton } from '../components/barcode';
import { PinBox, SealBadge, SealQR } from '../components/signing';
import { fmtDate } from '../components/paper';
import { inWords } from '../components/words';
import './requisition.css';

const TONE = { certify: 'warn', authorise: 'warn', authorised: 'info', delivered: 'ok', rejected: 'bad', cancelled: '' };
const TERMS = [['cash', 'Cash'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['other', 'Other']];
const digits = (v) => String(v ?? '').replace(/\D/g, '');
const money = (n) => (n == null ? '' : tsh(n));

export default function Lpo() {
  return (
    <Routes>
      <Route index element={<LpoList />} />
      <Route path="new" element={<LpoPage />} />
      <Route path=":id" element={<LpoPage />} />
    </Routes>
  );
}

function LpoList() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get(`/lpos${status ? `?status=${status}` : ''}`).then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message)), [status]);
  useEffect(() => { load(); }, [load]);
  useLive(['lpo', 'purchase'], load);
  const mine = (d?.lpos || []).filter((l) => l.turn);
  return (
    <>
      <PageHead title="LPO (Local Purchase Orders)" sub="Ordering materials from a supplier. Prepared by procurement, certified by the Head of Accounts, authorised by the Manager.">
        <ExcelButton href="/api/lpos/export.xlsx" />
        {d?.canWrite && <Link className="btn p" to="/lpo/new"><Icon name="plus" /> New LPO</Link>}
      </PageHead>
      <ErrorNote error={error} />
      {d && <div className="kpis">
        <Kpi tone={mine.length ? 'warn' : 'ok'} label="Waiting for you" value={mine.length} />
        <Kpi label="To certify / authorise" value={d.lpos.filter((l) => ['certify', 'authorise'].includes(l.status)).length} />
        <Kpi label="Authorised: goods to come" value={d.lpos.filter((l) => l.status === 'authorised').length} />
      </div>}
      <div className="filters"><div className="seg">{[['', 'All'], ['open', 'Open'], ['delivered', 'Goods received'], ['rejected', 'Rejected']].map(([k, t]) =>
        <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t}</button>)}</div></div>
      <Panel flush>
        {!d ? <Loading /> : !d.lpos.length ? <Empty icon="receipt" title="No LPO yet"
          steps={['Procurement prepares an LPO for a supplier.', 'The Head of Accounts certifies it.', 'The Manager authorises it, and the goods can be ordered.', 'When the goods arrive, mark them received.']}
          action={d.canWrite && <Link className="btn p" to="/lpo/new"><Icon name="plus" /> New LPO</Link>} /> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th>LPO No.</th><th>Date</th><th className="stick">To (supplier)</th><th>Ship to</th><th>Items</th><th className="n">Total (TSh)</th><th>Terms</th><th>Status</th></tr></thead>
            <tbody>{d.lpos.map((l) => (
              <tr key={l.id} className="clickrow" onClick={() => navigate(`/lpo/${l.id}`)}>
                <td className="mono small">{l.number}</td><td className="nowrap small">{fmtDate(l.preparedAt).slice(0, 11)}</td>
                <td className="stick"><b>{l.supplier.name}</b></td><td className="small">{l.shipTo}</td>
                <td className="small">{l.lines.slice(0, 3).map((x) => `${x.qty} ${x.unit || ''} ${x.description}`).join(', ')}{l.lines.length > 3 ? ` +${l.lines.length - 3}` : ''}</td>
                <td className="n"><b>{l.total != null ? tsh(l.total) : <span className="muted">rates to fill</span>}</b></td><td>{l.termsLabel}</td>
                <td><span className={`pill wrap ${TONE[l.status]}`}>{l.statusLabel}</span>{l.turn && <span className="pill warn sm" style={{ marginLeft: 6 }}>Your turn</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}

function Sig({ label, sign, hint, children }) {
  return (
    <div className="rq-sig">
      <div className="rq-sigline">{sign ? (sign.image ? <img className="rq-sigimg" src={sign.image} alt="" /> : <span className="rq-ink">{sign.by}</span>) : children}</div>
      <b>{label}</b>
      {(sign || hint) && <span className="who">{sign ? sign.by : hint}</span>}
      <span className="dt">Date: {sign?.at ? fmtDate(sign.at) : '......./......./20....'}</span>
    </div>
  );
}

// The paper itself (also what is printed).
function Sheet({ l, editor, rateBox }) {
  const lines = l.lines;
  return (
    <div className="rq-sheet">
      <div className="rq-top"><img src="/musabe-logo.png" alt="" /><div><h2 style={{ margin: 0 }}>MUSABE SCHOOLS</h2>
        <small>P. O. Box 5154, BUGANDO, MWANZA, TEL: +255 782 110494, +255 754 654545, +255 769 197 221</small><small>Email: musabeschools@yahoo.co.uk</small></div></div>
      <div className="rq-title">Local Purchase Order</div>
      <div className="rq-line"><span className="rq-no">No. <b style={{ color: '#c01818' }}>{l.number || '……'}</b></span><span className="rq-field" style={{ flex: '0 1 260px' }}><span>Date</span><span className="rq-val">{fmtDate(l.preparedAt || new Date()).slice(0, 11)}</span></span></div>
      {editor ? editor.top : <>
        <div className="rq-line"><span className="rq-field"><span>To</span><b>{l.supplier.name}{l.supplier.place ? `, ${l.supplier.place}` : ''}</b></span></div>
        <div className="rq-line"><span className="rq-field"><span>Our Ref</span><b>{l.ourRef || ''}</b></span><span className="rq-field"><span>Ship to</span><b>{l.shipTo}</b></span></div>
      </>}
      <div className="tw"><table className="rq-t">
        <thead><tr><th style={{ width: 54 }}>SL No.</th><th>Description</th><th style={{ width: 110 }}>Unit</th><th className="n" style={{ width: 130 }}>Rate</th><th className="n" style={{ width: 150 }}>Amount</th>{editor && <th style={{ width: 34 }} />}</tr></thead>
        <tbody>{editor ? editor.rows : lines.map((x, i) => (
          <tr key={x.id}><td className="c">{i + 1}</td><td>{x.description}</td><td>{x.qty} {x.unit || ''}</td>
            <td className="n">{x.rate == null && rateBox ? rateBox(x) : money(x.rate)}</td><td className="n">{money(x.amount)}</td></tr>
        ))}
        {!editor && lines.length < 8 && Array.from({ length: 8 - lines.length }, (_, i) => <tr key={`e${i}`}><td className="c">{lines.length + i + 1}</td><td /><td /><td /><td /></tr>)}</tbody>
        <tfoot><tr><td colSpan={4} className="r"><b>Total</b></td><td className="n"><b>{money(editor ? editor.total : l.total)}</b></td>{editor && <td />}</tr></tfoot>
      </table></div>
      {!editor && l.total != null && <p className="rq-small" style={{ margin: '6px 0 0' }}>Amount in words: <b>{inWords(l.total)}</b></p>}
      {!editor && <p className="rq-small" style={{ margin: '6px 0 0' }}>Terms of payment: <b>{l.termsLabel}</b>{l.deliverBy ? ` · Deliver by ${l.deliverBy}` : ''}{l.priceList ? ` · Prices from ${l.priceList.number}` : ''}{l.note ? ` · ${l.note}` : ''}</p>}
      {editor ? editor.signs : (
        <div className="rq-signs">
          <Sig label="Prepared by (Procurement)" sign={l.signs.prepared} />
          <Sig label="Certified by (Head of Accounts)" sign={l.signs.certified} hint={l.status === 'certify' ? 'waiting' : ''}>{l.signHere?.('certify')}</Sig>
          <Sig label={`Authorised by (${l.authorisedAs || 'Manager / Finance Manager'})`} sign={l.signs.authorised} hint={l.status === 'authorise' ? 'waiting' : ''}>{l.signHere?.('authorise')}</Sig>
        </div>
      )}
    </div>
  );
}

const blank = () => ({ k: Math.random(), description: '', unit: '', qty: '', rate: '' });

function LpoPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const schools = useSchools();
  const [l, setL] = useState(null);
  const [error, setError] = useState('');
  const [ask, setAsk] = useState(null);
  const [note, setNote] = useState('');
  const [rates, setRates] = useState({});
  // new LPO
  const [sups, setSups] = useState([]);
  const [lists, setLists] = useState([]);
  const [f, setF] = useState({ supplierId: '', schoolId: '', ourRef: '', terms: '', deliverBy: '', priceListId: '', note: '' });
  const [rows, setRows] = useState(() => Array.from({ length: 5 }, blank));
  const load = useCallback(() => (id ? api.get(`/lpos/${id}`).then((x) => { setL(x.lpo); setError(''); }).catch((e) => setError(e.message)) : Promise.resolve()), [id]);
  useEffect(() => { load(); }, [load]);
  useLive(['lpo'], load);
  useEffect(() => { if (!id) api.get('/suppliers').then((d) => setSups(d.suppliers)).catch((e) => setError(e.message)); }, [id]);
  useEffect(() => { if (!id && f.supplierId) api.get(`/suppliers/price-lists/pick?supplier=${f.supplierId}`).then((d) => setLists(d.priceLists)).catch(() => {}); }, [id, f.supplierId]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setRow = (k, key, v) => setRows((rs) => rs.map((r) => (r.k === k ? { ...r, [key]: v } : r)));

  if (!id) {
    const sup = sups.find((s) => String(s.id) === f.supplierId);
    const used = rows.filter((r) => r.description.trim() || r.qty || r.rate);
    const total = used.length && used.every((r) => r.rate !== '' && r.qty) ? used.reduce((s, r) => s + Number(r.qty) * Number(r.rate), 0) : null;
    const fill = (pl) => { setF((x) => ({ ...x, priceListId: String(pl.id) })); setRows([...pl.lines.map((x) => ({ k: Math.random(), description: x.item, unit: x.unit || '', qty: '', rate: String(x.price) })), blank()]); };
    const save = async (cred) => {
      const d = await api.post('/lpos', { ...f, supplierId: Number(f.supplierId), schoolId: Number(f.schoolId) || undefined, priceListId: Number(f.priceListId) || undefined, terms: f.terms || undefined,
        lines: used.map((r) => ({ description: r.description, unit: r.unit, qty: r.qty, rate: r.rate })), ...cred });
      toast(`${d.lpo.number} sent to the Head of Accounts`); navigate(`/lpo/${d.lpo.id}`, { replace: true });
    };
    const editor = {
      top: <>
        <div className="rq-line"><label className="rq-field"><span>To</span><select value={f.supplierId} onChange={(e) => { set('supplierId', e.target.value); set('priceListId', ''); }} style={{ flex: 1 }}><option value="">Choose the supplier…</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
        <div className="rq-line"><label className="rq-field"><span>Our Ref</span><input value={f.ourRef} maxLength={40} onChange={(e) => set('ourRef', e.target.value)} placeholder="e.g. RQN.0012" /></label>
          <label className="rq-field"><span>Ship to</span><select value={f.schoolId} onChange={(e) => set('schoolId', e.target.value)} style={{ flex: 1 }}><option value="">Administration office</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
      </>,
      rows: [...used.length ? rows : rows].map((r, i) => (
        <tr key={r.k}><td className="c">{i + 1}</td>
          <td><input value={r.description} maxLength={200} onChange={(e) => setRow(r.k, 'description', e.target.value)} aria-label={`Description ${i + 1}`} /></td>
          <td><div className="row nowrap" style={{ gap: 4 }}><input className="n" style={{ width: 52 }} inputMode="numeric" placeholder="qty" value={r.qty} onChange={(e) => setRow(r.k, 'qty', digits(e.target.value))} aria-label={`Quantity ${i + 1}`} /><input style={{ width: 52 }} placeholder="bags" value={r.unit} maxLength={20} onChange={(e) => setRow(r.k, 'unit', e.target.value)} aria-label={`Unit ${i + 1}`} /></div></td>
          <td><input className="n" inputMode="numeric" value={r.rate} placeholder="or empty" onChange={(e) => setRow(r.k, 'rate', digits(e.target.value))} aria-label={`Rate ${i + 1}`} /></td>
          <td className="n">{r.qty && r.rate !== '' ? tsh(Number(r.qty) * Number(r.rate)) : ''}</td>
          <td className="c"><button type="button" className="iconbtn" onClick={() => setRows((rs) => rs.filter((x) => x.k !== r.k))} aria-label="Remove"><Icon name="x" /></button></td></tr>
      )),
      total,
      signs: <div className="rq-signs"><Sig label="Prepared by (Procurement)" hint="signed when you send it" /><Sig label="Certified by (Head of Accounts)" /><Sig label="Authorised by (Manager)" /></div>,
    };
    return (
      <div className="rq-wrap">
        <div className="rq-bar"><Link to="/lpo" className="btn sm">← All LPOs</Link><h2 style={{ margin: 0 }}>New LPO</h2></div>
        {lists.length > 0 && <div className="rq-note info small">Price lists from this supplier: {lists.map((pl) => <button key={pl.id} type="button" className="linkbtn" onClick={() => fill(pl)}>{pl.number} ({pl.kindLabel}{pl.expired ? ', expired' : ''})</button>).reduce((a, b) => [a, ' · ', b])} — press one to fill the lines with its prices.</div>}
        <Sheet l={{ lines: [] }} editor={editor} />
        <div><button type="button" className="btn sm" onClick={() => setRows((rs) => [...rs, blank(), blank()])}><Icon name="plus" /> More lines</button></div>
        <div className="rq-actions">
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <label>Terms of payment<select value={f.terms} onChange={(e) => set('terms', e.target.value)}><option value="">As agreed with the supplier{sup ? ` (${sup.termsLabel})` : ''}</option>{TERMS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
            <label>Deliver by<input type="date" min={todayStr()} value={f.deliverBy} onChange={(e) => set('deliverBy', e.target.value)} /></label>
            <label style={{ flex: 1 }}>Note<input value={f.note} maxLength={300} onChange={(e) => set('note', e.target.value)} /></label>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Write each line: description, quantity and unit. The rate can stay empty for the supplier to fill. It goes to the Head of Accounts, then the Manager.</p>
          <ErrorNote error={error} />
          <div className="row"><button className="btn p" disabled={!f.supplierId || !used.length || used.some((r) => !r.description.trim() || !r.qty)} onClick={() => setAsk({ title: 'Sign the LPO', call: save })}>Sign and send</button></div>
        </div>
        {ask && <PinBox type="lpo" id={0} title={ask.title} onCancel={() => setAsk(null)} onConfirm={async (cred) => { await ask.call(cred); setAsk(null); }} />}
      </div>
    );
  }

  if (!l) return <div className="rq-wrap"><Link to="/lpo" className="btn sm">← All LPOs</Link><ErrorNote error={error} />{!error && <DetailSkeleton />}</div>;
  const post = async (which, approve, cred = {}) => {
    await api.post(`/lpos/${l.id}/${which}`, { approve, note, lines: Object.entries(rates).map(([lineId, rate]) => ({ lineId: Number(lineId), rate })), ...cred });
    toast(`${l.number} ${approve ? 'signed' : 'rejected'}`); setNote(''); setRates({}); await load();
  };
  const step = async (which, approve, cred) => {
    if (approve) return post(which, true, cred);   // inside the PIN box: an error shows there
    try { await post(which, false); } catch (e) { setError(e.message); }
    return null;
  };
  const view = { ...l, signHere: (which) => (l.turn === which ? <button className="btn p sm" onClick={() => setAsk({ title: `Sign ${l.number}`, call: (cred) => step(which, true, cred) })}>Sign here</button> : null) };
  const rateBox = l.turn === 'certify' ? (x) => <input className="n fill" inputMode="numeric" placeholder="fill" value={rates[x.id] ?? ''} onChange={(e) => setRates((r) => ({ ...r, [x.id]: digits(e.target.value) }))} aria-label={`Rate of ${x.description}`} /> : null;
  return (
    <div className="rq-wrap">
      <div className="rq-bar"><Link to="/lpo" className="btn sm">← All LPOs</Link><span className={`pill ${TONE[l.status]}`}>{l.statusLabel}</span><SealBadge seal={l.seal} /><span className="grow" />
        <PrintButton className="btn" label="Print LPO"><Sheet l={l} /></PrintButton></div>
      {l.rejected && <p className="rq-note bad"><b>{l.status === 'cancelled' ? 'Cancelled' : 'Rejected'} by {l.rejected.by}</b> on {fmtDate(l.rejected.at)}: {l.rejected.reason}</p>}
      {l.purchases.length > 0 && <p className="rq-note info">Goods received on {l.purchases.map((p) => <Link key={p.id} to={`/purchases/form/${p.id}`}>{p.number}</Link>).reduce((a, b) => [a, ', ', b])}</p>}
      {l.status === 'authorised' && <p className="rq-note info">Authorised: print it and give it to the supplier. When the goods come, write the purchase and choose this LPO.</p>}
      <Sheet l={view} rateBox={rateBox} />
      <SealQR type="lpo" id={l.id} seal={l.seal} />
      {(l.turn || l.canCancel) && (
        <div className="rq-actions">
          <ErrorNote error={error} />
          {l.turn === 'certify' && !l.complete && <p className="small muted" style={{ margin: 0 }}>Yellow boxes: rates left empty. Fill them from the proforma if you have it, or leave them for the supplier.</p>}
          <label>Note (needed to reject or cancel)<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="row">
            {l.turn && <button className="btn danger" disabled={note.trim().length < 5} onClick={() => step(l.turn, false)}>Reject</button>}
            {l.canCancel && <button className="btn" disabled={note.trim().length < 5} onClick={async () => { try { await api.post(`/lpos/${l.id}/cancel`, { note }); toast('Cancelled'); await load(); } catch (e) { setError(e.message); } }}>Cancel the LPO</button>}
          </div>
        </div>
      )}
      {ask && <PinBox type="lpo" id={l.id} title={ask.title} onCancel={() => setAsk(null)} onConfirm={async (cred) => { await ask.call(cred); setAsk(null); }} />}
    </div>
  );
}
