// Sales dashboard: only the finance office and the accountant office (and Super Admin / Director). Not bursars.
// Money in for the chosen days, by payment, school, item, class and seller, with a comparison to the days before.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { Empty, ErrorNote, ExcelButton, Kpi, PageHead, Panel, SchoolPill, tsh } from '../components/ui';
import { BarList, DayBars } from '../components/charts';
import { DateRange, presets, useSchoolQs } from '../components/common';

const monthLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
const dayLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export default function SalesDashboard() {
  const school = useSchoolQs();
  const month = presets().find(([k]) => k === 'month');
  const [from, setFrom] = useState(month[2]);
  const [to, setTo] = useState(month[3]);
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const qs = new URLSearchParams({ from, to, ...(school ? { school } : {}) }).toString();
  const load = useCallback(() => api.get(`/dashboard/sales?${qs}`).then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message)), [qs]);
  useEffect(() => { load(); }, [load]);
  useLive(['receipt', 'give', 'bill'], load);

  const k = d?.kpi;
  const change = k && k.previous.money ? Math.round(((k.money - k.previous.money) / k.previous.money) * 100) : null;
  const m = k?.methods;
  return (
    <>
      <PageHead title="Sales dashboard" sub="Money in from the bursars, live. Only the finance office and the accountant office see this page.">
        <ExcelButton href={`/api/reports/sales-book.xlsx?${qs}`} label="Sales book" />
        <ExcelButton href={`/api/reports/items-sold.xlsx?${qs}`} label="Items sold" />
      </PageHead>
      <div className="filters"><DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} /></div>
      <ErrorNote error={error} />
      {!d ? <Empty>Loading…</Empty> : (
        <>
          <div className="kpis">
            <Kpi tone="hi" label="Money in (TSh)" value={tsh(k.money)}
              sub={change == null ? 'nothing in the days before to compare' : `${change >= 0 ? '+' : ''}${change}% on the same number of days before (TSh ${tsh(k.previous.money)})`} />
            <Kpi label="Receipts" value={tsh(k.receipts)} sub={`${tsh(k.students)} students`} />
            <Kpi label="Average receipt (TSh)" value={tsh(k.average)} />
            <Kpi tone={d.controlNumbers.waiting ? 'warn' : ''} label="Control numbers waiting" value={d.controlNumbers.waiting}
              sub={`TSh ${tsh(d.controlNumbers.money)}${d.controlNumbers.expired ? ` · ${d.controlNumbers.expired} expired` : ''}`} />
            <Kpi tone={d.notGiven.qty ? 'warn' : 'ok'} label="Paid, not yet given" value={tsh(d.notGiven.qty)} sub={`items worth TSh ${tsh(d.notGiven.money)}`} />
          </div>
          <div className="grid2">
            <Panel title={d.groupedBy === 'month' ? 'Money per month' : 'Money per day'} sub={`${dayLabel(from)} – ${dayLabel(to)}`}>
              <DayBars data={d.trend} fmtLabel={d.groupedBy === 'month' ? monthLabel : dayLabel} todayLast={false} />
            </Panel>
            <Panel title="How it was paid">
              <BarList rows={[['Cash', m.cash], ['Bank', m.bank], ['Mobile money', m.mobile], ['Control number', m.control]]} value={(r) => r[1]} label={(r) => r[0]}
                sub={(r) => (k.money ? `${Math.round((r[1] / k.money) * 100)}%` : '')} empty="No sales in these days." />
            </Panel>
          </div>
          <div className="grid2">
            {!school && <Panel title="By school"><BarList rows={d.bySchool} value={(r) => r.money} label={(r) => r.name} sub={(r) => `${r.n} receipts`} empty="No sales." /></Panel>}
            <Panel title="By class" sub="top 12"><BarList rows={d.classes} value={(r) => r.money} label={(r) => r.name} sub={(r) => `${r.n} receipts`} empty="No sales." /></Panel>
            {school && <Panel title="Sellers"><BarList rows={d.sellers} value={(r) => r.money} label={(r) => r.name} sub={(r) => `${r.n} receipts`} empty="No sales." /></Panel>}
          </div>
          <div className="grid2">
            <Panel title="Items sold" flush>
              {!d.items.length ? <Empty>No sales.</Empty> : (
                <div className="tw"><table className="lines">
                  <thead><tr><th>Item</th><th className="n">Qty</th><th className="n">Amount (TSh)</th><th className="n">Share</th></tr></thead>
                  <tbody>{d.items.map((i) => <tr key={i.name}><td>{i.name}</td><td className="n">{tsh(i.qty)}</td><td className="n money">{tsh(i.money)}</td>
                    <td className="n small muted">{k.money ? `${Math.round((i.money / k.money) * 100)}%` : ''}</td></tr>)}</tbody>
                  <tfoot><tr><td>Total</td><td className="n">{tsh(d.items.reduce((s, i) => s + i.qty, 0))}</td><td className="n money">{tsh(k.money)}</td><td /></tr></tfoot>
                </table></div>
              )}
            </Panel>
            {!school && (
              <Panel title="Sellers" flush>
                {!d.sellers.length ? <Empty>No sales.</Empty> : (
                  <div className="tw"><table className="lines">
                    <thead><tr><th>Name</th><th>School</th><th className="n">Receipts</th><th className="n">Amount (TSh)</th></tr></thead>
                    <tbody>{d.sellers.map((s, i) => <tr key={i}><td>{s.name}<div className="small muted">{s.role}</div></td><td><SchoolPill code={s.code} name={s.school} /></td>
                      <td className="n">{s.n}</td><td className="n money">{tsh(s.money)}</td></tr>)}</tbody>
                  </table></div>
                )}
              </Panel>
            )}
          </div>
          <p className="small muted" style={{ margin: 0 }}>More files on the <Link to="/reports">Reports</Link> page. Check each bursar's cash on <Link to="/money">Daily money</Link>.</p>
        </>
      )}
    </>
  );
}
