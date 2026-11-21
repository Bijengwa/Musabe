// Order Book (2026-11-20) = the paper "ORDER" each place keeps (school library, school store, academic office, kitchen...).
// Laid out like the paper: school header, ORDER No. in red, M/s (to whom), Date, "Please supply following goods",
// QTY / PARTICULARS, "Please quote our order number on your invoice", Name and Signature.
//   (teachers ask the Academic Master by word; old teacher orders still show the Academic Master step)
//   Academic Master -> store-keeper
//   librarian / School Store-keeper -> Head Master -> Manager -> store-keeper
//   Head Master -> Manager -> store-keeper
// The store-keeper (or the Assistant Manager) writes the payment requisition from it, or rejects it with a reason.
import { useCallback, useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, PageHead, Panel, SchoolPill, fmtWhen, useToast } from '../components/ui';
import { todayStr, useSchoolQs } from '../components/common';
import { fmtDate } from '../components/paper';
import './requisition.css';

const TONE = { acad: 'warn', head: 'warn', manager: 'warn', keeper: 'info', given: 'ok', requisition: 'ok', rejected: 'bad', withdrawn: '' };
const PLACE_OF = { acad: 'academic', librarian: 'library', sstore: 'store', patron: 'dormitory', head: 'office' };
const FIRST = { acad: 'store-keeper', librarian: 'Head Master', sstore: 'Head Master', patron: 'Head Master', head: 'Manager' };
const qtyText = (l) => `${l.approvedQty ?? l.qty ?? ''}${l.unit ? ` ${l.unit}` : ''}`.trim();

export default function Orders() {
  return (
    <Routes>
      <Route index element={<OList />} />
      <Route path="new" element={<NewOrder />} />
      <Route path=":id" element={<OPage />} />
    </Routes>
  );
}

