/* eslint-disable react-refresh/only-export-components */
// One home page per role. The numbers come from GET /api/dashboard (backend/src/routes/dashboard.js),
// which sends each role only its own set. Everything refreshes live.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useLive } from '../../live';
import { useScope } from '../../layout/scope';
import { Empty, Icon, Kpi, Panel, SchoolPill, fmtWhen, tsh } from '../../components/ui';
import { ReceiptModal, waited } from '../../components/receipt';
import { BarList, DayBars } from '../../components/charts';

export function useDashboard() {
  const { user } = useAuth();
  const [scope] = useScope();
  const qs = user.scope === 'all' && scope ? `?school=${scope}` : '';
  const [d, setD] = useState(null);
  const [error, setError] = useState(null); // { qs, message }: shown instead of loading forever
  const load = useCallback(() => api.get(`/dashboard${qs}`).then((x) => { setD({ qs, ...x }); setError(null); })
    .catch((e) => setError({ qs, message: e.message })), [qs]);
  useEffect(() => { load(); }, [load]);
  useLive(['receipt', 'give', 'student', 'item', 'itemimport', 'studentimport', 'class', 'stock', 'delivery', 'request', 'damage', 'bill', 'money', 'payment', 'requisition', 'purchase', 'count', 'issue', 'store'], load);
  return { d: d?.qs === qs ? d : null, error: error?.qs === qs ? error.message : '', reload: load };
}

const methods = (t) => [['Cash', t.cash], ['Bank', t.bank], ['Mobile', t.mobile], ['Control no.', t.control]].filter(([, v]) => v).map(([k, v]) => `${k} ${tsh(v)}`).join(' · ') || 'No sales yet';

function MoneyKpis({ sales, mine }) {
  return (
    <>
      <Kpi tone="hi" label={mine ? 'My sales today (TSh)' : 'Money today (TSh)'} value={tsh(sales.today.money)} sub={`${sales.today.n} receipt${sales.today.n === 1 ? '' : 's'} · ${methods(sales.today)}`} />
      <Kpi label="Last 7 days (TSh)" value={tsh(sales.week.money)} sub={`${sales.week.n} receipts`} />
      <Kpi label="This month (TSh)" value={tsh(sales.month.money)} sub={`${sales.month.n} receipts`} />
    </>
  );
}
// Paid but not given, with the late ones (waiting longer than the set hours) in the same box.
const OpenKpis = ({ open }) => (
  <Kpi tone={open.late ? 'bad' : open.n ? 'warn' : 'ok'} label="Not given yet" value={open.n}
    sub={open.n ? `${open.late ? `${open.late} late (over ${open.lateHours} h) · ` : 'none late · '}TSh ${tsh(open.money)} waiting` : 'Library is up to date'} />
);

function OpenList({ open, title = 'Paid, not given yet', sub, give, showSchool }) {
  const [view, setView] = useState(null);
  return (
    <Panel title={title} sub={sub ?? (open.n > open.oldest.length ? `oldest ${open.oldest.length} of ${open.n}` : '')} flush
      right={<Link className="btn sm" to={give ? '/give' : '/receipts'}>{give ? 'Give items' : 'All receipts'}</Link>}>
      {!open.oldest.length ? <Empty>Nothing waiting. Every paid receipt has been given.</Empty> : (
        <div className="list">
          {open.oldest.map((r) => (
            <div key={r.id} className={`li${r.late ? ' lateli' : ''}`}>
              <div className="grow"><b><span className="rnum sm">{r.number}</span> · {r.student}</b>
                <span>{showSchool ? `${r.school} · ` : ''}{r.cls} · TSh {tsh(r.total)} · waiting {waited(r.hours)}</span></div>
              {r.late ? <span className="pill bad">Late</span> : r.status === 'part' ? <span className="pill info">Part given</span> : null}
              {give ? <Link className="btn sm p" to={`/give?q=${encodeURIComponent(r.number)}`}><Icon name="hand" /> Give</Link>
                : <button className="btn sm" onClick={() => setView(r.id)}>Open</button>}
            </div>
          ))}
        </div>
      )}
      {view && <ReceiptModal id={view} onClose={() => setView(null)} />}
    </Panel>
  );
}

