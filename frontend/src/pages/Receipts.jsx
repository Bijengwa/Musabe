// Receipts: every receipt, live. Administration sees all schools (or the one chosen at the top);
// school staff see their own school. Late = paid but items not fully given after the set hours.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { useScope } from '../layout/scope';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, PageHead, Panel, SchoolPill, fmtWhen, tsh, Loading } from '../components/ui';
import { ReceiptModal, StatusPill, waited } from '../components/receipt';

const STATUSES = [['', 'All'], ['open', 'Not given yet'], ['part', 'Partly given'], ['given', 'Given'], ['late', 'Late']];

export default function Receipts() {
  const { user } = useAuth();
  const [scope] = useScope();
  const all = user.scope === 'all';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (method) params.set('method', method);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (q.trim()) params.set('q', q.trim());
  if (all && scope) params.set('school', scope);
  const qs = params.toString();

  const load = useCallback(() => api.get(`/receipts?${qs}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [qs]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useLive(['receipt', 'give'], load);

  const today = new Date().toLocaleDateString('en-CA');
  return (
    <>
      <PageHead title="Receipts" sub={all ? 'Every receipt from the bursars, live. Late ones need a follow-up with the library.' : `${user.school?.name} · receipts written by the bursar`}>
        <ExcelButton href={`/api/receipts/export.xlsx?${qs}`} />
      </PageHead>

      {data && (
        <div className="kpis">
          <Kpi tone="hi" label="Money today" value={`TSh ${tsh(data.today.money)}`}
            sub={[['Cash', data.today.cash], ['Bank', data.today.bank], ['Mobile', data.today.mobile], ['Control no.', data.today.control]].filter(([, v]) => v).map(([k, v]) => `${k} ${tsh(v)}`).join(' · ') || 'No sales yet'} />
          <Kpi label="Receipts today" value={data.today.count} />
          <Kpi tone={data.open.count ? 'warn' : ''} label="Not given yet" value={data.open.count} sub="Paid, waiting at the library" />
          <Kpi tone={data.open.late ? 'bad' : 'ok'} label="Late" value={data.open.late} sub={`Waiting more than ${data.lateHours} hours`} />
        </div>
      )}

      <div className="filters">
        <div className="seg">{STATUSES.map(([k, t]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t}</button>)}</div>
        <select aria-label="Payment" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">All payments</option><option value="cash">Cash</option><option value="bank">Bank</option><option value="mobile">Mobile money</option><option value="control">Control number</option>
        </select>
        <label className="datein">From<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="datein">To<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn sm" onClick={() => { setFrom(today); setTo(today); }}>Today</button>
        {(from || to) && <button className="linkbtn" onClick={() => { setFrom(''); setTo(''); }}>All dates</button>}
        <div className="searchbox"><Icon name="search" /><input placeholder="Receipt no., student, payer, reference" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {data && <span className="muted small">{data.totals.count} receipt{data.totals.count === 1 ? '' : 's'} · TSh {tsh(data.totals.money)}{data.more ? ` · showing the newest ${data.receipts.length}. Use dates to see the rest, or download Excel.` : ''}</span>}

      <ErrorNote error={error} />
      <Panel flush>
        {!data ? <Loading /> : !data.receipts.length ? <Empty>No receipts match.</Empty> : (
          <div className="tw"><table className="stafftable rtable">
            <thead><tr>
              <th className="stick">Receipt</th><th>Date</th>{all && <th>School</th>}<th>Student</th><th className="n">Amount</th><th>Payment</th><th>Library</th><th>Bursar</th>
            </tr></thead>
            <tbody>
              {data.receipts.map((r) => (
                <tr key={r.id} className={`clickrow${r.late ? ' lateRow' : ''}`} onClick={() => setOpen(r.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(r.id); }}>
                  <td className="stick"><b className="rnum sm">{r.number}</b></td>
                  <td data-l="Date">{fmtWhen(r.soldAt)}</td>
                  {all && <td data-l="School"><SchoolPill code={r.school.code} name={r.school.shortName} /></td>}
                  <td data-l="Student"><b>{r.studentName}</b> <span className="muted small">{r.studentClass}</span></td>
                  <td data-l="Amount" className="n money"><b>{tsh(r.total)}</b></td>
                  <td data-l="Payment">{r.methodLabel}{r.reference && <div className="small muted">{r.reference}</div>}</td>
                  <td data-l="Library"><StatusPill r={r} />{r.status !== 'given' && <div className="small muted">{waited(r.waitingHours)}</div>}</td>
                  <td data-l="Bursar" className="small">{r.soldBy}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Panel>
      {open && <ReceiptModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
