/* eslint-disable react-refresh/only-export-components */
// School requisitions = the paper "PAYMENT REQUISITION FORM" (see ./requisition.css). It opens on its own page, laid out like the paper.
//   Lessons stationery (every teacher asks through the Academic Master, who works with the librarian: what is left, what was used):
//     staff -> Academic Master -> Head Master -> administration store-keeper -> Manager -> the Cashier gives the money / the store-keeper buys.
//   Everything else (patron, cleaners... through the School Store-keeper): the School Store-keeper -> Head Master -> the same.
// Only the APPLICANT changes the words. A signer changes a quantity, or sends it back to the applicant to correct.
import { useCallback, useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSchools } from '../layout/scope';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, PageHead, Panel, SchoolPill, fmtWhen, tsh, useToast } from '../components/ui';
import { todayStr, useSchoolQs } from '../components/common';
import { PrintButton } from '../components/barcode';
import { PinBox, SealBadge, SealQR, verifyUrl } from '../components/signing';
import { Paper, fmtDate } from '../components/paper';
import './requisition.css';

const TONE = { acad: 'warn', head: 'warn', store: 'warn', check: 'warn', manager: 'warn', approved: 'info', buying: 'info', arrived: 'info', sent: 'info', done: 'ok', rejected: 'bad', withdrawn: '' };
const STOCK_ROLES = ['acad', 'sstore', 'librarian', 'head'];
// "" (empty) is a real value: nothing written. A number is a whole number of shillings / pieces.
const num = (v) => (String(v ?? '').trim() === '' ? null : Number(String(v).replace(/\D/g, '')));
const money = (n) => (n == null ? '' : tsh(n));
const digits = (v) => String(v ?? '').replace(/\D/g, '');

export default function Requisitions() {
  return (
    <Routes>
      <Route index element={<RList />} />
      <Route path="new" element={<Page />} />
      <Route path=":id" element={<Page />} />
    </Routes>
  );
}

function RList() {
  const school = useSchoolQs();
  const { user } = useAuth();
  const navigate = useNavigate();
  const admin = user.scope === 'all';
  // Always starts on ALL. "Waiting for you" is its own view (cards).
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const p = new URLSearchParams();
  if (status) p.set('status', status === 'mine' ? 'open' : status);
  if (school) p.set('school', school);
  const qs = p.toString();
  const load = useCallback(() => api.get(`/requisitions?${qs}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [qs]);
  useEffect(() => { load(); }, [load]);
  useLive(['requisition', 'purchase', 'delivery', 'payment'], load);
  const mine = (data?.requisitions || []).filter((r) => r.turn && r.turn !== 'withdraw');
  const rows = status === 'mine' ? mine : data?.requisitions || [];
  const tabs = [['', 'All'], ['mine', `Waiting for you${data?.mine ? ` (${data.mine})` : ''}`], ['open', 'On the way'], admin && ['admin', 'With administration'], admin && ['money', 'Money given'], ['done', 'Received'], ['rejected', 'Rejected']].filter(Boolean);
  return (
    <>
      <PageHead title="Payment requisitions" sub="The paper form. Written only by the Assistant Manager or the store-keeper (the people sent to buy), often from an Order Book order. The Manager or the Finance Manager approves; the Cashier gives the money.">
        <ExcelButton href={`/api/requisitions/export.xlsx?${qs}`} />
        {data?.canWrite && <Link className="btn p" to="/requisitions/new"><Icon name="plus" /> New requisition</Link>}
      </PageHead>
      {data && <div className="kpis"><Kpi tone={data.mine ? 'warn' : 'ok'} label="Waiting for you" value={data.mine} /><Kpi tone={data.moneyGiven ? 'info' : 'ok'} label="Money given: to buy / check" value={data.moneyGiven} /></div>}
      <div className="filters"><div className="seg">{tabs.map(([k, t]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t}</button>)}</div></div>
      <ErrorNote error={error} />
      {status === 'mine' ? (
        !data ? <Empty>Loading…</Empty> : !rows.length ? <Empty>Nothing is waiting for you.</Empty> : (
          <div className="rq-cards">{rows.map((r) => (
            <Link key={r.id} to={`/requisitions/${r.id}`} className={`rq-card${r.turn === 'correct' ? ' back' : ''}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><span className="no">{r.number}</span><span className="small">{fmtWhen(r.requestedAt)}</span></div>
              <div className="what"><b>{r.applicantName}</b> · {r.department}<br />{r.lines.slice(0, 3).map((l) => l.item).join(', ')}{r.lines.length > 3 ? ` +${r.lines.length - 3}` : ''}</div>
              {r.returned && <div className="small" style={{ color: '#c1121f' }}>Sent back: {r.returned.note}</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="tot">{r.total != null ? `TSh ${tsh(r.total)}` : 'amount not written'}</span>
                <span className="btn sm p">{{ correct: 'Correct it', fulfil: 'Buy / order' }[r.turn] || 'Open and sign'}</span></div>
            </Link>
          ))}</div>
        )
      ) : (
        <Panel flush>
          {!data ? <Empty>Loading…</Empty> : !rows.length ? <Empty>Nothing here.</Empty> : (
            <div className="tw"><table className="stafftable">
              <thead><tr><th>No.</th><th>School</th><th className="stick">Details of request</th><th>Applicant</th><th className="n">Total (TSh)</th><th>Signed</th><th>Status</th><th /></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} onClick={() => navigate(`/requisitions/${r.id}`)} style={{ cursor: 'pointer' }}>
                  <td className="mono small">{r.number}<div className="muted">{fmtWhen(r.requestedAt)}</div></td>
                  <td><SchoolPill code={r.code} name={r.school} /><div className="small muted">{r.department}</div></td>
                  <td className="stick small" style={{ maxWidth: 240 }}>{r.lines.slice(0, 3).map((l) => { const q = l.approvedQty ?? l.qty; return `${q != null ? `${q} × ` : ''}${l.item}`; }).join(', ')}{r.lines.length > 3 ? ` +${r.lines.length - 3}` : ''}{r.neededBy && <div className="muted">needed by {r.neededBy}</div>}</td>
                  <td className="small">{r.applicantName}<div className="muted">{r.kind === 'academic' ? 'for lessons' : 'general'}</div></td>
                  <td className="n">{r.total == null ? <span className="muted">—</span> : tsh(r.total)}</td>
                  <td><Dots r={r} /></td>
                  <td><span className={`pill ${r.returned ? 'bad' : TONE[r.status]}`}>{r.statusLabel}</span>{r.waiting && <div className="small muted">{r.waiting.names.length ? r.waiting.names.join(', ') : `no ${r.waiting.role} set up`}</div>}</td>
                  <td><Link className={`btn sm${r.turn && r.turn !== 'withdraw' ? ' p' : ''}`} to={`/requisitions/${r.id}`} onClick={(e) => e.stopPropagation()}>{{ correct: 'Correct it', fulfil: 'Buy / order' }[r.turn] || (r.turn && r.turn !== 'withdraw' ? 'Sign' : 'Open')}</Link></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Panel>
      )}
    </>
  );
}

