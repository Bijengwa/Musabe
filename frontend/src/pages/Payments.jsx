// Money going out. Two kinds in one list: Requisition payments (the Cashier gives money on the Payment Requisition Form itself, opened from
// the requisition page) and Requested Cash Payout Vouchers (internal payments). One list; each voucher opens as its own paper page (pages/Voucher.jsx).
// Internal payment: Assistant Accountant prepares -> Manager or Finance Manager authorizes -> Cashier pays (the payee signs on screen).
// Money to buy for an approved requisition is made by the system when the Manager signs; the Cashier pays it the same way.
import { useCallback, useEffect, useState } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { Empty, ErrorNote, Icon, Kpi, PageHead, Panel, tsh, Loading } from '../components/ui';
import Voucher from './Voucher';

const TONE = { review: 'warn', pending: 'warn', paid: 'ok', rejected: 'bad' };

export default function Payments() {
  return (
    <Routes>
      <Route index element={<PList />} />
      <Route path="new" element={<Voucher />} />
      <Route path=":id" element={<Voucher />} />
    </Routes>
  );
}

function PList() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const qs = [status && `status=${status}`, kind && `kind=${kind}`].filter(Boolean).join('&');
  const url = qs ? `/payments?${qs}` : '/payments';
  const load = useCallback(() => api.get(url).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [url]);
  useEffect(() => { load(); }, [load]);
  useLive(['payment', 'requisition'], load);
  return (
    <>
      <PageHead title="Payments" sub="Requisition payments: the Cashier gives money against the Payment Requisition Form. Payout vouchers: prepared by the Assistant Accountant, authorized by the Manager or the Finance Manager, paid by the Cashier.">
        {data?.canWrite && <button className="btn p" onClick={() => navigate('/payments/new')}><Icon name="plus" /> New voucher</button>}
      </PageHead>
      {data && <div className="kpis">
        <Kpi tone={data.review ? 'warn' : 'ok'} label="Waiting for the Manager / Finance Manager" value={data.review} />
        <Kpi tone={data.pending ? 'warn' : 'ok'} label="Waiting for the Cashier" value={data.pending} />
        <Kpi label="Paid this month" value={`TSh ${tsh(data.paidThisMonth)}`} />
      </div>}
      <div className="filters"><div className="seg">{[['', 'All payments'], ['float', 'Requisition payments'], ['general', 'Payout vouchers']].map(([k, t]) =>
        <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{t}</button>)}</div>
      <div className="seg">{[['', 'All'], ['review', 'To authorize'], ['pending', 'To pay'], ['paid', 'Paid'], ['rejected', 'Rejected']].map(([k, t]) =>
        <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t}</button>)}</div></div>
      <ErrorNote error={error} />
      <Panel flush>
        {!data ? <Loading /> : !data.payments.length ? <Empty>Nothing here.</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th>No.</th><th className="stick">Payee / for</th><th className="n">Amount (TSh)</th><th>Prepared by</th><th>Status</th></tr></thead>
            <tbody>{data.payments.map((p) => (
              <tr key={p.id} onClick={() => navigate(p.kind === 'float' && p.requisition ? `/requisitions/${p.requisition.id}` : `/payments/${p.id}`)} style={{ cursor: 'pointer' }}>
                <td className="mono small">{p.number}{p.requisition && <div className="muted">{p.requisition.number}{p.requisition.school ? ` · ${p.requisition.school}` : ''}</div>}</td>
                <td className="stick small">{p.payeeName && <b>{p.payeeName}<br /></b>}{p.purpose}</td>
                <td className="n"><b>{tsh(p.amount)}</b></td>
                <td className="small">{p.requestedBy}</td>
                <td><span className={`pill wrap ${TONE[p.status]}`}>{p.statusLabel}</span>{(p.canDecide || p.canAuthorize) && <span className="pill warn sm" style={{ marginLeft: 6 }}>Your turn</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
