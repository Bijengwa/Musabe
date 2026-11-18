// The Requested Cash Payout Voucher, as on the paper: company line, MUSABE SCHOOLS, title, Date, Cheque No., Name of payee,
// S/NO | DETAIL | AMOUNT, TOTAL (with what it is for), Total in words, Prepared by / Signature of payee / Authorized by.
// Internal payment: Assistant Accountant prepares -> Financial Officer authorizes -> Cashier pays, the payee signs here on the screen.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { Empty, ErrorNote, tsh, useToast } from '../components/ui';
import { PrintButton } from '../components/barcode';
import { PinBox, SealBadge, SealQR, SignPad } from '../components/signing';
import { fmtDate } from '../components/paper';
import { inWords } from '../components/words';
import './requisition.css';

const TONE = { review: 'warn', pending: 'warn', paid: 'ok', rejected: 'bad' };
const ROWS = 15;
const digits = (v) => String(v ?? '').replace(/\D/g, '');
const dmy = (v) => (v ? new Date(v).toLocaleDateString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' }) : new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Dar_es_Salaam' }));

function Sig({ label, sign, hint, children }) {
  return (
    <div className="rq-sig">
      <div className="rq-sigline">{sign ? (sign.image ? <img className="rq-sigimg" src={sign.image} alt="" /> : <span className="rq-ink">{sign.by}</span>) : children}</div>
      <span>{label}</span>
      <span className="who">{sign ? <b>{sign.by}</b> : hint}</span>
      <span className="dt">{sign ? `Date: ${fmtDate(sign.at)}` : ''}</span>
    </div>
  );
}