function OList() {
  const school = useSchoolQs();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const p = new URLSearchParams();
  if (status && status !== 'mine') p.set('status', status);
  if (school) p.set('school', school);
  const qs = p.toString();
  const load = useCallback(() => api.get(`/orders?${qs}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [qs]);
  useEffect(() => { load(); }, [load]);
  useLive(['order', 'requisition'], load);
  const all = data?.orders || [];
  const rows = status === 'mine' ? all.filter((o) => o.turn && o.turn !== 'withdraw') : all;
  const tabs = [['', 'All'], ['mine', `Waiting for you${data?.mine ? ` (${data.mine})` : ''}`], ['open', 'On the way'], ['requisition', 'Requisition written'], ['given', 'Given'], ['rejected', 'Rejected']];
  return (
    <>
      <PageHead title="Order Book" sub="Ask for what your place needs, as in the paper Order Book. The Academic Master orders straight from the store-keeper; the School Store-keeper and the Patron through the Head Master; the library through the Head Master and the Manager. (A teacher just asks the Academic Master.)">
        <ExcelButton href={`/api/orders/export.xlsx?${qs}`} />
        {data?.canWrite && <Link className="btn p" to="/orders/new"><Icon name="plus" /> New order</Link>}
      </PageHead>
      {data && <div className="kpis"><Kpi tone={data.mine ? 'warn' : 'ok'} label="Waiting for you" value={data.mine} /><Kpi tone="info" label="On the way" value={all.filter((o) => ['acad', 'head', 'manager', 'keeper'].includes(o.status)).length} /></div>}
      <div className="filters"><div className="seg">{tabs.map(([k, t]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t}</button>)}</div></div>
      <ErrorNote error={error} />
      <Panel flush>
        {!data ? <Empty>Loading…</Empty> : !rows.length ? <Empty>Nothing here.</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th>No.</th><th>School</th><th className="stick">Particulars</th><th>Ordered by</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((o) => (
              <tr key={o.id} onClick={() => navigate(`/orders/${o.id}`)} style={{ cursor: 'pointer' }}>
                <td className="mono small">{o.number}<div className="muted">{fmtWhen(o.writtenAt)}</div></td>
                <td><SchoolPill code={o.code} name={o.school} /><div className="small muted">{o.placeLabel}</div></td>
                <td className="stick small" style={{ maxWidth: 260 }}>{o.lines.slice(0, 3).map((l) => `${qtyText(l)} ${l.particulars}`.trim()).join(', ')}{o.lines.length > 3 ? ` +${o.lines.length - 3}` : ''}</td>
                <td className="small">{o.writer}<div className="muted">{o.writerRole}</div></td>
                <td><span className={`pill ${TONE[o.status]}`}>{o.statusLabel}</span>{o.requisition && <div className="small muted">{o.requisition.number}</div>}</td>
                <td><Link className={`btn sm${o.turn && o.turn !== 'withdraw' ? ' p' : ''}`} to={`/orders/${o.id}`} onClick={(e) => e.stopPropagation()}>{o.turn && o.turn !== 'withdraw' ? 'Answer' : 'Open'}</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}

// The paper itself (reading and writing).
function Sheet({ o, user, rows, setRows, place, setPlace, placeName, setPlaceName, places, give, setGive, canCut }) {
  const write = !o;
  const set = (k, f, v) => setRows((x) => x.map((y) => (y.key === k ? { ...y, [f]: v } : y)));
  const schoolName = o ? o.schoolName : user.school?.name || '';
  const pad = write ? rows : [...o.lines];
  while (!write && pad.length < 8) pad.push(null);
  return (
    <div className="rq-sheet">
      <div className="rq-top"><img src="/musabe-logo.png" alt="" /><div><h2>{(schoolName || 'MUSABE SCHOOLS').toUpperCase()}</h2>
        <small>P. O. Box 5154, BUGANDO, MWANZA</small></div></div>
      <div className="rq-title">Order{o ? ` · ${o.placeLabel}` : ''}</div>
      <div className="rq-line"><span className="rq-no">No. <b>{o?.number || '……'}</b></span><span className="rq-field" style={{ flex: '0 1 260px' }}><span>Date</span><span className="rq-val">{fmtDate(o?.writtenAt || new Date()).slice(0, 11)}</span></span></div>
      <div className="rq-line"><span className="rq-field"><span>M/s</span><span className="rq-val">{o ? o.to : FIRST[user.role] === 'store-keeper' ? 'Store-keeper' : FIRST[user.role] === 'Academic Master' ? 'Academic Master' : 'Store-keeper'}</span></span></div>
      {write && (
        <div className="rq-line">
          <label className="rq-field"><span>Place</span><select value={place} onChange={(e) => setPlace(e.target.value)} style={{ border: 0, borderBottom: '1.5px dotted #2745a8', flex: 1, fontSize: 16, fontWeight: 600 }}>
            {Object.entries(places).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
          <label className="rq-field"><span>Name of the place (not required)</span><input value={placeName} maxLength={80} placeholder="e.g. Boys Kitchen" onChange={(e) => setPlaceName(e.target.value)} /></label>
        </div>
      )}
      <p style={{ margin: '10px 0 0', fontStyle: 'italic', color: '#1b3fa0' }}>Please supply following goods</p>
      <div className="tw"><table className="rq-t">
        <thead><tr><th style={{ width: 150 }}>Qty</th><th>Particulars</th>{canCut && <th style={{ width: 120 }}>Give</th>}{write && <th style={{ width: 34 }} />}</tr></thead>
        <tbody>{pad.map((l, i) => (write ? (
          <tr key={l.key}>
            <td><div style={{ display: 'flex', gap: 4 }}><input className="n" inputMode="numeric" value={l.qty} onChange={(e) => set(l.key, 'qty', e.target.value.replace(/\D/g, ''))} aria-label={`Quantity ${i + 1}`} style={{ width: 60 }} />
              <input value={l.unit} maxLength={20} placeholder="kg / pcs" onChange={(e) => set(l.key, 'unit', e.target.value)} aria-label={`Unit ${i + 1}`} /></div></td>
            <td><input value={l.particulars} maxLength={200} onChange={(e) => set(l.key, 'particulars', e.target.value)} aria-label={`Particulars ${i + 1}`} /></td>
            <td className="c">{rows.length > 1 && <button type="button" className="iconbtn" onClick={() => setRows((rs) => rs.filter((y) => y.key !== l.key))} aria-label="Remove the line"><Icon name="x" /></button>}</td>
          </tr>
        ) : l ? (
          <tr key={l.id}>
            <td className="c" style={{ width: 150 }}>{l.approvedQty != null && l.approvedQty !== l.qty ? <><s>{l.qty}</s> {qtyText(l)}</> : qtyText(l)}</td>
            <td>{l.particulars}</td>
            {canCut && <td>{l.qty != null && <input className="n" inputMode="numeric" value={give[l.id] ?? String(l.approvedQty ?? l.qty)} onChange={(e) => setGive((g) => ({ ...g, [l.id]: e.target.value.replace(/\D/g, '') }))} aria-label={`Give ${l.particulars}`} />}</td>}
          </tr>
        ) : <tr key={`p${i}`}><td /><td />{canCut && <td />}</tr>))}</tbody>
      </table></div>
      {write && <div style={{ marginTop: 6 }}><button type="button" className="btn sm" onClick={() => setRows((rs) => [...rs, blank(), blank()])}><Icon name="plus" /> More lines</button></div>}
      <p className="rq-small" style={{ marginTop: 10 }}>Please quote our order number on your invoice.</p>
      <div className="rq-signs">
        <Sig label="Name and signature" sign={o ? { by: o.writer, at: o.writtenAt } : null} hint="signed when you send it" />
        {o?.writerRole === 'Subject Teacher' ? <Sig label="Academic Master" sign={o.signs.acad} />
          : o && ['Librarian', 'School Store-keeper', 'Patron / Matron'].includes(o.writerRole) ? <Sig label="Approved by Head Master" sign={o.signs.head} /> : <div />}
        {o && ['Librarian', 'Head Master'].includes(o.writerRole) ? <Sig label="Approved by Manager" sign={o.signs.manager} /> : <div />}
      </div>
    </div>
  );
}
const blank = () => ({ key: Math.random().toString(36).slice(2), qty: '', unit: '', particulars: '' });
function Sig({ label, sign, hint }) {
  return (
    <div className="rq-sig">
      <div className="rq-sigline">{sign && <span className="rq-ink">{sign.by}</span>}</div>
      <b>{label}</b><span className="who">{sign ? sign.by : hint || ''}</span>
      <span className="dt">Date: {sign?.at ? fmtDate(sign.at) : '......./......./20....'}</span>
    </div>
  );
}

function NewOrder() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState(() => Array.from({ length: 8 }, blank));
  const [place, setPlace] = useState(PLACE_OF[user.role] || 'other');
  const [placeName, setPlaceName] = useState('');
  const [needed, setNeeded] = useState('');
  const [note, setNote] = useState('');
  const [places, setPlaces] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/orders?status=open').then((d) => setPlaces(d.places)).catch((e) => setError(e.message)); }, []);
  const used = rows.filter((x) => x.particulars.trim() || x.qty);
  const bad = !used.length || used.some((x) => x.particulars.trim().length < 2);
  const send = async () => {
    setBusy(true); setError('');
    try {
      const d = await api.post('/orders', { place, placeName, neededBy: needed || null, note, lines: used.map((x) => ({ qty: x.qty ? Number(x.qty) : null, unit: x.unit, particulars: x.particulars })) });
      toast(`${d.order.number} sent to the ${FIRST[user.role]}`); navigate(`/orders/${d.order.id}`, { replace: true });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="rq-wrap">
      <div className="rq-bar"><Link to="/orders" className="btn sm">← Order Book</Link><h2 style={{ margin: 0 }}>New order</h2></div>
      <Sheet user={user} rows={rows} setRows={setRows} place={place} setPlace={setPlace} placeName={placeName} setPlaceName={setPlaceName} places={places} />
      <div className="rq-actions">
        <div className="row"><label>Needed by (not required)<input type="date" min={todayStr()} value={needed} onChange={(e) => setNeeded(e.target.value)} style={{ maxWidth: 220 }} /></label>
          <label style={{ flex: 1 }}>Note (not required)<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label></div>
        <p className="small muted" style={{ margin: 0 }}>Write it as in the paper book: the quantity with its unit (kg, L, pcs) and what you want. It goes to the {FIRST[user.role]}.</p>
        <ErrorNote error={error} />
        <div className="row"><button className="btn p" disabled={busy || bad} onClick={send}>Sign and send</button><Link to="/orders" className="btn">Cancel</Link></div>
      </div>
    </div>
  );
}

function OPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [o, setO] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [give, setGive] = useState({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get(`/orders/${id}`).then((d) => { setO(d.order); setError(''); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  useLive(['order', 'requisition'], load);
  if (!o) return <div className="rq-wrap"><Link to="/orders" className="btn sm">← Order Book</Link><ErrorNote error={error} />{!error && <Empty>Loading…</Empty>}</div>;
  const t = o.turn;
  const canCut = ['acad', 'head', 'manager'].includes(t);
  const lines = () => Object.entries(give).filter(([, v]) => v !== '').map(([lineId, v]) => ({ lineId: Number(lineId), qty: Number(v) }));
  const run = async (path, body, msg) => { setBusy(true); setError(''); try { await api.post(`/orders/${o.id}/${path}`, body); toast(msg); setNote(''); setGive({}); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return (
    <div className="rq-wrap">
      <div className="rq-bar"><Link to="/orders" className="btn sm">← Order Book</Link><span className={`pill ${TONE[o.status]}`}>{o.statusLabel}</span>
        {o.requisition && <Link className="btn sm" to={`/requisitions/${o.requisition.id}`}>Requisition {o.requisition.number}</Link>}</div>
      {o.rejected && <p className="rq-note bad"><b>Rejected by {o.rejected.by}:</b> {o.rejected.reason}</p>}
      {o.note && <p className="rq-note info"><b>Note:</b> {o.note}{o.neededBy ? ` · needed by ${o.neededBy}` : ''}</p>}
      <Sheet o={o} user={user} canCut={canCut} give={give} setGive={setGive} />
      <div className="rq-actions">
        <ErrorNote error={error} />
        {t === 'acad' && (
          <>
            <p className="small muted" style={{ margin: 0 }}>Give it from what you keep (you may give fewer), send it on to the store-keeper to buy, or reject it with a reason.</p>
            <input value={note} maxLength={300} placeholder="Note (needed to reject)" onChange={(e) => setNote(e.target.value)} />
            <div className="row">
              <button className="btn p" disabled={busy} onClick={() => run('acad', { action: 'give', note, lines: lines() }, `${o.number}: given`)}>I gave it</button>
              <button className="btn" disabled={busy} onClick={() => run('acad', { action: 'forward', note, lines: lines() }, `${o.number}: sent to the store-keeper`)}>Send on to the store-keeper</button>
              <button className="btn bad" disabled={busy || !note.trim()} onClick={() => run('acad', { action: 'reject', note }, `${o.number}: rejected`)}>Reject</button>
            </div>
          </>
        )}
        {(t === 'head' || t === 'manager') && (
          <>
            <input value={note} maxLength={300} placeholder="Note (needed to reject)" onChange={(e) => setNote(e.target.value)} />
            <div className="row">
              <button className="btn p" disabled={busy} onClick={() => run(t, { approve: true, note, lines: lines() }, `${o.number}: approved`)}>Approve{t === 'head' ? ' (goes to the Manager)' : ' (goes to the store-keeper)'}</button>
              <button className="btn bad" disabled={busy || !note.trim()} onClick={() => run(t, { approve: false, note }, `${o.number}: rejected`)}>Reject</button>
            </div>
          </>
        )}
        {t === 'keeper' && (
          <>
            <p className="small muted" style={{ margin: 0 }}>Ask the shop for a price list or proforma invoice, then write the payment requisition from this order. Or reject it with a reason.</p>
            <div className="row">
              <button className="btn p" onClick={() => navigate(`/requisitions/new?order=${o.id}`)}><Icon name="file" /> Write the requisition</button>
              <input value={note} maxLength={300} placeholder="Why it cannot be supplied" onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
              <button className="btn bad" disabled={busy || !note.trim()} onClick={() => run('keeper', { note }, `${o.number}: rejected`)}>Reject</button>
            </div>
          </>
        )}
        {t === 'withdraw' && <div className="row"><button className="btn" disabled={busy} onClick={() => run('withdraw', {}, `${o.number}: withdrawn`)}>Withdraw</button></div>}
        <div className="row"><button className="btn sm" onClick={() => window.print()}><Icon name="file" /> Print</button></div>
      </div>
    </div>
  );
}
