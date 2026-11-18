// Control numbers. The bursar makes one on "Sell" (Paid with: Control number). The parent pays at the bank or by
// mobile money. When the money is seen, the bursar or the accountant marks it paid: the receipt is written then.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, Modal, PageHead, Panel, SchoolPill, fmtPhone, fmtWhen, tsh, useToast } from '../components/ui';
import { ControlSlip, PrintSlipButton, useSchoolQs } from '../components/common';
import { PrintButton, ReceiptBook } from '../components/receipt';

const TONE = { pending: 'warn', expired: 'bad', paid: 'ok', cancelled: '' };
const TABS = [['', 'All'], ['pending', 'Waiting for payment'], ['expired', 'Expired'], ['paid', 'Paid'], ['cancelled', 'Cancelled']];

export default function Bills() {
  const { user } = useAuth();
  const school = useSchoolQs();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const p = new URLSearchParams();
  if (school) p.set('school', school);
  if (status) p.set('status', status);
  if (q.trim()) p.set('q', q.trim());
  const qs = p.toString();
  const load = useCallback(() => api.get(`/bills?${qs}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [qs]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useLive(['bill', 'receipt'], load);
  const all = user.scope === 'all';
  const t = data?.totals;
  return (
    <>
      <PageHead title="Control numbers" sub={`The parent pays at the bank or by mobile money with the control number. When the money is seen, mark it paid: the receipt is written then. Valid ${data?.validDays || 7} days.`}>
        <ExcelButton href={`/api/bills/export.xlsx?${qs}`} />
        {data?.canCreate && <Link className="btn p" to="/sell?pay=control"><Icon name="plus" /> Make control number</Link>}
      </PageHead>
      {t && (
        <div className="kpis">
          <Kpi tone="hi" label="Waiting for payment" value={t.pending} sub={`TSh ${tsh(t.pendingMoney)}`} />
          <Kpi tone={t.expired ? 'bad' : 'ok'} label="Expired, not paid" value={t.expired} sub="renew before payment, or cancel" />
          <Kpi label="Paid today" value={t.paidToday} sub={`TSh ${tsh(t.paidTodayMoney)}`} />
        </div>
      )}
      <div className="filters">
        <div className="seg">{TABS.map(([k, l]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>)}</div>
        <div className="searchbox"><Icon name="search" /><input placeholder="Control number or name" value={q} onChange={(e) => setQ(e.target.value)} inputMode="search" /></div>
      </div>
      <ErrorNote error={error} />
      <Panel flush>
        {!data ? <Empty>Loading…</Empty> : !data.bills.length ? <Empty>No control numbers here.</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th className="stick">Control no.</th><th>Made</th>{all && <th>School</th>}<th>Student</th><th className="n">Amount</th><th>Status</th><th>Receipt</th></tr></thead>
            <tbody>{data.bills.map((b) => (
              <tr key={b.id} className={`clickrow${b.status === 'expired' ? ' lateRow' : ''}`} onClick={() => setOpen(b.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(b.id); }}>
                <td className="stick"><b className="mono">{b.controlSpaced}</b></td>
                <td className="small">{fmtWhen(b.createdAt)}<div className="muted">{b.createdBy}</div></td>
                {all && <td><SchoolPill code={b.code} name={b.school} /></td>}
                <td><b>{b.studentName}</b> <span className="muted small">{b.studentClass}</span>{b.payerPhone && <div className="small muted">{b.payerName} · {fmtPhone(b.payerPhone)}</div>}</td>
                <td className="n money"><b>{tsh(b.total)}</b></td>
                <td><span className={`pill ${TONE[b.status]}`}>{b.statusLabel}</span>{b.status === 'pending' && <div className="small muted">until {new Date(b.expiresAt).toLocaleDateString('en-GB')}</div>}</td>
                <td className="small">{b.receiptNumber ? <b className="rnum sm">{b.receiptNumber}</b> : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {open && <BillModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function BillModal({ id, onClose }) {
  const toast = useToast();
  const [b, setB] = useState(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState(null); // pay | cancel
  const [ref, setRef] = useState('');
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const load = useCallback(() => api.get(`/bills/${id}`).then((d) => setB(d.bill)).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  useLive(['bill'], load);
  const act = async (path, body, msg) => {
    setBusy(true); setError('');
    try {
      const d = await api.post(`/bills/${id}/${path}`, body);
      setB(d.bill); setMode(null); toast(msg(d));
      if (d.receipt) setReceipt(d.receipt);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  if (receipt) {
    return (
      <Modal wide title={`Paid · receipt ${receipt.number}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><PrintButton r={receipt} autoFocus /></>}>
        <p className="okmsg" style={{ marginBottom: 12 }}><Icon name="check" /> Payment recorded. Receipt {receipt.number} is written and the library can give the items now.</p>
        <div className="rpreview"><ReceiptBook r={receipt} /></div>
      </Modal>
    );
  }
  return (
    <Modal wide title={b ? `Control number ${b.controlSpaced}` : 'Control number'} onClose={onClose}
      footer={b && <>
        <button className="btn" onClick={onClose}>Close</button>
        {b.canCancel && <button className="btn danger" onClick={() => setMode('cancel')}>Cancel it</button>}
        {b.canRenew && b.status === 'expired' && <button className="btn" disabled={busy} onClick={() => act('renew', {}, () => 'Renewed')}>Renew</button>}
        {(b.status === 'pending' || b.status === 'expired') && <PrintSlipButton b={b} />}
        {b.canPay && <button className="btn p" onClick={() => setMode('pay')}><Icon name="check" /> Mark as paid</button>}
      </>}>
      <ErrorNote error={error} />
      {!b ? <Empty>Loading…</Empty> : (
        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className={`pill ${TONE[b.status]}`}>{b.statusLabel}</span>
            {b.paidAt && <span className="small">Paid {fmtWhen(b.paidAt)} · {b.paidRef} · confirmed by {b.paidBy} · receipt <b>{b.receiptNumber}</b></span>}
            {b.cancelledAt && <span className="small">Cancelled {fmtWhen(b.cancelledAt)} by {b.cancelledBy}: {b.cancelReason}</span>}
          </div>
          {mode === 'pay' && (
            <div className="paybox stack">
              <b>Mark as paid only after you see the money on the school account.</b>
              <div className="fg">
                <label>Bank / mobile money transaction number<input value={ref} onChange={(e) => setRef(e.target.value)} autoFocus placeholder="e.g. FT26318ABCD" /></label>
                <label>Control number on the bank slip (check)<input value={typed} onChange={(e) => setTyped(e.target.value.replace(/[^\d ]/g, ''))} inputMode="numeric" placeholder={b.controlSpaced} /></label>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => setMode(null)}>Back</button>
                <button className="btn p" disabled={busy || ref.trim().length < 4} onClick={() => act('paid', { paidRef: ref, ...(typed.trim() ? { controlNo: typed } : {}) }, (d) => `Paid. Receipt ${d.receipt.number} written.`)}>
                  {busy ? 'Saving…' : `Paid TSh ${tsh(b.total)} · write the receipt`}</button>
              </div>
            </div>
          )}
          {mode === 'cancel' && (
            <div className="paybox stack">
              <label>Why is it cancelled?<input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="e.g. parent changed the items" /></label>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => setMode(null)}>Back</button>
                <button className="btn danger-bg" disabled={busy || reason.trim().length < 3} onClick={() => act('cancel', { reason }, () => 'Cancelled')}>Cancel the control number</button>
              </div>
            </div>
          )}
          <div className="rpreview"><ControlSlip b={b} /></div>
        </div>
      )}
    </Modal>
  );
}