const Trend = ({ trend }) => (
  <Panel title="Money per day" sub={`last ${trend.length} days`}><DayBars data={trend} /></Panel>
);

function Schools({ rows }) {
  return (
    <Panel title="Schools" sub="money this month">
      <BarList rows={rows} label={(s) => s.name} value={(s) => s.month} sub={(s) => `Today ${tsh(s.today)} · ${s.open} not given${s.late ? ` · ${s.late} late` : ''}`} />
    </Panel>
  );
}
const TopItems = ({ rows }) => (
  <Panel title="What sells most" sub="last 30 days">
    <BarList rows={rows} label={(i) => i.name} value={(i) => i.money} sub={(i) => `${i.qty} sold`} empty="No sales in the last 30 days." />
  </Panel>
);
function StudentsBySchool({ st }) {
  return (
    <Panel title="Students" sub={`${st.total} at school`} right={<Link className="btn sm" to="/students">Students</Link>}>
      <BarList rows={st.schools} label={(s) => s.name} value={(s) => s.n} fmt={(v) => String(v)} sub={(s) => `${s.boys} boys · ${s.girls} girls`} empty="No students loaded yet." />
    </Panel>
  );
}
function StudentsByClass({ st }) {
  return (
    <Panel title="Students per class" sub={`${st.total} · ${st.boys} boys · ${st.girls} girls`} flush right={<Link className="btn sm" to="/students">Students</Link>}>
      {!st.classes.length ? <Empty>No classes yet.</Empty> : (
        <div className="tw"><table>
          <thead><tr><th>Class</th><th className="n">Students</th><th className="n">Boys</th><th className="n">Girls</th><th className="n">No phone</th></tr></thead>
          <tbody>{st.classes.map((c) => (
            <tr key={c.id}><td><b>{c.label}</b> <span className="muted small">{c.name}</span></td><td className="n"><b>{c.n}</b></td><td className="n">{c.boys}</td><td className="n">{c.girls}</td>
              <td className="n">{c.noPhone ? <span className="pill warn">{c.noPhone}</span> : '—'}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </Panel>
  );
}
function ItemsPanel({ items, canUpload }) {
  const gaps = items.unpriced.filter((s) => s.n);
  return (
    <Panel title="Items & prices" sub={`${items.active} on sale`} right={<Link className="btn sm" to="/items">Items & prices</Link>}>
      <div className="stack">
        {items.pendingUploads > 0 && (
          <div className="warnnote"><Icon name="clock" /><div><b>{items.pendingUploads} Excel upload{items.pendingUploads === 1 ? '' : 's'} waiting for approval.</b>
            {canUpload && <div className="small"><Link to="/items">Review now</Link></div>}</div></div>
        )}
        <div className="small muted">Items with no price in a school (not sold there):</div>
        {items.unpriced.map((s) => (
          <div key={s.id} className="row" style={{ justifyContent: 'space-between' }}><SchoolPill code={s.code} name={s.name} /><b>{s.n}</b></div>
        ))}
        {!gaps.length && <span className="small">Every item has a price in every school.</span>}
      </div>
    </Panel>
  );
}
function Bursars({ rows: all }) {
  const total = all.reduce((s, r) => s + r.money, 0);
  const rows = all.filter((b) => b.n).sort((a, b) => b.money - a.money);
  const idle = all.filter((b) => !b.n);
  return (
    <Panel title="Bursars today" sub={`TSh ${tsh(total)} in total — check each bursar's money against this`} flush right={<Link className="btn sm" to="/receipts">Receipts</Link>}>
      {!all.length ? <Empty>No bursar accounts yet.</Empty> : !rows.length ? <Empty>No receipts written today yet.</Empty> : (
        <div className="tw"><table>
          <thead><tr><th className="stick">Bursar</th><th>School</th><th className="n">Receipts</th><th className="n">Cash</th><th className="n">Bank</th><th className="n">Mobile</th><th className="n">Total</th><th>Last receipt</th></tr></thead>
          <tbody>{rows.map((b) => (
            <tr key={b.id}><td className="stick"><b>{b.name}</b></td><td><SchoolPill code={b.code} name={b.school} /></td>
              <td className="n">{b.n}</td><td className="n">{tsh(b.cash)}</td><td className="n">{tsh(b.bank)}</td><td className="n">{tsh(b.mobile)}</td>
              <td className="n"><b>{tsh(b.money)}</b></td><td className="small">{b.last ? fmtWhen(b.last) : <span className="muted">None today</span>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {idle.length > 0 && rows.length > 0 && <p className="small muted pad" style={{ margin: 0 }}>+ {idle.length} bursar{idle.length === 1 ? '' : 's'} with no receipts today: {idle.map((b) => `${b.name} (${b.school})`).join(', ')}</p>}
    </Panel>
  );
}

// "To do": the work waiting for this person (server decides by role, see routes/dashboard.js todo()).
export function ToDo({ items }) {
  if (!items) return null;
  return (
    <Panel title="To do" sub={items.length ? `${items.length} thing${items.length === 1 ? '' : 's'} waiting for you` : ''}>
      {!items.length ? <p className="okmsg" style={{ margin: 0 }}><Icon name="check" /> Nothing waiting for you. All up to date.</p> : (
        <div className="todo">{items.map((t) => (
          <Link key={t.label} to={t.link} className={`tdi ${t.tone}`}>
            <b>{t.n}</b><span>{t.label}{t.sub && <em> · {t.sub}</em>}</span><Icon name="chev" />
          </Link>
        ))}</div>
      )}
    </Panel>
  );
}

const RSTATUS = { pending: ['Waiting', 'warn'], sent: ['Stock sent', 'ok'], declined: ['Declined', 'bad'], withdrawn: ['Withdrawn', ''],
  approved: ['Approved', 'ok'], rejected: ['Rejected', 'bad'] };
const Pill = ({ s }) => <span className={`pill ${RSTATUS[s]?.[1] || ''}`}>{RSTATUS[s]?.[0] || s}</span>;

// ---------- the homes ----------
export function DirectorHome({ d }) {
  return (
    <>
      <div className="kpis"><MoneyKpis sales={d.sales} /><Kpi label="Students" value={d.students.total} sub="at school now" /><OpenKpis open={d.open} /></div>
      <div className="grid2"><Trend trend={d.trend} />{d.school ? <TopItems rows={d.topItems} /> : <Schools rows={d.bySchool} />}</div>
      <div className="grid2">{d.school ? <StudentsByClass st={d.students} /> : <StudentsBySchool st={d.students} />}{!d.school && <TopItems rows={d.topItems} />}</div>
    </>
  );
}

export function ManagerHome({ d }) {
  return (
    <>
      <div className="kpis"><Kpi tone="hi" label="Money today (TSh)" value={tsh(d.sales.today.money)} sub={`${d.sales.today.n} receipts`} /><Kpi label="This month (TSh)" value={tsh(d.sales.month.money)} /><OpenKpis open={d.open} />
        <Kpi tone={d.open.late ? 'bad' : 'ok'} label="Late" value={d.open.late} sub={`to follow up (over ${d.open.lateHours} h)`} /></div>
      <OpenList open={d.open} title="Receipts to follow up" showSchool={!d.school} />
      <div className="grid2"><Schools rows={d.bySchool} /><TopItems rows={d.topItems} /></div>
    </>
  );
}

export function FinanceHome({ d }) {
  const { can } = useAuth();
  return (
    <>
      <div className="kpis"><MoneyKpis sales={d.sales} /><OpenKpis open={d.open} /></div>
      <div className="grid2"><Trend trend={d.trend} /><ItemsPanel items={d.items} canUpload={can('itemsupload', 'f')} /></div>
      <div className="grid2"><Schools rows={d.bySchool} /><TopItems rows={d.topItems} /></div>
    </>
  );
}

export function AccountantHome({ d }) {
  return (
    <>
      <div className="kpis">
        <Kpi tone="hi" label="Money today (TSh)" value={tsh(d.sales.today.money)} sub={`${d.sales.today.n} receipts`} />
        <Kpi label="Cash" value={tsh(d.sales.today.cash)} /><Kpi label="Bank" value={tsh(d.sales.today.bank)} /><Kpi label="Mobile money" value={tsh(d.sales.today.mobile)} />{d.sales.today.control > 0 && <Kpi label="Control no." value={tsh(d.sales.today.control)} />}
        <Kpi tone={d.open.late ? 'bad' : 'ok'} label="Late receipts" value={d.open.late} sub={`${d.open.n} not given in total`} />
      </div>
      <Bursars rows={d.bursars} />
      <div className="grid2"><OpenList open={d.open} title="Paid, not given (oldest first)" showSchool={!d.school} /><Trend trend={d.trend} /></div>
    </>
  );
}

export function SuperHome({ d }) {
  return (
    <>
      <div className="kpis"><MoneyKpis sales={d.sales} /><Kpi label="Students" value={d.students.total} /><OpenKpis open={d.open} /></div>
      <div className="grid2">{d.school ? <StudentsByClass st={d.students} /> : <Schools rows={d.bySchool} />}{d.school ? <Trend trend={d.trend} /> : <StudentsBySchool st={d.students} />}</div>
      {d.items.pendingUploads > 0 && <div className="warnnote"><Icon name="clock" /><span><b>{d.items.pendingUploads} item upload(s)</b> waiting for the Finance Manager's approval.</span></div>}
    </>
  );
}

export function SchoolAdminHome({ d }) {
  const st = d.students;
  return (
    <>
      <div className="kpis">
        <Kpi tone="hi" label="Students" value={st.total} sub={`${st.boys} boys · ${st.girls} girls`} />
        <Kpi label="Classes" value={st.classes.length} sub={`${st.classes.filter((c) => !c.n).length} with no students`} />
        <Kpi tone={st.noPhone ? 'warn' : ''} label="No parent phone" value={st.noPhone} sub="Add phones on the student's page" />
        <Kpi tone={d.pendingLists ? 'warn' : ''} label="Class lists waiting" value={d.pendingLists} sub={d.pendingLists ? <Link to="/students/upload">Review</Link> : 'None'} />
      </div>
      <div className="row"><Link className="btn p" to="/students/new"><Icon name="plus" /> Add student</Link><Link className="btn" to="/students/upload"><Icon name="upload" /> Upload class list</Link></div>
      <StudentsByClass st={st} />
    </>
  );
}

export function HeadHome({ d }) {
  return (
    <>
      <div className="kpis"><MoneyKpis sales={d.sales} /><Kpi label="Students" value={d.students.total} sub={`${d.students.boys} boys · ${d.students.girls} girls`} />
        <Kpi label="Library today" value={d.library.receipts} sub={`receipts served · ${d.library.qty} items given`} /><OpenKpis open={d.open} /></div>
      <div className="grid2"><Trend trend={d.trend} /><OpenList open={d.open} /></div>
      <div className="grid2"><StudentsByClass st={d.students} /><TopItems rows={d.topItems} /></div>
    </>
  );
}

export function BursarHome({ d }) {
  const [view, setView] = useState(null);
  return (
    <>
      <Link className="btn p big bigsell" to="/sell"><Icon name="cart" /> New sale</Link>
      <div className="kpis">
        <Kpi tone="hi" label="My sales today (TSh)" value={tsh(d.sales.today.money)} sub={`${d.sales.today.n} receipt${d.sales.today.n === 1 ? '' : 's'}`} />
        <Kpi label="Cash" value={tsh(d.sales.today.cash)} sub="count this money" /><Kpi label="Bank" value={tsh(d.sales.today.bank)} /><Kpi label="Mobile money" value={tsh(d.sales.today.mobile)} />{d.sales.today.control > 0 && <Kpi label="Control no." value={tsh(d.sales.today.control)} />}
        <Kpi tone={d.open.late ? 'bad' : d.open.n ? 'warn' : 'ok'} label="My receipts not given" value={d.open.n} sub={d.open.late ? `${d.open.late} late` : 'at the library'} />
      </div>
      <div className="grid2">
        <Panel title="My last receipts" flush right={<Link className="btn sm" to="/receipts">All</Link>}>
          {!d.recent.length ? <Empty>No receipts yet.</Empty> : <div className="list">{d.recent.map((r) => (
            <button key={r.id} className="li libtn" onClick={() => setView(r.id)}>
              <div className="grow"><b><span className="rnum sm">{r.number}</span> · {r.student}</b><span>{r.cls} · {r.method} · {fmtWhen(r.soldAt)}</span></div><b className="money">{tsh(r.total)}</b>
            </button>))}</div>}
        </Panel>
        <OpenList open={d.open} title="My receipts still at the library" />
      </div>
      <div className="grid2">
        <Panel title="My control numbers waiting for payment" flush right={<Link className="btn sm" to="/control-numbers">All</Link>}>
          {!d.work.bills.length ? <Empty>None waiting.</Empty> : <div className="list">{d.work.bills.map((b) => (
            <Link key={b.id} to="/control-numbers" className="li libtn"><div className="grow"><b className="mono">{b.controlNo}</b><span>{b.student} · {b.expired ? 'expired' : `valid until ${new Date(b.expiresAt).toLocaleDateString('en-GB')}`}</span></div>
              <b className="money">{tsh(b.total)}</b>{b.expired && <span className="pill bad">Expired</span>}</Link>))}</div>}
        </Panel>
        <Panel title="My daily money (accountant's check)" flush right={<Link className="btn sm" to="/money">Daily money</Link>}>
          {!d.work.checks.length ? <Empty>No checks yet.</Empty> : <div className="list">{d.work.checks.map((c) => (
            <div key={c.day} className="li"><div className="grow"><b>{new Date(`${c.day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</b>
              <span>Cash TSh {tsh(c.cash)} · counted {tsh(c.counted)}{c.note ? ` · ${c.note}` : ''}</span></div>
              <span className={`pill ${c.result === 'ok' ? 'ok' : 'bad'}`}>{c.result === 'ok' ? 'Correct' : c.result === 'short' ? `Short ${tsh(c.cash - c.counted)}` : `Over ${tsh(c.counted - c.cash)}`}</span></div>))}</div>}
        </Panel>
      </div>
      {view && <ReceiptModal id={view} onClose={() => setView(null)} />}
    </>
  );
}

export function LibrarianHome({ d }) {
  return (
    <>
      <Link className="btn p big bigsell" to="/give"><Icon name="hand" /> Give items</Link>
      <div className="kpis">
        <Kpi tone={d.open.n ? 'warn' : 'ok'} label="Waiting to be given" value={d.open.n} sub="receipts paid at the bursar" />
        <Kpi tone={d.open.late ? 'bad' : 'ok'} label="Late" value={d.open.late} sub={`more than ${d.open.lateHours} hours`} />
        <Kpi tone="hi" label="Served today" value={d.library.receipts} sub={`${d.library.qty} items given`} />
      </div>
      <div className="grid2">
        <OpenList open={d.open} title="Waiting (oldest first)" give />
        <Panel title="Given today"><BarList rows={d.library.items} label={(i) => i.name} value={(i) => i.qty} fmt={(v) => `${v}`} empty="Nothing given yet today." /></Panel>
      </div>
      <div className="grid2">
        <Panel title="Stock coming to the library" flush right={<Link className="btn sm" to="/incoming">Incoming stock</Link>}>
          {!d.work.incoming.length ? <Empty>Nothing on the way.</Empty> : <div className="list">{d.work.incoming.map((x) => (
            <Link key={x.id} to="/incoming" className="li libtn"><div className="grow"><b><span className="mono">{x.number}</span> · {x.lines} item{x.lines === 1 ? '' : 's'}, {x.units} pieces</b>
              <span>Sent {fmtWhen(x.sentAt)} · count it and confirm</span></div><span className="pill warn">To confirm</span></Link>))}</div>}
        </Panel>
        <Panel title="My requests and damage reports" flush right={<div className="row"><Link className="btn sm" to="/requests">Requests</Link><Link className="btn sm" to="/damage">Damaged / lost</Link></div>}>
          {!d.work.requests.length && !d.work.damages.length ? <Empty>None yet.</Empty> : <div className="list">
            {d.work.requests.map((r) => <div key={`r${r.id}`} className="li"><div className="grow"><b><span className="mono">{r.number}</span> · stock request</b><span>{fmtWhen(r.at)}{r.note ? ` · ${r.note}` : ''}</span></div><Pill s={r.status} /></div>)}
            {d.work.damages.map((x) => <div key={`d${x.id}`} className="li"><div className="grow"><b><span className="mono">{x.number}</span> · {x.qty} × {x.item} {x.kind}</b><span>{fmtWhen(x.at)}{x.note ? ` · ${x.note}` : ''}</span></div><Pill s={x.status} /></div>)}
          </div>}
        </Panel>
      </div>
    </>
  );
}

const PSTATUS = { pending: ['warn', 'To count'], checked: ['info', 'With the accountant'], confirmed: ['ok', 'Confirmed'], rejected: ['bad', 'Rejected'] };
export function StoreHome({ d }) {
  const s = d.store;
  return (
    <>
      <div className="filters">
        <Link className="btn p" to="/orders"><Icon name="inbox" /> Order Book</Link>
        <Link className="btn" to="/requisitions/new"><Icon name="file" /> New requisition</Link>
        <Link className="btn" to="/purchases"><Icon name="cart" /> Buy or order</Link>
        <Link className="btn" to="/labels"><Icon name="tag" /> QR labels</Link>
        <Link className="btn" to="/store"><Icon name="box" /> Items to issue</Link>
      </div>
      <div className="kpis">
        <Kpi tone={s.orders ? 'warn' : 'ok'} label="Orders from the schools to buy for" value={s.orders} sub="write the requisition" />
        <Kpi tone={s.toApprove ? 'info' : 'ok'} label="My requisitions with the Manager / FM" value={s.toApprove} />
        <Kpi tone={s.toBuy ? 'warn' : 'ok'} label="Approved: to buy" value={s.toBuy} sub="after the Cashier gives the money" />
        <Kpi tone={s.ordered ? 'info' : 'ok'} label="Orders: goods not here yet" value={s.ordered} />
        <Kpi tone={s.toCount ? 'warn' : 'ok'} label="Waiting for Mapokezi to check" value={s.toCount} />
        <Kpi tone={s.checked ? 'warn' : 'ok'} label="Checked by Mapokezi: with the accountant" value={s.checked} />
        <Kpi tone={s.onTheWay ? 'info' : 'ok'} label="On the way to libraries" value={s.onTheWay} sub="the librarian signs on arrival" />
        <Kpi label="Bought this month" value={`TSh ${tsh(s.boughtThisMonth)}`} sub="confirmed" />
      </div>
      <Panel title="Last purchases and orders" flush right={<Link className="btn sm" to="/purchases">All</Link>}>
        {!s.recent.length ? <Empty>Nothing yet. Buy or order for a school; Mapokezi checks it against the receipts.</Empty> : <div className="list">{s.recent.map((p) => {
          const [tone, label] = p.ordered && p.status === 'pending' ? ['info', 'Ordered'] : PSTATUS[p.status] || ['', p.status];
          return (<Link key={p.id} to="/purchases" className="li libtn"><div className="grow"><b><span className="mono">{p.number}</span> · {p.supplier}</b>
            <span>{p.school || 'old main store'} · TSh {tsh(p.total)} · {fmtWhen(p.at)}</span></div><span className={`pill ${tone}`}>{label}</span></Link>);
        })}</div>}
      </Panel>
    </>
  );
}

// Mapokezi: checks goods against the receipts before the store-keeper sends them on.
export function MapokeziHome({ d }) {
  const m = d.mapokezi;
  return (
    <>
      <div className="filters"><Link className="btn p" to="/purchases"><Icon name="cart" /> Purchases to check</Link><Link className="btn" to="/requisitions">Requisitions</Link></div>
      <div className="kpis">
        <Kpi tone={m.moneyGiven.length ? 'info' : 'ok'} label="Money given: goods coming" value={m.moneyGiven.length} />
        <Kpi tone={m.toCheck ? 'warn' : 'ok'} label="Waiting for you to check" value={m.toCheck} />
        <Kpi tone={m.checked ? 'info' : 'ok'} label="Checked, with the accountant" value={m.checked} />
      </div>
      <Panel title="Money given: goods will come to check" sub="Open the requisition to see what was approved." flush right={<Link className="btn sm" to="/requisitions">All</Link>}>
        {!m.moneyGiven.length ? <Empty>Nothing yet. When the Cashier gives money to buy for a requisition, it shows here at once.</Empty> : <div className="list">{m.moneyGiven.map((g) => (
          <Link key={g.id} to="/requisitions" className="li libtn"><div className="grow"><b><span className="mono">{g.number}</span> · {g.school}</b>
            <span>{g.purpose} · TSh {tsh(g.amount)} given {fmtWhen(g.at)}</span></div><span className="pill info">{g.status === 'approved' ? 'Not bought yet' : 'Being bought'}</span></Link>
        ))}</div>}
      </Panel>
      <Panel title="Waiting for you" flush right={<Link className="btn sm" to="/purchases">All</Link>}>
        {!m.recent.length ? <Empty>Nothing waiting. New purchases show here as soon as the store-keeper buys or orders.</Empty> : <div className="list">{m.recent.map((p) => (
          <Link key={p.id} to="/purchases" className="li libtn"><div className="grow"><b><span className="mono">{p.number}</span> · {p.supplier}</b>
            <span>{p.school || 'old main store'} · TSh {tsh(p.total)} · {fmtWhen(p.at)}</span></div><span className="pill warn">Check against receipts</span></Link>
        ))}</div>}
      </Panel>
    </>
  );
}

// Cashier: money to give out (payment requests, and money to buy for approved requisitions).
export function CashierHome({ d }) {
  const c = d.cashier;
  return (
    <>
      <div className="filters"><Link className="btn p" to="/payments"><Icon name="check" /> Payments to give out</Link></div>
      <div className="kpis">
        <Kpi tone={c.pending ? 'warn' : 'ok'} label="Waiting for you" value={c.pending} />
        <Kpi label="Given out today" value={`TSh ${tsh(c.paidToday)}`} sub={`${c.paidTodayN} payment${c.paidTodayN === 1 ? '' : 's'}`} />
      </div>
      <Panel title="Waiting for you" flush right={<Link className="btn sm" to="/payments">All</Link>}>
        {!c.waiting.length ? <Empty>Nothing waiting. A new request or an approved requisition shows here at once.</Empty> : <div className="list">{c.waiting.map((p) => (
          <Link key={p.id} to="/payments" className="li libtn"><div className="grow"><b><span className="mono">{p.number}</span> · {p.kind === 'float' ? `Money to buy for ${p.requisition}${p.school ? ` (${p.school})` : ''}` : p.purpose}</b>
            <span>{p.amount ? `TSh ${tsh(p.amount)}` : 'Amount to write'} · approved by {p.approvedBy} · {fmtWhen(p.at)}</span></div><span className="pill warn">Give out</span></Link>
        ))}</div>}
      </Panel>
    </>
  );
}

export function AcademicHome({ d }) {
  return (
    <>
      <div className="kpis"><Kpi tone="hi" label="Students" value={d.students.total} sub={`${d.students.boys} boys · ${d.students.girls} girls`} /><Kpi label="Classes" value={d.students.classes.length} /></div>
      <StudentsByClass st={d.students} />
      <Panel><p className="small muted" style={{ margin: 0 }}>Exam sets, marks and students to watch will show here in Step 3 (Academic).</p></Panel>
    </>
  );
}
