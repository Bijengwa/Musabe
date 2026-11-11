import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { useSchools, useScope } from '../layout/scope';
import { Empty, ErrorNote, ExcelButton, Icon, Modal, PageHead, Panel, SchoolPill, fmtWhen, tsh, useToast } from '../components/ui';

const digits = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 8);

// Items & prices. Finance Manager adds and changes them; others look.
export default function Items() {
  const { user, can } = useAuth();
  const allSchools = useSchools();
  const [scope] = useScope();
  const toast = useToast();
  const canEdit = can('items', 'f');
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
        {canEdit && <button className="btn" onClick={() => setModal({ kind: 'upload' })}><Icon name="upload" /> Upload Excel</button>}
        {canEdit ? <button className="btn p" onClick={() => setModal({ kind: 'edit' })}><Icon name="plus" /> New item</button>
          : <span className="pill"><Icon name="eye" /> View only</span>}
      </PageHead>

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
              <th>Item</th><th>Category</th>
              {schools.map((s) => <th key={s.id} className="n"><SchoolPill code={s.code} name={s.shortName} /></th>)}
              <th />
            </tr></thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} className={i.active ? '' : 'off'}>
                  <td><b>{i.name}</b>{i.genderPriced && <div className="small muted">Price by gender</div>}</td>
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
      {modal?.kind === 'upload' && <Upload onClose={() => setModal(null)} onSaved={(n) => { setModal(null); toast(`Saved ${n} change${n === 1 ? '' : 's'} from Excel`); load(); }} />}
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

// Upload items and prices from Excel: choose file -> see what will change (mistakes in red) -> save.
function Upload({ onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [all, setAll] = useState(false);

  const send = async (check, f = file) => {
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/items/import${check ? '?check=1' : ''}`, { method: 'POST', credentials: 'include', body: f });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Upload failed.');
      if (d.saved) return onSaved(d.changes);
      setRes(d);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const pick = (f) => { if (!f) return; setFile(f); setRes(null); send(true, f); };

  const rows = res ? res.rows.filter((r) => all || r.error || r.change !== 'No change') : [];
  return (
    <Modal wide title="Upload items and prices from Excel" onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn p" disabled={!res || res.errors > 0 || !res.changes || busy} onClick={() => send(false)}>
          {busy ? 'Working…' : res?.changes ? `Save ${res.changes} change${res.changes === 1 ? '' : 's'}` : 'Save'}
        </button>
      </>}>
      <ol className="steps">
        <li>Download the template. It already has today's items and prices. <a className="linkbtn" href="/api/items/template.xlsx" download>Download template</a></li>
        <li>Change prices or add rows in Excel. Leave a price empty if the school does not sell the item.</li>
        <li>Choose the file. Nothing is saved until you press Save.</li>
      </ol>
      <label className="filepick">
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => pick(e.target.files[0])} />
        <Icon name="excel" /> {file ? file.name : 'Choose Excel file (.xlsx)'}
      </label>
      <ErrorNote error={error} />
      {busy && !res && <Empty>Checking the file…</Empty>}
      {res && (
        <>
          <div className="row">
            {res.errors > 0 ? <span className="pill bad">{res.errors} mistake{res.errors === 1 ? '' : 's'} to fix in Excel</span> : <span className="pill ok">No mistakes</span>}
            <span className="pill info">{res.changes} change{res.changes === 1 ? '' : 's'}</span>
            <label className="chk" style={{ marginLeft: 'auto' }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show unchanged rows too</label>
          </div>
          <div className="tw upl"><table>
            <thead><tr><th>Row</th><th>Item</th><th>School</th><th>Change</th><th>Price</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.row} className={r.error ? 'bad' : ''}>
                <td className="n">{r.row}</td><td><b>{r.item || '—'}</b></td><td>{r.school}</td>
                <td>{r.error ? <span className="pill bad">Mistake</span> : <span className={`pill ${r.change === 'No change' ? '' : 'info'}`}>{r.change}</span>}</td>
                <td>{r.error ? <span className="err-t">{r.error}</span> : r.change === 'No change' ? r.to : <>{r.from} → <b>{r.to}</b></>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          {res.errors > 0 && <p className="small muted" style={{ margin: 0 }}>Fix the rows in red in Excel, save the file, and choose it again.</p>}
        </>
      )}
    </Modal>
  );
}
