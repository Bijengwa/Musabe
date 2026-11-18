// Fomu ya Manunuzi ya Kila Siku, as on the paper: FEDHA KUTOKA OFISINI, Date, S/N | DETAILS OF REQUEST | QUANTITY | PRICE | TOTAL AMOUNT,
// JUMLA YA MANUNUZI, BALANCE, Jina la Mnunuzi + Sahihi, Imeidhinishwa (Mapokezi, when he has checked the goods).
// The things come already written from the approved requisition. The buyer writes only the price he paid.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Empty, ErrorNote, tsh, useToast } from '../components/ui';
import { NewItem } from './Store';
import { PinBox, SealBadge, SealQR } from '../components/signing';
import { DeliveryLabelsButton, PrintButton } from '../components/barcode';
import { fmtDate } from '../components/paper';
import './requisition.css';

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const dmy = () => new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' });
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export default function Manunuzi() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [r, setR] = useState(null);
  const [store, setStore] = useState(null);
  const [rows, setRows] = useState([]);
  const [adding, setAdding] = useState(null);
  const [error, setError] = useState('');
  const loadItems = () => api.get('/store/items').then(setStore).catch((e) => setError(e.message));
  useEffect(() => { api.get(`/requisitions/${id}`).then((d) => setR(d.requisition)).catch((e) => setError(e.message)); loadItems(); }, [id]);
  useEffect(() => {
    if (!r || !store || rows.length) return;
    const lines = r.lines.filter((l) => (l.approvedQty ?? l.qty ?? 1) > 0 && (l.approvedTotal ?? l.amount ?? 1) > 0);
    setRows(lines.map((l) => {
      const qty = l.approvedQty ?? l.qty ?? 1;
      const total = l.approvedTotal ?? l.amount;
      const hit = store.items.find((i) => norm(i.name) === norm(l.item));
      return { key: l.id, details: l.item, itemId: hit?.id || '', qty: String(qty), price: total != null && qty ? String(Math.round(total / qty)) : '' };
    }));
  }, [r, store, rows.length]);
  const set = (k, f, v) => setRows((x) => x.map((y) => (y.key === k ? { ...y, [f]: v } : y)));
  const lineTotal = (x) => Number(x.qty || 0) * Number(x.price || 0);
  const jumla = rows.reduce((s, x) => s + lineTotal(x), 0);
  const float = r?.money?.status === 'paid' ? r.money.amount : 0;
  const balance = float - jumla;
  const ready = rows.length && rows.every((x) => x.itemId && Number(x.qty) > 0 && x.price !== '');
  const [ask, setAsk] = useState(false);
  const save = async ({ pin, smsCode }) => {
    const d = await api.post('/purchases', { requisitionId: r.id, ordered: false, pin, smsCode, lines: rows.map((x) => ({ itemId: Number(x.itemId), qty: Number(x.qty), unitCost: Number(x.price) })) });
    toast(`${d.purchase.number} signed and saved: Mapokezi checks the goods`); navigate(`/purchases/form/${d.purchase.id}`, { replace: true });
  };
  if (!r || !store) return <div className="rq-wrap"><Link to="/requisitions" className="btn sm">← Back</Link><ErrorNote error={error} />{!error && <Empty>Loading…</Empty>}</div>;
  const pad = [...rows]; while (pad.length < 14) pad.push(null);
  return (
    <div className="rq-wrap">
      <div className="rq-bar"><Link to={`/requisitions/${r.id}`} className="btn sm">← {r.number}</Link><h2 style={{ margin: 0 }}>Daily purchases form</h2></div>
      <div className="rq-sheet">
        <div className="rq-top"><img src="/musabe-logo.png" alt="" /><div><h2 style={{ margin: 0 }}>MUSABE SCHOOLS</h2><div className="rq-small">P.O. Box 5154, BUGANDO, MWANZA</div></div></div>
        <div className="rq-title">Fomu ya Manunuzi ya Kila Siku</div>
        <div className="rq-line"><span className="rq-no">For <b>{r.number}</b> · {r.school}</span><span className="rq-field" style={{ flex: '0 1 240px' }}><span>Date</span><span className="rq-val">{dmy()}</span></span></div>
        <div className="rq-line"><span className="rq-field"><span>FEDHA KUTOKA OFISINI</span><b>TSh {tsh(float)}</b></span></div>
        {!float && <p className="rq-note bad">The Cashier has not given the money for this yet.</p>}
        <div className="tw"><table className="rq-t">
          <thead><tr><th style={{ width: 50 }}>S/N</th><th>DETAILS OF REQUEST</th><th className="n" style={{ width: 110 }}>QUANTITY</th><th className="n" style={{ width: 130 }}>PRICE</th><th className="n" style={{ width: 150 }}>TOTAL AMOUNT</th></tr></thead>
          <tbody>{pad.map((x, i) => (x ? (
            <tr key={x.key}><td className="n">{i + 1}</td>
              <td><b>{x.details}</b>{!x.itemId && <div className="rq-small">Which stock item is this?{' '}
                <select value="" onChange={(e) => (e.target.value === 'new' ? setAdding(x.key) : set(x.key, 'itemId', Number(e.target.value)))}><option value="">Choose…</option>{store.items.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>)}{store.canAdd && <option value="new">+ Item not in the list</option>}</select></div>}</td>
              <td className="n"><input inputMode="numeric" value={x.qty} style={{ width: '100%', textAlign: 'right' }} onChange={(e) => set(x.key, 'qty', digits(e.target.value))} /></td>
              <td className="n"><input inputMode="numeric" value={x.price} style={{ width: '100%', textAlign: 'right' }} onChange={(e) => set(x.key, 'price', digits(e.target.value))} /></td>
              <td className="n">{tsh(lineTotal(x))}</td></tr>
          ) : <tr key={`e${i}`}><td className="n">{i + 1}</td><td /><td /><td /><td /></tr>))}</tbody>
          <tfoot><tr><td colSpan={4}><b>JUMLA YA MANUNUZI</b></td><td className="n"><b>{tsh(jumla)}</b></td></tr>
            <tr><td colSpan={4}><b>BALANCE</b> <span className="rq-small">(money from the office less the purchases)</span></td><td className="n"><b style={{ color: balance < 0 ? '#c01818' : undefined }}>{tsh(balance)}</b></td></tr></tfoot>
        </table></div>
        <div className="rq-signs" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="rq-sig"><div className="rq-sigline"><span className="rq-small">signed when you send it</span></div><span>Jina la Mnunuzi</span><span className="who"><b>{user?.fullName || user?.full_name}</b></span></div>
          <div className="rq-sig"><div className="rq-sigline" /><span>Imeidhinishwa (Mapokezi)</span><span className="who">after he checks the goods</span></div>
        </div>
      </div>
      <div className="rq-actions"><ErrorNote error={error} />
        {balance < 0 && <p className="rq-note bad">You spent TSh {tsh(-balance)} more than the office gave.</p>}
        <div className="row"><button className="btn p" disabled={!ready} onClick={() => setAsk(true)}>Sign and send to Mapokezi</button></div></div>
      {adding && <NewItem d={store} onClose={() => setAdding(null)} onSaved={(i) => { set(adding, 'itemId', i.id); loadItems(); setAdding(null); }} />}
    </div>
  );
}

