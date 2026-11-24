// Weekly check: every week the keeper counts what is really in the store (also things that stay for months,
// like rice). The accountant office confirms; differences correct the stock. The ledger shows any week.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { Empty, ErrorNote, ExcelButton, Icon, Modal, PageHead, Panel, SchoolPill, fmtWhen, tsh, useToast, Loading } from '../components/ui';
import { todayStr } from '../components/common';

const TONE = { pending: 'warn', confirmed: 'ok', rejected: 'bad' };

export default function Counts() {
  const [tab, setTab] = useState('checks');
  return (
    <>
      <PageHead title="Weekly check" sub="Count the library every week. The accountant office confirms the count, and the ledger is ready for any week." />
      <div className="filters"><div className="seg">{[['checks', 'Checks'], ['ledger', 'Weekly ledger']].map(([k, t]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>)}</div></div>
      {tab === 'checks' ? <Checks /> : <Ledger />}
    </>
  );
}

function Checks() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [counting, setCounting] = useState(false);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api.get('/counts').then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useLive(['count'], load);
  return (
    <>
      {data?.canCount && (
        <div className={`callout ${data.doneThisWeek ? 'ok' : 'warn'}`}>
          <Icon name={data.doneThisWeek ? 'check' : 'alert'} />
          <span>{data.doneThisWeek ? 'This week\'s check is done.' : `This week (from Monday ${data.week}) is not checked yet.`}</span>
          <button className="btn p" onClick={() => setCounting(true)}><Icon name="pen" /> Count now</button>
        </div>
      )}
      <ErrorNote error={error} />
      <Panel flush>
        {!data ? <Loading /> : !data.counts.length ? <Empty>No checks yet.</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th>No.</th><th>Week of</th><th className="stick">Store</th><th>What</th><th className="n">Items</th><th className="n">Different</th><th>Counted by</th><th>Status</th><th /></tr></thead>
            <tbody>{data.counts.map((c) => (
              <tr key={c.id}>
                <td className="mono small">{c.number}</td><td className="small">{c.week}</td>
                <td className="stick">{c.code ? <SchoolPill code={c.code} name={c.store} /> : <b>Old main store</b>}</td><td>{c.categoryLabel}</td><td className="n">{c.items}</td>
                <td className="n">{c.differences == null ? <span className="muted">—</span> : c.differences ? <span className="pill bad">{c.differences}</span> : <span className="pill ok">0</span>}</td>
                <td className="small">{c.by}<div className="muted">{fmtWhen(c.countedAt)}</div></td>
                <td><span className={`pill ${TONE[c.status]}`}>{c.statusLabel}</span>{c.decidedBy && <div className="small muted">{c.decidedBy}</div>}</td>
                <td><button className={`btn sm${c.canDecide ? ' p' : ''}`} onClick={() => setOpen(c)}>{c.canDecide ? 'Check' : 'Open'}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {counting && <Count categories={data.categories} onClose={() => setCounting(false)} />}
      {open && <Decide c={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Count({ categories, onClose }) {
  const toast = useToast();
  const [category, setCategory] = useState('food');
  const [sheet, setSheet] = useState(null);
  const [v, setV] = useState({});
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api.get(`/counts/sheet${category ? `?category=${category}` : ''}`).then((d) => { if (live) { setSheet({ category, ...d }); setV({}); setError(''); } }).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [category]);
  const items = sheet?.category === category ? sheet.items : null;
  const missing = (items || []).filter((i) => v[i.id] === undefined || v[i.id] === '').length;
  const save = async () => {
    setBusy(true); setError('');
    try {
      const d = await api.post('/counts', { category: category || null, note, lines: items.map((i) => ({ itemId: i.id, counted: Number(v[i.id]) })) });
      toast(`${d.count.number} sent to the accountant office`); onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal wide title={`Count ${sheet?.store || 'the store'}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" disabled={busy || !items?.length || missing > 0} onClick={save}>{busy ? 'Sending…' : missing ? `${missing} still to count` : 'Send the count'}</button></>}>
      <div className="stack">
        <div className="fg"><label>What do you count?<select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Everything in the store</option>{categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label></div>
        <p className="small muted" style={{ margin: 0 }}>Go to the shelf and count. Type what is really there (0 if there is none). The system number is not shown, so the count is honest.</p>
        {!items ? <Loading /> : !items.length ? <Empty>This store holds nothing of this kind.</Empty> : (
          <div className="tw"><table className="lines">
            <thead><tr><th>Item</th><th>Category</th><th className="n">Counted</th></tr></thead>
            <tbody>{items.map((i) => (
              <tr key={i.id}><td><b>{i.name}</b></td><td className="small">{i.categoryLabel}</td>
                <td className="n"><input className="qtyin" inputMode="numeric" value={v[i.id] ?? ''} onChange={(e) => setV((x) => ({ ...x, [i.id]: e.target.value.replace(/\D/g, '') }))} aria-label={`${i.name} counted`} /> <span className="small muted">{i.unit}</span></td></tr>
            ))}</tbody>
          </table></div>
        )}
        <label>Note (not required)<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. one bag of rice torn" /></label>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

function Decide({ c, onClose }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (approve) => {
    setBusy(true); setError('');
    try { await api.post(`/counts/${c.id}/decide`, { approve, note }); toast(`${c.number} ${approve ? 'confirmed' : 'rejected: to be counted again'}`); onClose(); } catch (e) { setError(e.message); setBusy(false); }
  };
  const diff = c.differences > 0;
  return (
    <Modal wide title={`${c.number} · ${c.store} · week of ${c.week}`} onClose={onClose}
      footer={c.canDecide ? <><button className="btn danger" disabled={busy || !note.trim()} onClick={() => go(false)}>Reject: count again</button>
        <button className="btn p" disabled={busy || (diff && !note.trim())} onClick={() => go(true)}>{diff ? 'Confirm and correct the stock' : 'Confirm'}</button></> : <button className="btn" onClick={onClose}>Close</button>}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>Counted by {c.by}, {fmtWhen(c.countedAt)}{c.note ? ` · ${c.note}` : ''}</p>
        <div className="tw"><table className="lines">
          <thead><tr><th>Item</th><th className="n">System</th><th className="n">Counted</th><th className="n">Difference</th><th>Note</th></tr></thead>
          <tbody>{c.lines.map((l) => (
            <tr key={l.id} className={l.diff ? 'lateRow' : ''}><td><b>{l.item}</b></td><td className="n">{l.system ?? <span className="muted">hidden</span>}</td><td className="n">{tsh(l.counted)} <span className="small muted">{l.unit}</span></td>
              <td className="n">{l.diff == null ? '' : l.diff === 0 ? <span className="pill ok">agrees</span> : <b className="err-t">{l.diff > 0 ? '+' : ''}{l.diff}</b>}</td><td className="small">{l.note}</td></tr>
          ))}</tbody>
        </table></div>
        {c.canDecide ? <label>{diff ? 'Why is it different? (needed)' : 'Note (needed to reject)'}<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
          : c.decidedBy && <p style={{ margin: 0 }}>{c.statusLabel} by <b>{c.decidedBy}</b> · {fmtWhen(c.decidedAt)}{c.decisionNote ? ` · ${c.decisionNote}` : ''}</p>}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

function Ledger() {
  const { user } = useAuth();
  const all = user.scope === 'all' && user.role !== 'storekeeper';
  const [week, setWeek] = useState(todayStr());
  const [store, setStore] = useState('');
  const [category, setCategory] = useState('');
  const [schools, setSchools] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { if (all) api.get('/schools').then((d) => { const list = d.schools.filter((s) => s.active); setSchools(list); setStore((x) => x || String(list[0]?.id || '')); }).catch(() => {}); }, [all]);
  const p = new URLSearchParams({ week });
  if (all) p.set('school', store);
  if (category) p.set('category', category);
  const qs = p.toString();
  const ready = !all || !!store;
  const load = useCallback(() => (ready ? api.get(`/counts/ledger?${qs}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)) : Promise.resolve()), [qs, ready]);
  useEffect(() => { load(); }, [load]);
  useLive(['count', 'stock', 'issue', 'purchase', 'delivery', 'give'], load);
  return (
    <>
      <div className="filters">
        <label className="datein">Any day of the week<input type="date" value={week} max={todayStr()} onChange={(e) => e.target.value && setWeek(e.target.value)} /></label>
        {all && <select value={store} onChange={(e) => setStore(e.target.value)} aria-label="Store">{schools.map((s) => <option key={s.id} value={s.id}>{s.shortName} library</option>)}</select>}
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category"><option value="">All categories</option>
          {['food', 'laboratory', 'book', 'exercise_book', 'stationery', 'uniform', 'cleaning', 'equipment', 'other'].map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</select>
        <ExcelButton href={`/api/counts/ledger.xlsx?${qs}`} label="Ledger in Excel" />
      </div>
      <ErrorNote error={error} />
      <Panel title={data ? `${data.store}: ${data.week} to ${data.to}` : 'Ledger'} sub={data?.notCounted ? `${data.notCounted} item${data.notCounted === 1 ? '' : 's'} not counted this week` : ''} flush>
        {!data ? <Loading /> : !data.rows.length ? <Empty>This store held nothing in that week.</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th className="stick">Item</th><th className="n">Opening</th><th className="n">Received</th><th className="n">Given out</th><th className="n">Corrections</th><th className="n">Closing</th><th className="n">Counted</th><th className="n">Difference</th><th>Check</th></tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={r.itemId}>
                <td className="stick"><b>{r.item}</b><div className="small muted">{r.categoryLabel} · {r.unit}</div></td>
                <td className="n">{tsh(r.opening)}</td><td className="n">{r.received ? tsh(r.received) : <span className="muted">0</span>}</td><td className="n">{r.issued ? tsh(r.issued) : <span className="muted">0</span>}</td>
                <td className="n">{r.corrected ? <b className="err-t">{r.corrected > 0 ? '+' : ''}{r.corrected}</b> : <span className="muted">0</span>}</td><td className="n"><b>{tsh(r.closing)}</b></td>
                <td className="n">{r.counted == null ? <span className="muted">—</span> : tsh(r.counted)}</td>
                <td className="n">{r.difference == null ? '' : r.difference === 0 ? <span className="pill ok">agrees</span> : <b className="err-t">{r.difference > 0 ? '+' : ''}{r.difference}</b>}</td>
                <td className="small">{r.check ? <><span className="mono">{r.check}</span> · {r.checkStatus}</> : <span className="pill warn">Not counted</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