export default function Voucher() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [v, setV] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({ payeeName: '', chequeNo: '', purpose: '', contractRef: '', lines: [{ detail: '', amount: '' }] });
  const [ask, setAsk] = useState(null);
  const [note, setNote] = useState('');
  const [payee, setPayee] = useState({ name: '', image: null });
  const load = useCallback(() => (id ? api.get(`/payments/${id}`).then((d) => { setV(d.payment); setError(''); setPayee((p) => ({ ...p, name: p.name || d.payment.payeeName || '' })); }).catch((e) => setError(e.message)) : Promise.resolve()), [id]);
  useEffect(() => { load(); }, [load]);
  useLive(['payment'], load);

  const isNew = !id;
  const lines = isNew ? f.lines.filter((l) => l.detail || l.amount) : (v?.lines || []);
  const total = isNew ? lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) : v?.amount || 0;
  const setLine = (i, k, val) => setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, [k]: val } : l)) }));
  const addRow = () => setF((x) => (x.lines.length < 14 ? { ...x, lines: [...x.lines, { detail: '', amount: '' }] } : x));

  if (id && !v) return <div className="rq-wrap"><Link to="/payments" className="btn sm">← All vouchers</Link><ErrorNote error={error} />{!error && <Empty>Loading…</Empty>}</div>;

  const canPay = v?.canDecide;
  const canAuth = v?.canAuthorize;
  const submitNew = async ({ pin, smsCode }) => {
    const d = await api.post('/payments', { ...f, lines: lines.map((l) => ({ detail: l.detail, amount: Number(l.amount) })), pin, smsCode });
    toast(`${d.payment.number} sent to the Financial Officer`); setAsk(null); navigate(`/payments/${d.payment.id}`, { replace: true });
  };
  const authorize = async ({ pin, smsCode }) => { await api.post(`/payments/${v.id}/authorize`, { approve: true, note, pin, smsCode }); toast(`${v.number} authorized`); setAsk(null); setNote(''); await load(); };
  const reject = async () => { try { await api.post(`/payments/${v.id}/authorize`, { approve: false, note }); toast(`${v.number} rejected`); setNote(''); await load(); } catch (e) { setError(e.message); } };
  const pay = async ({ pin, smsCode }) => { await api.post(`/payments/${v.id}/decide`, { approve: true, payeeName: payee.name, payeeImage: payee.image, note, pin, smsCode }); toast(`${v.number} paid`); setAsk(null); setNote(''); await load(); };
  const cannotPay = async () => { try { await api.post(`/payments/${v.id}/decide`, { approve: false, note }); toast(`${v.number} rejected`); setNote(''); await load(); } catch (e) { setError(e.message); } };

  const shown = [...lines];
  while (shown.length < ROWS) shown.push(null);
  const s = v?.signs || {};
  const isFloat = v?.kind === 'float';
  return (
    <div className="rq-wrap">
      <div className="rq-bar"><Link to="/payments" className="btn sm">← All vouchers</Link>
        {v ? <><span className={`pill ${TONE[v.status]}`}>{v.statusLabel}</span><SealBadge seal={v.seal} /></> : <h2 style={{ margin: 0 }}>New payout voucher</h2>}
        <span className="grow" />{v && <PrintButton />}</div>
      {v?.status === 'rejected' && <p className="rq-note bad"><b>Rejected</b>{v.authorizedBy && !v.paidBy ? ` by the Financial Officer (${v.authorizedBy})` : v.paidBy ? ` by the Cashier (${v.paidBy})` : ''}: {v.payNote || v.authorizeNote}</p>}
      {v?.requisition && <p className="rq-note info">Money to buy for <Link to={`/requisitions/${v.requisition.id}`}>{v.requisition.number}</Link>{v.requisition.school ? ` · ${v.requisition.school}` : ''}. Authorized by the Manager when he signed the requisition.</p>}
      <div className="rq-sheet">
        <div className="rq-top"><img src="/musabe-logo.png" alt="" /><div><h2 style={{ margin: 0 }}>KARAGWE MARKETING COMPANY LIMITED</h2>
          <b>MUSABE SCHOOLS</b><div className="rq-small">P.O BOX 5154 MWANZA</div></div></div>
        <div className="rq-title">Requested cash payout voucher</div>
        <div className="rq-line"><span className="rq-no">No. <b style={{ color: '#c01818' }}>{v?.number || '……'}</b></span>
          <span className="rq-field" style={{ flex: '0 1 240px' }}><span>Date</span><span className="rq-val">{dmy(v?.requestedAt)}</span></span>
          <label className="rq-field" style={{ flex: '0 1 280px' }}><span>Cheque No.</span>{isNew ? <input value={f.chequeNo} maxLength={40} onChange={(e) => setF({ ...f, chequeNo: e.target.value })} /> : <b>{v.chequeNo || ''}</b>}</label></div>
        <div className="rq-line"><label className="rq-field"><span>Name of payee</span>{isNew ? <input value={f.payeeName} maxLength={120} onChange={(e) => setF({ ...f, payeeName: e.target.value })} /> : <b>{v.payeeName || ''}</b>}</label></div>
        <div className="tw"><table className="rq-t">
          <thead><tr><th style={{ width: 70 }}>S/NO.</th><th>DETAIL</th><th className="n" style={{ width: 170 }}>AMOUNT</th></tr></thead>
          <tbody>{shown.map((l, i) => (isNew ? (
            <tr key={i}><td className="n">{i + 1}</td>
              <td><input value={f.lines[i]?.detail ?? ''} maxLength={200} style={{ width: '100%' }} onChange={(e) => { if (i >= f.lines.length) addRow(); else setLine(i, 'detail', e.target.value); }} /></td>
              <td className="n"><input inputMode="numeric" value={f.lines[i]?.amount ?? ''} style={{ width: '100%', textAlign: 'right' }} onChange={(e) => i < f.lines.length && setLine(i, 'amount', digits(e.target.value))} /></td></tr>
          ) : (
            <tr key={i}><td className="n">{l ? l.sn : ''}</td><td>{l?.detail || ''}</td><td className="n">{l ? tsh(l.amount) : ''}</td></tr>
          )))}</tbody>
          <tfoot><tr><td className="n"><b>TOTAL</b></td>
            <td>{isNew ? <input value={f.purpose} maxLength={120} placeholder="What is this payment for?" style={{ width: '100%' }} onChange={(e) => setF({ ...f, purpose: e.target.value })} /> : <b>{v.purpose}</b>}</td>
            <td className="n"><b>{total ? tsh(total) : ''}</b></td></tr></tfoot>
        </table></div>
        {isNew && <p className="rq-small" style={{ margin: '4px 0 0' }}>Rows are filled by typing in them. Up to 14 lines.{' '}
          <label>Agreement / contract (if this is a part payment) <input value={f.contractRef} maxLength={80} onChange={(e) => setF({ ...f, contractRef: e.target.value })} style={{ borderBottom: '1px dotted #2745a8' }} /></label></p>}
        {v?.contractRef && <p className="rq-small" style={{ margin: '4px 0 0' }}>Agreement: <b>{v.contractRef}</b></p>}
        <div className="rq-line" style={{ marginTop: 10 }}><span className="rq-field"><span>Total in words</span><b>{inWords(total)}</b></span></div>
        <div className="rq-signs" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <Sig label="Prepared by" sign={s.prepared} hint={isNew ? 'signed when you send it' : isFloat ? '' : ''} />
          <Sig label="Signature of payee" sign={s.payee} hint={v && v.status === 'pending' ? 'signs when paid' : ''}>
            {canPay && <span className="rq-small">sign below</span>}</Sig>
          <Sig label="Authorized by" sign={s.authorized} hint={canAuth ? 'your turn' : v?.status === 'review' ? 'waiting for the Financial Officer' : ''} />
        </div>
        <div className="rq-signs" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div /><Sig label="Paid by (Cashier)" sign={s.paid} hint={canPay ? 'your turn' : v?.status === 'pending' ? 'waiting for the Cashier' : ''} /><div />
        </div>
      </div>
      {v && <SealQR type="voucher" id={v.id} seal={v.seal} />}
      <div className="rq-actions">
        <ErrorNote error={error} />
        {isNew && <div className="row"><button className="btn p" disabled={!lines.length || f.payeeName.trim().length < 3 || f.purpose.trim().length < 3} onClick={() => { setError(''); setAsk({ kind: 'new', title: 'Sign and send to the Financial Officer', note: `Total TSh ${tsh(total)} to ${f.payeeName}.` }); }}>Sign and send</button></div>}
        {canAuth && <>
          <label>Note (needed to reject)<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="row"><button className="btn danger" disabled={!note.trim()} onClick={reject}>Reject</button>
            <button className="btn p" onClick={() => setAsk({ kind: 'auth', title: `Authorize ${v.number}`, note: `TSh ${tsh(v.amount)} to ${v.payeeName}.` })}>Authorize TSh {tsh(v.amount)}</button></div></>}
        {canPay && <div className="rq-sheet" style={{ padding: 14 }}>
          <b>Pay TSh {tsh(v.amount)}</b>
          <label>Name of the person who receives the money<input value={payee.name} maxLength={120} onChange={(e) => setPayee({ ...payee, name: e.target.value })} /></label>
          <p className="small" style={{ margin: '6px 0 2px' }}>The receiver signs here:</p>
          <SignPad onChange={(image) => setPayee((p) => ({ ...p, image }))} />
          <label>Note (needed if you cannot pay)<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="row"><button className="btn danger" disabled={!note.trim()} onClick={cannotPay}>Cannot pay</button>
            <button className="btn p" disabled={!payee.image || payee.name.trim().length < 3} onClick={() => setAsk({ kind: 'pay', title: `Give TSh ${tsh(v.amount)}`, note: `Paying ${payee.name}.` })}>Give the money and sign</button></div></div>}
      </div>
      {ask && <PinBox type="voucher" id={v?.id} title={ask.title} amountNote={ask.note} onCancel={() => setAsk(null)}
        onConfirm={ask.kind === 'new' ? submitNew : ask.kind === 'auth' ? authorize : pay} />}
    </div>
  );
}