// Small dots: first school signer, Head Master, store-keeper, Manager.
const Dots = ({ r }) => (
  <span className="sigdots" title="First school signer · Head Master · Store-keeper · Assistant Accountant · Manager">
    {['acad', 'head', 'store', 'check', 'manager'].map((k) => <i key={k} className={r.signs[k] ? 'on' : r.status === 'rejected' && !r.signs[k] ? 'off' : ''} />)}
  </span>
);

// One signature place, like the paper: a dotted line, the name in ink once signed, the date. The "Sign" button sits on the line of the person whose turn it is.
function Sig({ label, sign, hint, children }) {
  return (
    <div className="rq-sig">
      <div className="rq-sigline">{sign ? (sign.image ? <img className="rq-sigimg" src={sign.image} alt="" /> : <span className="rq-ink">{sign.by}</span>) : children}</div>
      <b>{label}</b>
      {(sign || hint) && <span className="who">{sign ? `${sign.by}${sign.acting ? ' (standing in)' : ''}` : hint}</span>}
      <span className="dt">Date: {sign?.at ? fmtDate(sign.at) : '......./......./20....'}</span>
    </div>
  );
}

function Top({ number, date, dept, who, edit, setDept, setWho }) {
  return (
    <>
      <div className="rq-top"><img src="/musabe-logo.png" alt="" /><div><h2>MUSABE SCHOOLS</h2>
        <small>P. O. Box 5154, BUGANDO, MWANZA, TEL: +255 782 110494, +255 754 654545, +255 769 197 221</small><small>Email: musabeschools@yahoo.co.uk</small></div></div>
      <div className="rq-title">Payment requisition form</div>
      <div className="rq-line"><span className="rq-no">No. <b>{number || '……'}</b></span><span className="rq-field" style={{ flex: '0 1 280px' }}><span>Date</span><span className="rq-val">{date}</span></span></div>
      <div className="rq-line"><label className="rq-field"><span>Department requesting</span>{edit ? <input value={dept} maxLength={80} onChange={(e) => setDept(e.target.value)} /> : <b>{dept}</b>}</label></div>
      <div className="rq-line"><label className="rq-field"><span>Name of applicant</span>{edit ? <input value={who} maxLength={100} onChange={(e) => setWho(e.target.value)} /> : <b>{who}</b>}</label></div>
    </>
  );
}

const blankRow = () => ({ key: Math.random().toString(36).slice(2), name: '', qty: '', cost: '', total: '' });

