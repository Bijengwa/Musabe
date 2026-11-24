// Stock levels: what each library holds now. Only the finance office, the accountant office and the top leaders.
// "Paid, not given" = parents have paid, the items are still on the shelf for them. "Free" = what is left after that.
// Finance Manager and Accountant set the reorder level (at or below it the item shows "Low" and finance is told).
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, Modal, PageHead, Panel, SchoolPill, SkeletonTable, fmtWhen, tsh, useToast, Loading } from '../components/ui';
import { useSchoolQs } from '../components/common';

const TABS = [['', 'All'], ['low', 'Low or out'], ['out', 'Out of stock'], ['short', 'Owed more than in stock']];
const TONE = { ok: 'ok', low: 'warn', out: 'bad' };
const LABEL = { ok: 'OK', low: 'Low', out: 'Out' };

export default function Stock() {
  const { user } = useAuth();
  const school = useSchoolQs();
  const [params] = useSearchParams();
  const [status, setStatus] = useState(() => params.get('status') || '');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [card, setCard] = useState(null);
  const all = user.scope === 'all' && !school;

  const p = new URLSearchParams();
  if (school) p.set('school', school);
  if (status) p.set('status', status);
  if (q.trim()) p.set('q', q.trim());
  const qs = p.toString();
  const load = useCallback(() => api.get(`/stock?${qs}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [qs]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useLive(['stock', 'delivery', 'damage', 'give', 'receipt', 'item'], load);

  const t = data?.totals;
  return (
    <>
      <PageHead title="Stock levels" sub="What each library holds now. Stock goes up when the librarian confirms a delivery, and down when items are given or a damage is approved.">
        <ExcelButton href={`/api/stock/export.xlsx?${qs}`} />
      </PageHead>
      {t && (
        <div className="kpis">
          <Kpi tone="hi" label="Items in stock" value={tsh(t.units)} sub={`${t.items} item lines`} />
          <Kpi tone={t.out ? 'bad' : 'ok'} label="Out of stock" value={t.out} />
          <Kpi tone={t.low ? 'warn' : 'ok'} label="Low" value={t.low} sub="at or below the reorder level" />
          <Kpi tone={t.short ? 'bad' : 'ok'} label="Owed more than in stock" value={t.short} sub="paid by parents but not enough on the shelf" />
          <Kpi label="On the way" value={tsh(t.onTheWay)} sub="sent, not yet confirmed" />
        </div>
      )}
      <div className="filters">
        <div className="seg">{TABS.map(([k, l]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>)}</div>
        <div className="searchbox"><Icon name="search" /><input placeholder="Search item" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <ErrorNote error={error} />
      <Panel flush>
        {!data ? <SkeletonTable rows={8} columns={8} /> : !data.rows.length ? <Empty>No items match.</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr>
              <th className="stick">Item</th>{all && <th>School</th>}<th className="n">In stock</th><th className="n">Paid, not given</th><th className="n">Free</th>
              <th className="n">On the way</th><th className="n">Damage waiting</th><th className="n">Reorder at</th><th>Status</th><th />
            </tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={`${r.schoolId}:${r.itemId}`} className={r.status === 'out' ? 'lateRow' : ''}>
                <td className="stick"><b>{r.name}</b>{!r.sold && <div className="small muted">not sold here now</div>}</td>
                {all && <td><SchoolPill code={r.code} name={r.school} /></td>}
                <td className="n"><b>{tsh(r.qty)}</b></td>
                <td className="n">{r.owed ? tsh(r.owed) : <span className="muted">0</span>}{r.short > 0 && <div className="small err-t">{r.short} short</div>}</td>
                <td className="n">{tsh(r.free)}</td>
                <td className="n">{r.onTheWay ? <span className="pill info">{r.onTheWay}</span> : <span className="muted">0</span>}</td>
                <td className="n">{r.damagePending ? <span className="pill warn">{r.damagePending}</span> : <span className="muted">0</span>}</td>
                <td className="n">{data.canSetReorder ? <Reorder key={r.reorder} r={r} /> : r.reorder || <span className="muted">—</span>}</td>
                <td><span className={`pill ${TONE[r.status]}`}>{LABEL[r.status]}</span></td>
                <td><button className="btn sm" onClick={() => setCard(r)}>History</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {card && <StockCard r={card} onClose={() => setCard(null)} />}
    </>
  );
}

function Reorder({ r }) {
  const toast = useToast();
  const [v, setV] = useState(String(r.reorder || ''));
  const save = async () => {
    const n = Number(v || 0);
    if (n === r.reorder) return;
    try { await api.patch('/stock/reorder', { schoolId: r.schoolId, itemId: r.itemId, reorderLevel: n }); toast(`${r.name}: reorder at ${n || 'no warning'}`); }
    catch (e) { toast(e.message); setV(String(r.reorder || '')); }
  };
  return <input className="qtyin" inputMode="numeric" value={v} placeholder="—" onChange={(e) => setV(e.target.value.replace(/\D/g, ''))}
    onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} aria-label={`Reorder level for ${r.name}`} />;
}

// Stock card: every movement of one item in one school.
function StockCard({ r, onClose }) {
  const [moves, setMoves] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get(`/stock/moves?school=${r.schoolId}&item=${r.itemId}`).then((d) => setMoves(d.moves)).catch((e) => setError(e.message)), [r]);
  useEffect(() => { load(); }, [load]);
  useLive(['stock', 'delivery', 'damage', 'give'], load);
  return (
    <Modal wide title={`${r.name} · ${r.school}`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <ErrorNote error={error} />
      <p className="small muted" style={{ marginTop: 0 }}>In stock now: <b>{r.qty}</b>. Every movement, newest first. Nothing here can be changed or deleted.</p>
      {!moves ? <Loading /> : !moves.length ? <Empty>No movements yet. Stock starts when the finance office sends it and the librarian confirms.</Empty> : (
        <div className="tw"><table className="lines">
          <thead><tr><th>Date</th><th>Movement</th><th>Paper</th><th className="n">In</th><th className="n">Out</th><th className="n">Balance</th><th>By</th></tr></thead>
          <tbody>{moves.map((m) => (
            <tr key={m.id}><td className="small">{fmtWhen(m.at)}</td><td>{m.kindLabel}{m.note && <div className="small muted">{m.note}</div>}</td><td className="mono small">{m.ref}</td>
              <td className="n">{m.change > 0 ? m.change : ''}</td><td className="n">{m.change < 0 ? -m.change : ''}</td><td className="n"><b>{m.balance}</b></td><td className="small">{m.by}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </Modal>
  );
}