// An existing buying form: Mapokezi checks the goods and signs; the Cashier takes the money back and signs.
export function ManunuziView() {
  const { id } = useParams();
  const toast = useToast();
  const [p, setP] = useState(null);
  const [error, setError] = useState('');
  const [seen, setSeen] = useState({});
  const [note, setNote] = useState('');
  const [back, setBack] = useState('');
  const [ask, setAsk] = useState(null);
  const load = () => api.get(`/purchases/${id}`).then((d) => { setP(d.purchase); setSeen((s) => (Object.keys(s).length ? s : Object.fromEntries(d.purchase.lines.map((l) => [l.id, { qty: String(l.confirmed ?? l.qty), note: l.note || '' }])))); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return <div className="rq-wrap"><Link to="/purchases" className="btn sm">← Back</Link><ErrorNote error={error} />{!error && <Empty>Loading…</Empty>}</div>;
  const worth = p.lines.reduce((s, l) => s + Number(l.unitCost) * (p.status === 'pending' ? Number(seen[l.id]?.qty ?? l.qty) : (l.confirmed ?? l.qty)), 0);
  const float = p.floatAmount || 0;
  const expected = float - worth;
  const sg = p.signs || {};
  const Sg = ({ label, s, hint }) => (
    <div className="rq-sig"><div className="rq-sigline">{s ? (s.image ? <img className="rq-sigimg" src={s.image} alt="" /> : <span className="rq-ink">{s.by}</span>) : null}</div>
      <span>{label}</span><span className="who">{s ? <b>{s.by}</b> : hint}</span><span className="dt">{s ? `Date: ${fmtDate(s.at)}` : ''}</span></div>);
  const check = async ({ pin, smsCode }) => { await api.post(`/purchases/${p.id}/check`, { note, pin, smsCode, lines: p.lines.map((l) => ({ lineId: l.id, countedQty: Number(seen[l.id].qty || 0), note: seen[l.id].note })) }); toast(`${p.number} checked and signed`); setAsk(null); await load(); };
  const settle = async ({ pin, smsCode }) => { await api.post(`/purchases/${p.id}/decide`, { approve: true, note, returnedAmount: back, pin, smsCode }); toast(`${p.number} closed: goods go to ${p.school?.short || 'the school'}`); setAsk(null); await load(); };
  const reject = async () => { try { await api.post(`/purchases/${p.id}/decide`, { approve: false, note }); toast(`${p.number} rejected`); await load(); } catch (e) { setError(e.message); } };
  return (
    <div className="rq-wrap">
      <div className="rq-bar"><Link to="/purchases" className="btn sm">← All purchases</Link><span className={`pill ${p.status === 'confirmed' ? 'ok' : p.status === 'rejected' ? 'bad' : 'warn'}`}>{p.statusLabel}</span><SealBadge seal={p.seal} /><span className="grow" />
        {p.delivery && <DeliveryLabelsButton id={p.delivery.id} className="btn p" />}<PrintButton className="btn" /></div>
      {p.requisition && <p className="rq-note info">Bought for <Link to={`/requisitions/${p.requisition.id}`}>{p.requisition.number}</Link> · {p.school?.short}</p>}
      <div className="rq-sheet">
        <div className="rq-top"><img src="/musabe-logo.png" alt="" /><div><h2 style={{ margin: 0 }}>MUSABE SCHOOLS</h2><div className="rq-small">P.O. Box 5154, BUGANDO, MWANZA</div></div></div>
        <div className="rq-title">Fomu ya Manunuzi ya Kila Siku</div>
        <div className="rq-line"><span className="rq-no">No. <b style={{ color: '#c01818' }}>{p.number}</b></span><span className="rq-field" style={{ flex: '0 1 240px' }}><span>Date</span><span className="rq-val">{p.boughtOn}</span></span></div>
        {p.floatAmount != null && <div className="rq-line"><span className="rq-field"><span>FEDHA KUTOKA OFISINI</span><b>TSh {tsh(float)}</b></span></div>}
        <div className="tw"><table className="rq-t">
          <thead><tr><th style={{ width: 50 }}>S/N</th><th>DETAILS OF REQUEST</th><th className="n">QUANTITY</th><th className="n">PRICE</th><th className="n">TOTAL AMOUNT</th>{(p.canCheck || p.confirmed != null || p.lines.some((l) => l.confirmed != null)) && <th className="n">COUNTED</th>}</tr></thead>
          <tbody>{p.lines.map((l, i) => (
            <tr key={l.id}><td className="n">{i + 1}</td><td>{l.item}{p.canCheck && <input value={seen[l.id]?.note || ''} maxLength={200} placeholder="note if fewer" style={{ width: '100%', display: 'block' }} onChange={(e) => setSeen((s) => ({ ...s, [l.id]: { ...s[l.id], note: e.target.value } }))} />}</td>
              <td className="n">{l.qty}</td><td className="n">{tsh(l.unitCost)}</td><td className="n">{tsh(l.amount)}</td>
              {p.canCheck ? <td className="n"><input inputMode="numeric" value={seen[l.id]?.qty ?? ''} style={{ width: 70, textAlign: 'right' }} onChange={(e) => setSeen((s) => ({ ...s, [l.id]: { ...s[l.id], qty: digits(e.target.value) } }))} /></td>
                : l.confirmed != null ? <td className="n">{l.confirmed < l.qty ? <b style={{ color: '#c01818' }}>{l.confirmed}</b> : l.confirmed}{l.note && <div className="rq-small">{l.note}</div>}</td> : null}</tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={4}><b>JUMLA YA MANUNUZI</b></td><td className="n"><b>{tsh(p.total)}</b></td>{(p.canCheck || p.lines.some((l) => l.confirmed != null)) && <td />}</tr>
            {p.floatAmount != null && <tr><td colSpan={4}><b>BALANCE</b> <span className="rq-small">(to give back to the Cashier)</span></td><td className="n"><b>{tsh(Math.max(expected, 0))}</b></td>{(p.canCheck || p.lines.some((l) => l.confirmed != null)) && <td />}</tr>}
            {p.returnedAmount != null && <tr><td colSpan={4}><b>MONEY GIVEN BACK</b></td><td className="n"><b>{tsh(p.returnedAmount)}</b></td>{p.lines.some((l) => l.confirmed != null) && <td />}</tr>}</tfoot>
        </table></div>
        {p.settleNote && <p className="rq-small">Note: {p.settleNote}</p>}
        <div className="rq-signs">
          <Sg label="Jina la Mnunuzi + Sahihi" s={sg.bought} hint="" />
          <Sg label="Imeidhinishwa (Mapokezi)" s={sg.checked} hint={p.status === 'pending' ? 'waiting' : ''} />
          <Sg label={p.floatAmount != null ? 'Money back received (Cashier)' : 'Confirmed (accountant office)'} s={sg.settled || sg.confirmed} hint={p.status === 'checked' ? 'waiting' : ''} />
        </div>
      </div>
      <SealQR type="purchase" id={p.id} seal={p.seal} />
      <div className="rq-actions"><ErrorNote error={error} />
        {(p.canCheck || p.canSettle || p.canDecide || p.canReject) && <label>Note {p.canCheck ? '(needed if some came fewer)' : '(needed to reject, or if the money back is different)'}<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>}
        {p.canSettle && <label>Money the buyer gave back (TSh). It should be {tsh(Math.max(expected, 0))}<input inputMode="numeric" value={back} onChange={(e) => setBack(digits(e.target.value))} /></label>}
        <div className="row">
          {p.canReject && <button className="btn danger" disabled={!note.trim()} onClick={reject}>Reject</button>}
          {p.canCheck && <button className="btn p" onClick={() => setAsk('check')}>I checked: sign</button>}
          {p.canDecide && <button className="btn p" disabled={p.canSettle && back === ''} onClick={() => setAsk('settle')}>{p.canSettle ? 'I received the money: sign and close' : 'Confirm'}</button>}
        </div></div>
      {ask && <PinBox type="purchase" id={p.id} title={ask === 'check' ? 'Sign: goods checked' : 'Sign: money back received'} onCancel={() => setAsk(null)} onConfirm={ask === 'check' ? check : settle} />}
    </div>
  );
}