// The empty paper, written by the applicant: details in his own words; Qty and Amount @ may be left empty (a TOTAL AMOUNT alone is fine).
function WriteTable({ rows, setRows }) {
  const set = (key, k, v) => setRows((rs) => rs.map((x) => (x.key === key ? { ...x, [k]: v } : x)));
  const calc = (x) => num(x.qty) != null && num(x.cost) != null;
  const amount = (x) => (calc(x) ? num(x.qty) * num(x.cost) : num(x.total));
  const any = rows.some((x) => amount(x) != null);
  return (
    <>
      <div className="tw"><table className="rq-t">
        <thead><tr><th>S/N</th><th>Details of request</th><th>Qtity</th><th>Amount@</th><th>Total amount</th><th /></tr></thead>
        <tbody>{rows.map((x, i) => (
          <tr key={x.key}>
            <td className="c">{i + 1}</td>
            <td><input value={x.name} maxLength={200} onChange={(e) => set(x.key, 'name', e.target.value)} aria-label={`Details of request ${i + 1}`} /></td>
            <td style={{ width: 90 }}><input className="n" inputMode="numeric" value={x.qty} onChange={(e) => set(x.key, 'qty', digits(e.target.value))} aria-label={`Quantity ${i + 1}`} /></td>
            <td style={{ width: 120 }}><input className="n" inputMode="numeric" value={x.cost} onChange={(e) => set(x.key, 'cost', digits(e.target.value))} aria-label={`Amount @ ${i + 1}`} /></td>
            <td style={{ width: 140 }} className={calc(x) ? 'n' : ''}>{calc(x) ? <b>{money(amount(x))}</b> : <input className="n" inputMode="numeric" value={x.total} onChange={(e) => set(x.key, 'total', digits(e.target.value))} aria-label={`Total amount ${i + 1}`} />}</td>
            <td className="c" style={{ width: 34 }}>{rows.length > 1 && <button type="button" className="iconbtn" onClick={() => setRows((rs) => rs.filter((y) => y.key !== x.key))} aria-label="Remove the line"><Icon name="x" /></button>}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={4} className="r">TOTAL</td><td className="n">{any ? money(rows.reduce((s, x) => s + (amount(x) || 0), 0)) : ''}</td><td /></tr></tfoot>
      </table></div>
      <div><button type="button" className="btn sm" onClick={() => setRows((rs) => [...rs, blankRow(), blankRow()])}><Icon name="plus" /> More lines</button></div>
    </>
  );
}

function Page() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(null);                        // the signing PIN box: { id, title, call(cred) }
  const [note, setNote] = useState('');
  const [backAmt, setBackAmt] = useState('');
  const [editing, setEditing] = useState(!id);                 // writing a new one, or correcting one sent back
  const [dept, setDept] = useState(user.school?.name || '');
  const [who, setWho] = useState(user.fullName || '');
  const [kind, setKind] = useState('academic');
  const buyer = ['amanager', 'storekeeper'].includes(user.role);
  const schools = useSchools();
  const [qs] = useSearchParams();
  const [schoolId, setSchoolId] = useState('');
  const [order, setOrder] = useState(null);
  const orderId = qs.get('order');
  const [needed, setNeeded] = useState('');
  const [rows, setRows] = useState(() => Array.from({ length: 6 }, blankRow));
  const [qv, setQv] = useState({});                            // lineId -> quantity being typed (saved when you leave the box)
  const [sv, setSv] = useState({});                            // lineId -> { left, used } being typed
  const [costs, setCosts] = useState({});                      // lineId -> { est, total } written into an EMPTY cell (store-keeper, Manager)
  const [appr, setAppr] = useState({});                        // lineId -> { qty, amt } (Manager)
  // The supplier's price list / proforma the prices come from (2026-11-21): the Assistant Accountant checks against it.
  const [lists, setLists] = useState([]);
  const [priceListId, setPriceListId] = useState('');
  useEffect(() => { if (!id && buyer) api.get('/suppliers/price-lists/pick').then((d) => setLists(d.priceLists)).catch(() => {}); }, [id, buyer]);
  const pickedList = lists.find((x) => String(x.id) === priceListId);
  useEffect(() => {
    if (id || !orderId) return;
    api.get(`/orders/${orderId}`).then(({ order: o }) => {
      setOrder(o); setSchoolId(String(o.schoolId)); setDept(`${o.school} – ${o.placeLabel}`); setWho(user.fullName || '');
      setRows([...o.lines.map((l) => ({ key: `o${l.id}`, name: `${l.particulars}${l.unit ? ` (${l.unit})` : ''}`, qty: l.qty == null ? '' : String(l.qty), cost: '', total: '' })), blankRow(), blankRow()]);
    }).catch((e) => setError(e.message));
  }, [id, orderId, user.fullName]);
  const load = useCallback(() => (id ? api.get(`/requisitions/${id}`).then((d) => { setR(d.requisition); setError(''); }).catch((e) => setError(e.message)) : Promise.resolve()), [id]);
  useEffect(() => { load(); }, [load]);
  useLive(['requisition', 'purchase', 'delivery', 'payment'], load);
  const run = async (fn, msg) => { setBusy(true); setError(''); try { await fn(); if (msg) toast(msg); await load(); return true; } catch (e) { setError(e.message); return false; } finally { setBusy(false); } };

  if (id && !r) return <div className="rq-wrap"><Link to="/requisitions" className="btn sm">← All requisitions</Link><ErrorNote error={error} />{!error && <Empty>Loading…</Empty>}</div>;

  // ---------- writing (new, or correcting a requisition that was sent back) ----------
  const used = rows.filter((x) => x.name.trim() || x.qty || x.cost || x.total);
  const noAmount = buyer && !r && used.some((x) => (num(x.qty) == null || num(x.cost) == null) && num(x.total) == null);
  const bad = !used.length || used.some((x) => x.name.trim().length < 2) || (buyer && !r && (!schoolId || noAmount));
  const head = user.role === 'head';
  const firstRole = (head ? kind : ['sstore', 'bursar'].includes(user.role) ? 'general' : 'academic') === 'academic' ? 'Academic Master' : 'School Store-keeper';
  const startCorrect = () => {
    setDept(r.department); setWho(r.applicantName); setNeeded(r.neededBy || '');
    setRows(r.lines.map((l) => ({ key: `l${l.id}`, lineId: l.id, name: l.item, qty: l.qty == null ? '' : String(l.qty), cost: l.estCost == null ? '' : String(l.estCost), total: l.total == null ? '' : String(l.total) })));
    setEditing(true);
  };
  const submitForm = () => setAsk({ id: r?.id || 0, title: r ? `Sign the correction of ${r.number}` : 'Sign and send', call: async (cred) => {
    const body = { kind: buyer && !r ? (order?.place === 'academic' ? 'academic' : 'general') : kind, ...(buyer && !r ? { schoolId: Number(schoolId), orderId: order?.id || undefined, priceListId: Number(priceListId) || undefined } : {}), department: dept, applicantName: who, neededBy: needed || null, lines: used.map((x) => ({ lineId: x.lineId, name: x.name, qty: num(x.qty), estCost: num(x.cost), total: num(x.total) })), ...cred };
    if (r) { await api.post(`/requisitions/${r.id}/correct`, body); toast(`${r.number} corrected and sent on`); setEditing(false); await load(); return; }
    const d = await api.post('/requisitions', body); toast(`${d.requisition.number} sent`); setEditing(false); navigate(`/requisitions/${d.requisition.id}`, { replace: true });
  } });

  if (editing) {
    return (
      <div className="rq-wrap">
        <div className="rq-bar"><Link to={r ? `/requisitions/${r.id}` : '/requisitions'} className="btn sm" onClick={() => r && setEditing(false)}>← Back</Link><h2 style={{ margin: 0 }}>{r ? `Correct ${r.number}` : 'New requisition'}</h2></div>
        {r?.returned && <p className="rq-note bad"><b>{r.returned.by} sent it back:</b> {r.returned.note}</p>}
        {!r && buyer && (
          <div className="row" style={{ alignItems: 'end', gap: 12, flexWrap: 'wrap' }}>
            <label>School it is for<select value={schoolId} disabled={!!order} onChange={(e) => { setSchoolId(e.target.value); const s = schools.find((x) => String(x.id) === e.target.value); if (s) setDept(s.name); }}>
              <option value="">Choose the school…</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            {order && <span className="pill info">From order {order.number} ({order.placeLabel})</span>}
            <label>Price list / proforma (from the supplier)<select value={priceListId} onChange={(e) => setPriceListId(e.target.value)}>
              <option value="">{lists.length ? 'Choose the paper the prices come from…' : 'None entered yet (Suppliers page)'}</option>
              {lists.map((x) => <option key={x.id} value={x.id}>{x.number} · {x.supplier} · {x.kindLabel}{x.refNo ? ` ${x.refNo}` : ''}{x.expired ? ' (expired)' : ''}</option>)}</select></label>
          </div>
        )}
        {pickedList && (
          <div className="rq-note info small">
            <b>{pickedList.kindLabel} {pickedList.number}</b> from {pickedList.supplier}{pickedList.docDate ? ` · ${pickedList.docDate}` : ''}{pickedList.validUntil ? ` · valid until ${pickedList.validUntil}` : ''}:{' '}
            {pickedList.lines.map((l) => `${l.item}${l.unit ? ` (${l.unit})` : ''} ${tsh(l.price)}`).join(' · ')}
            {pickedList.hasFile && <> · <a href={`/api/suppliers/price-lists/${pickedList.id}/file`} target="_blank" rel="noreferrer">see the paper</a></>}
          </div>
        )}
        {!r && head && (
          <div className="seg">{[['academic', 'For lessons (Academic Master signs first)'], ['general', 'General (School Store-keeper signs first)']].map(([k, t]) => <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{t}</button>)}</div>
        )}
        <div className="rq-sheet">
          <Top number={r?.number} date={fmtDate(r?.requestedAt || new Date())} dept={dept} who={who} edit setDept={setDept} setWho={setWho} />
          <WriteTable rows={rows} setRows={setRows} />
          <div className="rq-signs"><Sig label="Signature of Applicant" hint="signed when you send it" /><div /><div /></div>
        </div>
        <div className="rq-actions">
          <label>Needed by (not required)<input type="date" min={r ? undefined : todayStr()} value={needed} onChange={(e) => setNeeded(e.target.value)} style={{ maxWidth: 220 }} /></label>
          <p className="small muted" style={{ margin: 0 }}>Write it as you do on the paper, in your own words. It does not have to be in any store. Qty and Amount @ can stay empty: a TOTAL AMOUNT alone is fine. {!r && (buyer ? 'You know the price (ask the shop for a price list first): write an amount on every line. Then the Assistant Accountant checks it, and the Manager or the Finance Manager approves.' : `It goes to the ${firstRole} first.`)}</p>
          <ErrorNote error={error} />
          <div className="row"><button className="btn p" disabled={busy || bad} onClick={submitForm}>{r ? 'Sign the correction' : 'Sign and send'}</button>
            <Link to={r ? `/requisitions/${r.id}` : '/requisitions'} className="btn" onClick={() => r && setEditing(false)}>Cancel</Link></div>
        </div>
        {ask && <PinBox type="requisition" id={ask.id} title={ask.title} onCancel={() => setAsk(null)} onConfirm={async (cred) => { await ask.call(cred); setAsk(null); }} />}
      </div>
    );
  }

  // ---------- reading / signing ----------
  const turn = r.turn;
  const byBuyer = ['amanager', 'storekeeper'].includes(r.requestedByRole) && !r.signs.head && !r.signs.acad;   // written by the buyer (2026-11-20): no school signatures
  const signer = ['acad', 'head', 'store', 'check', 'manager'].includes(turn);
  const mgr = turn === 'manager';
  const qtyEditor = ['acad', 'head', 'store'].includes(turn);
  const fills = turn === 'store' || turn === 'check' || mgr;
  const atSchool = ['acad', 'head'].includes(r.status);
  const stockEditor = atSchool && STOCK_ROLES.includes(user.role);
  const showStock = atSchool || r.lines.some((l) => l.leftQty != null || l.usedQty != null);
  const showAppr = mgr || !!r.signs.manager;
  const cost = (l) => (l.estCost != null ? l.estCost : num(costs[l.id]?.est));
  const tot = (l) => (l.total != null ? l.total : num(costs[l.id]?.total));
  const aQty = (l) => (appr[l.id]?.qty !== undefined ? num(appr[l.id].qty) : l.qty);
  const lineAmt = (l) => (l.qty != null && cost(l) != null ? l.qty * cost(l) : tot(l));
  const apprAmt = (l) => {
    if (l.qty != null && cost(l) != null) return (aQty(l) ?? l.qty) * cost(l);
    if (appr[l.id]?.amt !== undefined) return num(appr[l.id].amt);
    const t = lineAmt(l);
    if (t == null) return null;
    return l.qty != null && aQty(l) != null && aQty(l) < l.qty ? Math.round((t * aQty(l)) / l.qty) : t;
  };
  const mgrTotal = r.lines.reduce((s, l) => s + (apprAmt(l) || 0), 0);
  const mgrMissing = mgr && r.lines.some((l) => (l.qty == null || (aQty(l) ?? 0) > 0) && !(apprAmt(l) > 0) && (apprAmt(l) !== 0));

  // Autosave: a quantity (signer) is saved when you leave the box; so it can never be "lost".
  const saveQty = async (l) => {
    const v = qv[l.id];
    if (v === undefined || num(v) === l.qty) return;
    if (!num(v)) { setError(`${l.item}: write a quantity of 1 or more.`); setQv((q) => { const n = { ...q }; delete n[l.id]; return n; }); return; }
    if (await run(() => api.post(`/requisitions/${r.id}/amend`, { lines: [{ lineId: l.id, qty: num(v) }], note: '' }), `${l.item}: quantity saved`)) setQv((q) => { const n = { ...q }; delete n[l.id]; return n; });
  };
  const saveStock = async (l) => {
    const v = sv[l.id];
    if (!v) return;
    const left = v.left !== undefined ? num(v.left) : l.leftQty;
    const usedQ = v.used !== undefined ? num(v.used) : l.usedQty;
    if (left === l.leftQty && usedQ === l.usedQty) return;
    if (await run(() => api.post(`/requisitions/${r.id}/stockinfo`, { lines: [{ lineId: l.id, left, used: usedQ }] }), `${l.item}: saved`)) setSv((q) => { const n = { ...q }; delete n[l.id]; return n; });
  };
  const sign = async (approve) => {
    const body = { approve, note, lines: r.lines.map((x) => ({
      lineId: x.id,
      estCost: fills && x.estCost == null && num(costs[x.id]?.est) != null ? num(costs[x.id].est) : undefined,
      total: fills && x.total == null && num(costs[x.id]?.total) != null ? num(costs[x.id].total) : undefined,
      approvedQty: mgr && x.qty != null ? aQty(x) : undefined,
      approvedTotal: mgr && !(x.qty != null && cost(x) != null) && appr[x.id]?.amt !== undefined ? num(appr[x.id].amt) : undefined })) };
    const after = () => { setNote(''); setCosts({}); setAppr({}); };
    if (!approve) { if (await run(() => api.post(`/requisitions/${r.id}/${turn}`, body), `${r.number} rejected`)) after(); return; }
    setAsk({ id: r.id, title: `Sign ${r.number}`, call: async (cred) => { await api.post(`/requisitions/${r.id}/${turn}`, { ...body, ...cred }); toast(`${r.number} signed`); after(); await load(); } });
  };
  const sendBack = async () => { if (await run(() => api.post(`/requisitions/${r.id}/return`, { note }), `${r.number} sent back to the applicant`)) setNote(''); };
  const stop = async () => { if (await run(() => api.post(`/requisitions/${r.id}/stop`, { note }), `${r.number} stopped`)) setNote(''); };
  const withdraw = () => run(() => api.post(`/requisitions/${r.id}/withdraw`, {}), `${r.number} withdrawn`);
  const askBack = () => run(() => api.post(`/requisitions/${r.id}/money-back/ask`, {}), `${r.number}: the Cashier is told`);

  // The sign button goes INSIDE the box of the person whose turn it is, like a pen on the dotted line.
  const signHere = (step) => (turn === step ? <button className="btn p sm" disabled={busy || (mgr && mgrMissing)} onClick={() => sign(true)}>{busy ? '…' : 'Sign here'}</button> : null);
  const empty = (step) => !r.signs[step] && !(r.rejected && r.status === 'rejected');
  const money$ = r.money;
  const payer = user.role === 'cashier' && money$?.status === 'pending';

  const rowsOut = r.lines.map((l, i) => {
    const q = qv[l.id] !== undefined ? qv[l.id] : l.qty == null ? '' : String(l.qty);
    const sd = sv[l.id] || {};
    const emptyCost = fills && l.estCost == null && l.qty != null;
    const emptyTot = fills && l.total == null && !(l.qty != null && cost(l) != null);
    const calc = l.qty != null && cost(l) != null;
    return (
      <tr key={l.id}>
        <td className="c">{i + 1}</td>
        <td>{l.item}</td>
        <td className="n" style={{ width: 90 }}>{qtyEditor && l.qty != null
          ? <input className="n fill" inputMode="numeric" value={q} onChange={(e) => setQv((x) => ({ ...x, [l.id]: digits(e.target.value) }))} onBlur={() => saveQty(l)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label={`Quantity of ${l.item}`} />
          : l.qty != null ? <>{l.qty}{l.origQty != null && l.origQty !== l.qty && <div className="rq-small">asked {l.origQty}</div>}</> : ''}</td>
        <td className="n" style={{ width: 120 }}>{emptyCost ? <input className="n fill" inputMode="numeric" placeholder="fill" value={costs[l.id]?.est ?? ''} onChange={(e) => setCosts((c) => ({ ...c, [l.id]: { ...c[l.id], est: digits(e.target.value) } }))} aria-label={`Amount @ of ${l.item}`} /> : money(cost(l))}</td>
        <td className="n" style={{ width: 140 }}>{emptyTot && !calc ? <input className="n fill" inputMode="numeric" placeholder="fill" value={costs[l.id]?.total ?? ''} onChange={(e) => setCosts((c) => ({ ...c, [l.id]: { ...c[l.id], total: digits(e.target.value) } }))} aria-label={`Total of ${l.item}`} /> : money(lineAmt(l))}</td>
        {showStock && <>
          <td className="n sch" style={{ width: 80 }}>{stockEditor ? <input className="n fill" inputMode="numeric" value={sd.left !== undefined ? sd.left : l.leftQty ?? ''} onChange={(e) => setSv((x) => ({ ...x, [l.id]: { ...x[l.id], left: digits(e.target.value) } }))} onBlur={() => saveStock(l)} aria-label={`Left of ${l.item}`} /> : l.leftQty ?? ''}</td>
          <td className="n sch" style={{ width: 80 }}>{stockEditor ? <input className="n fill" inputMode="numeric" value={sd.used !== undefined ? sd.used : l.usedQty ?? ''} onChange={(e) => setSv((x) => ({ ...x, [l.id]: { ...x[l.id], used: digits(e.target.value) } }))} onBlur={() => saveStock(l)} aria-label={`Used of ${l.item}`} /> : l.usedQty ?? ''}</td>
        </>}
        {showAppr && <>
          <td className="n" style={{ width: 90 }}>{mgr && l.qty != null ? <input className="n fill" inputMode="numeric" value={appr[l.id]?.qty ?? String(l.qty)} onChange={(e) => setAppr((a) => ({ ...a, [l.id]: { ...a[l.id], qty: digits(e.target.value) } }))} aria-label={`Approved quantity of ${l.item}`} /> : l.qty != null ? l.approvedQty ?? '' : ''}</td>
          <td className="n" style={{ width: 130 }}>{mgr && !(l.qty != null && cost(l) != null) ? <input className="n fill" inputMode="numeric" value={appr[l.id]?.amt ?? (apprAmt(l) == null ? '' : String(apprAmt(l)))} onChange={(e) => setAppr((a) => ({ ...a, [l.id]: { ...a[l.id], amt: digits(e.target.value) } }))} aria-label={`Approved amount of ${l.item}`} /> : mgr ? money(apprAmt(l)) : money(l.approvedTotal)}</td>
        </>}
      </tr>
    );
  });
  const blanks = Math.max(0, 4 - r.lines.length);
  const cols = 5 + (showStock ? 2 : 0) + (showAppr ? 2 : 0);

  return (
    <div className="rq-wrap">
      <div className="rq-bar"><Link to="/requisitions" className="btn sm">← All requisitions</Link><span className={`pill ${r.returned ? 'bad' : TONE[r.status]}`}>{r.statusLabel}</span><SealBadge seal={r.seal} /><span className="grow" />
        <PrintButton className="btn" label="Print form">{requisitionPaper(r)}</PrintButton></div>
      {r.returned && <p className="rq-note bad"><b>{r.returned.by} sent it back:</b> {r.returned.note}. {turn === 'correct' ? 'Correct it and it goes on again.' : 'Waiting for the applicant to correct it.'}</p>}
      {r.rejected && <p className="rq-note bad"><b>Rejected by {r.rejected.by}</b> on {fmtDate(r.rejected.at)}: {r.rejected.reason}</p>}
      {r.priceList && <p className="rq-note info">Prices from <b>{r.priceList.kind === 'proforma' ? 'proforma invoice' : 'price list'} {r.priceList.number}</b> ({r.priceList.supplier}) · <a href={`/api/suppliers/price-lists/${r.priceList.id}/file`} target="_blank" rel="noreferrer">see the paper</a></p>}
      {!r.returned && !r.rejected && r.waiting && !signer && <p className="rq-note info">Waiting for <b>{r.waiting.role}</b>{r.waiting.names.length ? `: ${r.waiting.names.join(', ')}` : ` — nobody with this role is set up yet`}.</p>}
      {r.purchases?.length > 0 && (
        <div className="rq-note info">
          <b>Buying for this requisition</b>
          {r.purchases.map((b) => (
            <div key={b.id} style={{ marginTop: 4 }}>
              <Link to={`/purchases/form/${b.id}`}>{b.number}</Link> · {b.supplier} · TSh {tsh(b.total)} · <span className={`pill ${b.status === 'confirmed' ? 'ok' : b.status === 'rejected' ? 'bad' : 'warn'}`}>{b.statusLabel}</span>
              {b.status === 'rejected' && <div className="small">Rejected by {b.decidedBy}{b.decidedAt ? ` on ${fmtDate(b.decidedAt)}` : ''}: {b.note}{r.purchases.some((x) => x.id > b.id) ? ` · then bought again on ${r.purchases.find((x) => x.id > b.id).number}` : ''}</div>}
              {b.status === 'confirmed' && !b.decidedBy && <div className="small">Accepted by Mapokezi; nothing to give back, so it closed by itself.</div>}
            </div>
          ))}
          {r.purchases[r.purchases.length - 1].status === 'rejected' && ['approved', 'buying'].includes(r.status) && !r.moneyBackAsked && <div className="small" style={{ marginTop: 4 }}>The buyer goes back to the market (new buying form), or gives the money back to the Cashier (buttons below).</div>}
        </div>
      )}
      {r.moneyBack && <p className="rq-note ok"><b>Money given back:</b> TSh {tsh(r.moneyBack.amount)} received by {r.moneyBack.by} on {fmtDate(r.moneyBack.at)}{r.moneyBack.note ? ` (${r.moneyBack.note})` : ''}. Nothing was bought; this requisition is closed.</p>}
      {!r.moneyBack && r.moneyBackAsked && <p className="rq-note info">The buyer said on {fmtDate(r.moneyBackAsked)} that he brings the money back. Waiting for the Cashier to receive it.</p>}
      {money$ && <p className="rq-note info">Money: <b>{money$.number}</b> TSh {tsh(money$.amount)} · {money$.status === 'paid' ? `given by ${money$.paidBy} on ${fmtDate(money$.paidAt)}` : money$.status === 'rejected' ? 'the Cashier rejected it' : 'waiting for the Cashier'}</p>}

      <div className="rq-sheet">
        <Top number={r.number} date={fmtDate(r.requestedAt)} dept={r.department} who={r.applicantName} />
        <div className="tw"><table className="rq-t">
          <thead><tr><th>S/N</th><th>Details of request</th><th>Qtity</th><th>Amount@</th><th>Total amount</th>
            {showStock && <><th className="sch">Left</th><th className="sch">Used</th></>}
            {showAppr && <><th>Approved qty</th><th>Approved amount</th></>}</tr></thead>
          <tbody>{rowsOut}
            {Array.from({ length: blanks }, (_, i) => <tr key={`b${i}`}><td className="c">{r.lines.length + i + 1}</td>{Array.from({ length: cols - 1 }, (_, j) => <td key={j} />)}</tr>)}
            {r.removedLines.map((l) => <tr key={`x${l.id}`} className="void"><td className="c">—</td><td colSpan={cols - 1}>{l.item} ({l.qty}) taken off</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={4} className="r">TOTAL</td><td className="n">{r.total != null ? money(r.askedTotal ?? r.total) : r.askedTotal != null ? money(r.askedTotal) : ''}</td>
            {showStock && <td colSpan={2} className="sch" />}
            {showAppr && <><td /><td className="n">{mgr ? money(mgrTotal) : r.signs.manager ? money(r.total) : ''}</td></>}</tr></tfoot>
        </table></div>
        {mgr && <p className="rq-small" style={{ margin: '6px 0 0' }}>The Cashier will pay exactly <b>TSh {tsh(mgrTotal)}</b>. Give less than asked by lowering the quantity or the amount (0 = not this line).</p>}

        {!byBuyer && <>
        <div className="rq-sec">At the school</div>
          <div className="rq-signs">
            <Sig label="Signature of Applicant" sign={r.signs.applicant || { by: r.applicantName, at: r.requestedAt }} hint={r.requestedByRole && r.requestedBy !== r.applicantName ? `written by ${r.requestedBy}` : ''} />
            <Sig label={r.firstName} sign={r.signs.acad} hint={r.signs.acad ? '' : turn === 'acad' ? 'your turn' : r.status === 'acad' ? 'waiting' : ''}>{empty('acad') && signHere('acad')}</Sig>
            <Sig label="Approved by (Head Master)" sign={r.signs.head} hint={r.signs.head ? '' : turn === 'head' ? 'your turn' : ''}>{empty('head') && signHere('head')}</Sig>
          </div>
        </>}
        <div className="rq-sec">Administration</div>
        <div className="rq-signs">
          {byBuyer && <Sig label={`Signature of Applicant (${r.requestedByRole === 'amanager' ? 'Assistant Manager' : 'Store-keeper'})`} sign={r.signs.applicant || { by: r.applicantName, at: r.requestedAt }} />}
          {!byBuyer && <Sig label="Checked by (Store-keeper)" sign={r.signs.store} hint={r.signs.store ? '' : turn === 'store' ? 'your turn' : ''}>{empty('store') && signHere('store')}</Sig>}
          <Sig label="Checked by (Assistant Accountant)" sign={r.signs.check} hint={r.signs.check ? '' : turn === 'check' ? 'your turn' : r.status === 'check' ? 'waiting' : ''}>{empty('check') && signHere('check')}</Sig>
          <Sig label="Authorised by (Manager / Finance Manager)" sign={r.signs.manager} hint={r.signs.manager ? '' : mgr ? 'your turn' : ''}>{empty('manager') && signHere('manager')}</Sig>
          <Sig label="Money given (Cashier)" sign={money$?.status === 'paid' ? { by: money$.paidBy, at: money$.paidAt } : null} hint={money$ && money$.status !== 'paid' ? (payer ? 'your turn' : 'waiting') : ''}>{money$ && <Link className="btn sm" to={`/payments/${money$.id}`}>{payer ? `Pay TSh ${tsh(money$.amount)}` : 'Open voucher'}</Link>}</Sig>
        </div>
      </div>

      <SealQR type="requisition" id={r.id} seal={r.seal} />
      <div className="rq-actions">
        <ErrorNote error={error} />
        {(signer || r.canStop) && <label>{mgr ? 'Note (needed to reject, to give less, or to send back)' : 'Note (needed to reject, to stop or to send back)'}<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>}
        <div className="row">
          {signer && <button className="btn danger" disabled={busy || !note.trim()} onClick={() => sign(false)}>Reject</button>}
          {r.canReturn && <button className="btn" disabled={busy || !note.trim()} onClick={sendBack}>Send back to applicant</button>}
          {r.canStop && <button className="btn danger" disabled={busy || !note.trim()} onClick={stop}>Stop it</button>}
          {r.canWithdraw && <button className="btn" disabled={busy} onClick={withdraw}>Withdraw</button>}
          {turn === 'correct' && <button className="btn p" onClick={startCorrect}>Correct it</button>}
          {turn === 'fulfil' && !r.moneyBackAsked && <Link className="btn p" to={`/purchases/buy/${r.id}`}>{r.purchases?.some((b) => b.status === 'rejected') ? 'Go back to the market (new buying form)' : 'Fill the buying form'}</Link>}
          {r.canAskMoneyBack && <button className="btn" disabled={busy} onClick={askBack}>Give the money back to the Cashier</button>}
        </div>
        {r.canReceiveMoneyBack && (
          <div className="row" style={{ alignItems: 'end' }}>
            <label>Money received back (TSh)<input inputMode="numeric" value={backAmt} placeholder={String(r.money?.amount ?? '')} onChange={(e) => setBackAmt(e.target.value.replace(/\D/g, ''))} style={{ maxWidth: 180 }} /></label>
            <label style={{ flex: 1 }}>Note (needed if the amount is different)<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
            <button className="btn p" disabled={busy || backAmt === ''} onClick={() => setAsk({ id: r.id, title: `Sign: received TSh ${tsh(Number(backAmt))} back`, call: async (cred) => { await api.post(`/requisitions/${r.id}/money-back`, { amount: Number(backAmt), note, ...cred }); toast(`${r.number}: money received, closed`); setNote(''); setBackAmt(''); await load(); } })}>I received the money back</button>
          </div>
        )}
        {qtyEditor && <p className="small muted" style={{ margin: 0 }}>You can change a quantity: it is saved as soon as you leave the box. The words and amounts are the applicant's: send it back if they are wrong.</p>}
        {fills && <p className="small muted" style={{ margin: 0 }}>Yellow boxes are empty on the paper: you may fill them. Written amounts cannot be changed.</p>}
      </div>
      {ask && <PinBox type="requisition" id={ask.id} title={ask.title} onCancel={() => setAsk(null)} onConfirm={async (cred) => { await ask.call(cred); setAsk(null); }} />}
    </div>
  );
}

export const requisitionPaper = (r) => (
  <Paper title="PAYMENT REQUISITION FORM" number={r.number} school={r.schoolName}
    contact={['P. O. Box 5154, BUGANDO, MWANZA', 'TEL: +255 782 110494, +255 754 654545, +255 769 197 221', 'Email: musabeschools@yahoo.co.uk']}
    meta={[['Department requesting', r.department], ['Name of applicant', r.applicantName], ['Date', fmtDate(r.requestedAt)], ['Needed by', r.neededBy], ['Status', r.statusLabel],
      ['Purchases', r.purchases.map((p) => p.number).join(', ')], ['Delivery', r.delivery?.number]]}
    columns={[{ key: 'item', label: 'Details of request' }, { key: 'qty', label: 'Qtity', n: true }, { key: 'cost', label: 'Amount @', n: true }, { key: 'amount', label: 'Total amount', n: true },
      { key: 'left', label: 'Left', n: true }, { key: 'used', label: 'Used', n: true }]}
    rows={r.lines.map((l) => ({ item: l.item, qty: l.qty == null ? '' : `${l.qty}${l.approvedQty != null && l.approvedQty !== l.qty ? ` (approved ${l.approvedQty})` : ''}`, cost: l.estCost == null ? '' : tsh(l.estCost),
      amount: l.amount == null ? '' : tsh(l.amount), left: l.leftQty ?? '', used: l.usedQty ?? '' }))}
    total={r.total} totalLabel="TOTAL" totalAt="amount"
    signs={[{ role: 'Signature of Applicant', name: r.applicantName, at: r.signs.applicant?.at || r.requestedAt, image: r.signs.applicant?.image },
      { role: r.firstName, name: r.signs.acad?.by, at: r.signs.acad?.at, note: r.signs.acad?.note, image: r.signs.acad?.image },
      { role: 'Approved by (Head Master)', name: r.signs.head?.by, at: r.signs.head?.at, note: r.signs.head?.note, image: r.signs.head?.image },
      { role: 'Checked by (Store-keeper)', name: r.signs.store?.by, at: r.signs.store?.at, note: r.signs.store?.note, image: r.signs.store?.image },
      { role: 'Checked by (Assistant Accountant)', name: r.signs.check?.by, at: r.signs.check?.at, note: r.signs.check?.note, image: r.signs.check?.image },
      { role: 'Authorised by (Manager / Finance Manager)', name: r.signs.manager?.by, at: r.signs.manager?.at, note: r.signs.manager?.note, image: r.signs.manager?.image },
      { role: 'Money given (Cashier)', name: r.money?.status === 'paid' ? r.money.paidBy : '', at: r.money?.status === 'paid' ? r.money.paidAt : null }]}
    qr={r.seal?.code ? verifyUrl('requisition', r.id, r.seal.code) : undefined}
    foot={r.rejected ? `Rejected by ${r.rejected.by} on ${fmtDate(r.rejected.at)}: ${r.rejected.reason}` : 'Each name and time above was stamped by the system when that person signed with his own account. Nothing is bought or paid before the Manager signs.'} />
);
