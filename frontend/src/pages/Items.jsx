import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import ItemReview from './ItemReview';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { useSchools, useScope } from '../layout/scope';
import { Empty, ErrorNote, ExcelButton, Icon, Modal, PageHead, Panel, SchoolPill, fmtWhen, tsh, useToast } from '../components/ui';

const digits = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 8);

// /items = the list, /items/review/:id = check an Excel upload before it is saved.
export default function Items() {
  return (
    <Routes>
      <Route index element={<ItemList />} />
      <Route path="review/:id" element={<ItemReview />} />
      <Route path="*" element={<ItemList />} />
    </Routes>
  );
}

// Items & prices. Finance Manager adds and changes them; others look.
function ItemList() {
  const { user, can } = useAuth();
  const allSchools = useSchools();
  const [scope] = useScope();
  const toast = useToast();
  const canEdit = can('items', 'f');
  const canUpload = can('itemsupload', 'f');
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [cats, setCats] = useState([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('active');
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null); // { kind: 'edit' | 'history', item? }

  // Which school columns to show: own school for school staff; the chosen school or all for administration.
  const schools = useMemo(() => {
    if (user.scope !== 'all') return allSchools.filter((s) => s.id === user.school?.id);
    return scope ? allSchools.filter((s) => String(s.id) === scope) : allSchools;
  }, [allSchools, scope, user]);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ status });
    if (cat) p.set('category', cat);
    if (q.trim()) p.set('q', q.trim());
    try { const d = await api.get(`/items?${p}`); setRows(d.items); setCats(d.categories); setError(''); } catch (e) { setError(e.message); }
  }, [status, cat, q]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useLive(['item'], load);

  // With one school chosen, list only what that school sells (Finance Manager still sees everything, to add prices).
  const shown = rows && (schools.length === 1 && !canEdit ? rows.filter((i) => i.prices[schools[0].id]) : rows);

  const setActive = async (item, active) => {
    try { await api.post(`/items/${item.id}/active`, { active }); toast(active ? `${item.name} is on sale again` : `${item.name} is no longer sold`); load(); }
    catch (e) { toast(e.message); }
  };

  return (
    <>
      <PageHead title="Items & prices" sub={canEdit
        ? 'Everything the libraries sell. Each school has its own price, or does not sell the item.'
        : 'What the library sells and the price for each school.'}>
        <ExcelButton href="/api/items/export.xlsx" />
        {canUpload && <button className="btn" onClick={() => setModal({ kind: 'upload' })}><Icon name="upload" /> Upload Excel</button>}
        {canEdit ? <button className="btn p" onClick={() => setModal({ kind: 'edit' })}><Icon name="plus" /> New item</button>
          : <span className="pill"><Icon name="eye" /> View only</span>}
      </PageHead>

      {canUpload && <Waiting />}

      <div className="filters">
        <div className="seg">
          {[['active', 'On sale'], ['archived', 'Stopped']].map(([k, t]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t}</button>)}
        </div>
        <select aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <div className="searchbox"><Icon name="search" /><input placeholder="Search item" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {shown && <span className="muted small">{shown.length} items</span>}
      </div>

      <ErrorNote error={error} />
      <Panel flush>
        {!shown ? <Empty>Loading…</Empty> : !shown.length ? <Empty>{status === 'archived' ? 'No stopped items.' : 'No items match.'}</Empty> : (
          <div className="tw"><table className="itemtable">
            <thead><tr>
              <th className="sn">S/N</th><th>Item</th><th>Category</th>
              {schools.map((s) => <th key={s.id} className="n"><SchoolPill code={s.code} name={s.shortName} /></th>)}
              <th />
            </tr></thead>
            <tbody>
              {shown.map((i, n) => (
                <tr key={i.id} className={i.active ? '' : 'off'}>
                  <td className="sn" data-l="S/N">{n + 1}</td>
                  <td className="nm"><b>{i.name}</b>{i.genderPriced && <div className="small muted">Price by gender</div>}</td>
                  <td data-l="Category">{i.categoryLabel}</td>
                  {schools.map((s) => <td key={s.id} className="n" data-l={s.shortName}><Price p={i.prices[s.id]} /></td>)}
                  <td className="acts-cell"><div className="row nowrap">
                    <button className="btn sm" onClick={() => setModal({ kind: 'history', item: i })} title="Price history"><Icon name="clock" /></button>
                    {canEdit && <button className="btn sm" onClick={() => setModal({ kind: 'edit', item: i })}><Icon name="edit" /> Edit</button>}
                    {canEdit && (i.active
                      ? <button className="btn sm danger" onClick={() => setActive(i, false)}>Stop selling</button>
                      : <button className="btn sm" onClick={() => setActive(i, true)}>Sell again</button>)}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Panel>
      <p className="small muted" style={{ margin: 0 }}>Prices are in Tanzanian shillings (TSh). A changed price is used for new receipts only; old receipts keep the price they were paid at.</p>

      {modal?.kind === 'edit' && <ItemForm item={modal.item} cats={cats} onClose={() => setModal(null)} onSaved={(name) => { setModal(null); toast(`${name} saved`); load(); }} />}
      {modal?.kind === 'history' && <History item={modal.item} onClose={() => setModal(null)} />}
      {modal?.kind === 'upload' && <Upload onClose={() => setModal(null)} onUploaded={(id) => navigate(`/items/review/${id}`)} />}
    </>
  );
}

function Price({ p }) {
  if (!p) return <span className="muted small">Not sold</span>;
  if (p.price != null) return <b className="money">{tsh(p.price)}</b>;
  return (
    <div className="gp">
      {p.boys != null && <span><i className="gb">Boys</i> <b className="money">{tsh(p.boys)}</b></span>}
      {p.girls != null && <span><i className="gg">Girls</i> <b className="money">{tsh(p.girls)}</b></span>}
    </div>
  );
}

function MoneyInput({ value, onChange, label, id }) {
  return (
    <label className="money-in">{label}
      <span><input id={id} inputMode="numeric" value={value ? tsh(value) : ''} placeholder="0" onChange={(e) => onChange(digits(e.target.value))} /><em>TSh</em></span>
    </label>
  );
}

function ItemForm({ item, cats, onClose, onSaved }) {
  const schools = useSchools().filter((s) => s.active);
  const [name, setName] = useState(item?.name || '');
  const [category, setCategory] = useState(item?.category || 'uniform');
  const [gp, setGp] = useState(!!item?.genderPriced);
  // per school: { sold, price, boys, girls } as digit strings
  const [pr, setPr] = useState(() => Object.fromEntries(schools.map((s) => {
    const p = item?.prices[s.id];
    return [s.id, { sold: !!p || !item, price: p?.price ?? '', boys: p?.boys ?? '', girls: p?.girls ?? '' }];
  })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (id, k, v) => setPr((x) => ({ ...x, [id]: { ...x[id], [k]: v } }));

  const submit = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    const prices = Object.fromEntries(schools.map((s) => {
      const p = pr[s.id];
      return [s.id, p.sold ? (gp ? { boys: p.boys, girls: p.girls } : { price: p.price }) : null];
    }));
    try {
      const body = { name, category, genderPriced: gp, prices };
      const r = item ? await api.patch(`/items/${item.id}`, body) : await api.post('/items', body);
      onSaved(r.item.name);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal wide title={item ? `Edit ${item.name}` : 'New item'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" form="itemform" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="itemform" className="stack" onSubmit={submit}>
        <div className="fg">
          <label>Item name<input id="i-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SCHOOL UNIFORM" required autoFocus /></label>
          <label>Category<select id="i-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select></label>
        </div>
        <label className="chk"><input type="checkbox" checked={gp} onChange={(e) => setGp(e.target.checked)} /> The price is different for boys and girls (e.g. Special Uniform)</label>

        <div className="pricegrid">
          {schools.map((s) => {
            const p = pr[s.id];
            return (
              <div key={s.id} className={`pricerow${p.sold ? '' : ' off'}`}>
                <div className="pr-head">
                  <SchoolPill code={s.code} name={s.shortName} />
                  <label className="chk"><input type="checkbox" checked={p.sold} onChange={(e) => set(s.id, 'sold', e.target.checked)} /> Sold here</label>
                </div>
                {p.sold && (gp ? (
                  <div className="pr-in">
                    {s.students !== 'girls' && <MoneyInput id={`p-${s.id}-b`} label="Boys price" value={p.boys} onChange={(v) => set(s.id, 'boys', v)} />}
                    {s.students !== 'boys' && <MoneyInput id={`p-${s.id}-g`} label="Girls price" value={p.girls} onChange={(v) => set(s.id, 'girls', v)} />}
                  </div>
                ) : (
                  <div className="pr-in"><MoneyInput id={`p-${s.id}`} label="Price" value={p.price} onChange={(v) => set(s.id, 'price', v)} /></div>
                ))}
                {!p.sold && <p className="small muted" style={{ margin: 0 }}>Not sold in this school.</p>}
              </div>
            );
          })}
        </div>
        {item && <p className="small muted" style={{ margin: 0 }}>A new price is used for new receipts only. Every change is recorded in the price history.</p>}
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function History({ item, onClose }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get(`/items/${item.id}/history`).then((d) => setRows(d.changes)).catch((e) => setError(e.message)); }, [item.id]);
  return (
    <Modal title={`Price history: ${item.name}`} onClose={onClose}>
      <ErrorNote error={error} />
      {!rows ? <Empty>Loading…</Empty> : !rows.length ? <Empty>No price changes yet. These prices came from the sales book.</Empty> : (
        <div className="list hist">
          {rows.map((r) => (
            <div className="li" key={r.id}>
              <SchoolPill code={r.schoolCode} name={r.school} />
              <div className="grow"><b className="fw5">{r.from} → {r.to}</b><span>{r.by} · {fmtWhen(r.at)}</span></div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// Uploads waiting for approval: shown above the list so they are not forgotten.
function Waiting() {
  const [rows, setRows] = useState([]);
  const load = useCallback(() => api.get('/items/imports').then((d) => setRows(d.pending)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  useLive(['itemimport', 'item'], load);
  if (!rows.length) return null;
  return (
    <div className="waitbox">
      <b><Icon name="clock" /> {rows.length} Excel upload{rows.length === 1 ? '' : 's'} waiting for approval</b>
      <span className="small muted">Items and prices in an upload are not in the list until it is approved.</span>
      {rows.map((u) => (
        <div key={u.id} className="row waitrow">
          <span><b>{u.fileName}</b> <span className="small muted">by {u.mine ? 'you' : u.uploadedBy}, {fmtWhen(u.createdAt)} · {u.summary?.changes ?? 0} change{u.summary?.changes === 1 ? '' : 's'}{u.summary?.errors ? ` · ${u.summary.errors} mistake${u.summary.errors === 1 ? '' : 's'}` : ''}</span></span>
          <Link className="btn sm p" to={`/items/review/${u.id}`}>Review</Link>
        </div>
      ))}
    </div>
  );
}

// Upload items and prices from Excel. The file is kept as "waiting" and opens on the review page; nothing is saved yet.
function Upload({ onClose, onUploaded }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async (f) => {
    if (!f) return;
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/items/imports', { method: 'POST', credentials: 'include', headers: { 'X-File-Name': encodeURIComponent(f.name).slice(0, 200) }, body: f });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Upload failed.');
      onUploaded(d.id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Upload items and prices from Excel" onClose={onClose} footer={<button className="btn" onClick={onClose}>Cancel</button>}>
      <ol className="steps">
        <li>Download the template. It already has today's items and prices. <a className="linkbtn" href="/api/items/template.xlsx" download>Download template</a></li>
        <li>Change prices or add rows in Excel. Not sure how? <a className="linkbtn" href="/api/items/sample.xlsx" download>See a sample</a> — it shows each kind of row and explains it.</li>
        <li>One school or all three: put only the rows you want to change. Rows not in the file are not changed.</li>
        <li>Choose the file. A review page opens. Nothing is saved until you check it and press <b>Approve</b>.</li>
      </ol>
      <label className="filepick">
        <input type="file" disabled={busy} accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => send(e.target.files[0])} />
        <Icon name="excel" /> {busy ? 'Checking the file…' : 'Choose Excel file (.xlsx)'}
      </label>
      <ErrorNote error={error} />
    </Modal>
  );
}
