// Scan out / return: things that are given out and not sold.
// - Give out: scan the ID of the person (student or staff), then scan each thing. Things that do not come back
//   (reams, chalk, rice) can also go to a place such as the kitchen.
// - Return: scan the piece; it goes back on the shelf, or is marked damaged or lost.
// - Out now: who holds what.
// The librarian gives out and takes back in the school library (scan the ID, then the QR on the thing). Others only look.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, Modal, PageHead, Panel, fmtWhen, useToast } from '../components/ui';
import { useSchoolQs } from '../components/common';
import { ScanBox } from '../components/scan';

const newKey = () => `iss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export default function Issue() {
  const { can } = useAuth();
  const works = can('issue', 'f');
  const [tab, setTab] = useState(works ? 'give' : 'out');
  const tabs = works ? [['give', 'Give out'], ['return', 'Return'], ['out', 'Out now'], ['all', 'All issues']] : [['out', 'Out now'], ['all', 'All issues']];
  return (
    <>
      <PageHead title="Scan out / return" sub={works ? 'Scan the ID of the person, then scan what you give. Scan it again when it comes back.'
        : 'What the stores have given out, and who still holds things that must come back.'} />
      <div className="filters"><div className="seg">{tabs.map(([k, t]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>)}</div></div>
      {tab === 'give' && <Give />}
      {tab === 'return' && <Return />}
      {(tab === 'out' || tab === 'all') && <List open={tab === 'out'} />}
    </>
  );
}

const PersonCard = ({ p, onClear }) => (
  <div className="personcard">
    <span className={`pill ${p.type === 'student' ? 'info' : 'ok'}`}>{p.type === 'student' ? 'Student' : p.type === 'staff' ? 'Staff' : 'Place'}</span>
    <div className="grow"><b>{p.name}</b><span>{[p.detail, p.admissionNo && `Adm. ${p.admissionNo}`, p.code].filter(Boolean).join(' · ')}</span>
      {p.holding?.length > 0 && <span className="block">Still holds {p.holding.length}: {p.holding.slice(0, 4).map((h) => h.item).join(', ')}{p.holding.length > 4 ? '…' : ''}</span>}</div>
    {p.card === null && <span className="pill warn" title="The School Admin has not recorded this ID card as given">ID card not issued</span>}
    {onClear && <button className="iconbtn" onClick={onClear} aria-label="Change person"><Icon name="x" /></button>}
  </div>
);

function Give() {
  const toast = useToast();
  const [person, setPerson] = useState(null);
  const [cart, setCart] = useState([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [find, setFind] = useState(false);
  const key = useRef(newKey());

  const onScan = async (code) => {
    setError(''); setDone(null);
    try {
      const { found: f } = await api.get(`/store/scan?code=${encodeURIComponent(code)}`);
      if (f.type === 'student' || f.type === 'staff') {
        if (f.left || f.off) return setError(`${f.name} is ${f.left ? 'marked as left school' : 'switched off'}.`);
        return setPerson(f);
      }
      if (f.type === 'copy') {
        if (!f.here) return setError(`${f.code} (${f.item}) belongs to ${f.store}, not to your store.`);
        if (f.status !== 'in') return setError(f.status === 'out' ? `${f.code} (${f.item}) is still out with ${f.holder?.name || 'someone'}. Scan it on "Return" first.` : `${f.code} (${f.item}) is marked ${f.status}.`);
        return setCart((c) => (c.some((l) => l.copyId === f.id) ? c : [...c, { copyId: f.id, code: f.code, name: f.item, qty: 1 }]));
      }
      if (f.returnable) return setError(`${f.name} comes back after use. Scan the barcode on the piece itself (it starts with MC).`);
      if (f.qty < 1) return setError(`${f.name}: none in your store.`);
      setCart((c) => (c.some((l) => l.itemId === f.id) ? c.map((l) => (l.itemId === f.id ? { ...l, qty: l.qty + 1 } : l))
        : [...c, { itemId: f.id, code: f.code, name: f.name, unit: f.unit, qty: 1, max: f.qty }]));
    } catch (e) { setError(e.message); }
  };
  const setQty = (itemId, qty) => setCart((c) => c.map((l) => (l.itemId === itemId ? { ...l, qty } : l)));
  const drop = (l) => setCart((c) => c.filter((x) => x !== l));
  const needsPerson = cart.some((l) => l.copyId);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const body = { key: key.current, note, lines: cart.map((l) => (l.copyId ? { copyId: l.copyId } : { itemId: l.itemId, qty: l.qty })),
        ...(person.type === 'student' ? { toKind: 'student', studentId: person.id } : person.type === 'staff' ? { toKind: 'staff', staffId: person.id } : { toKind: 'dept', toName: person.name }) };
      const d = await api.post('/store/issues', body);
      toast(`${d.issue.number} saved`); setDone(d.issue); setPerson(null); setCart([]); setNote(''); key.current = newKey();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <>
      <Panel title="1. Scan" sub="the person's ID card, then each thing">
        <ScanBox onScan={onScan} busy={busy} />
        <div className="filters" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={() => setFind(true)}><Icon name="search" /> Find the person by name</button>
        </div>
        <ErrorNote error={error} />
        {done && <p className="okline"><Icon name="check" /> {done.number}: {done.lines.map((l) => `${l.qty} × ${l.item}`).join(', ')} given to {done.toName}.</p>}
      </Panel>
      <Panel title="2. Check and save" flush>
        {person ? <PersonCard p={person} onClear={() => setPerson(null)} /> : <Empty>Nobody yet. Scan the student or staff ID card.</Empty>}
        {cart.length > 0 && (
          <div className="tw"><table className="lines">
            <thead><tr><th>Thing</th><th>Barcode</th><th className="n">Quantity</th><th /></tr></thead>
            <tbody>{cart.map((l) => (
              <tr key={l.copyId ? `c${l.copyId}` : `i${l.itemId}`}>
                <td><b>{l.name}</b>{l.copyId && <div className="small muted">comes back</div>}</td><td className="mono small">{l.code}</td>
                <td className="n">{l.copyId ? 1 : <><input className="qtyin" inputMode="numeric" value={l.qty || ''} onChange={(e) => setQty(l.itemId, Number(e.target.value.replace(/\D/g, '')) || 0)} aria-label={`${l.name} quantity`} /> <span className="small muted">{l.unit} of {l.max}</span></>}</td>
                <td className="n"><button className="iconbtn" onClick={() => drop(l)} aria-label={`Remove ${l.name}`}><Icon name="x" /></button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {cart.length > 0 && (
          <div className="stack" style={{ padding: 16 }}>
            <label>Note (not required)<input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. for Form 2 Biology practical" /></label>
            <button className="btn p big" disabled={busy || !person || cart.some((l) => !l.qty)} onClick={save}>
              {busy ? 'Saving…' : person ? `Give ${cart.reduce((s, l) => s + l.qty, 0)} to ${person.name}` : 'Scan the person first'}</button>
          </div>
        )}
      </Panel>
      {find && <FindPerson onClose={() => setFind(false)} onPick={(p) => { setPerson(p); setFind(false); }} />}
    </>
  );
}

function FindPerson({ onClose, onPick }) {
  const [q, setQ] = useState('');
  const [people, setPeople] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) return undefined;
    const t = setTimeout(() => api.get(`/store/people?q=${encodeURIComponent(q.trim())}`).then((d) => setPeople(d.people)).catch(() => setPeople([])), 200);
    return () => clearTimeout(t);
  }, [q]);
  const shown = q.trim().length < 2 ? [] : people;
  return (
    <Modal title="Find the person" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="searchbox wide"><Icon name="search" /><input autoFocus placeholder="Name or admission number" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="list bordered" style={{ marginTop: 10 }}>
        {!shown.length ? <Empty>{q.trim().length < 2 ? 'Type at least 2 letters.' : 'Nobody found.'}</Empty> : shown.map((p) => (
          <button type="button" className="li pick" key={p.code} onClick={() => onPick(p)}>
            <span className={`pill ${p.type === 'student' ? 'info' : 'ok'}`}>{p.type === 'student' ? 'Student' : 'Staff'}</span>
            <div className="grow"><b>{p.name}</b><span>{[p.detail, p.school].filter(Boolean).join(' · ')}</span></div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function Return() {
  const toast = useToast();
  const [error, setError] = useState('');
  const [quick, setQuick] = useState(true);
  const [piece, setPiece] = useState(null);     // a scanned piece waiting for good / damaged / lost
  const [person, setPerson] = useState(null);   // a scanned ID: what they still hold
  const [log, setLog] = useState([]);

  const giveBack = async (copyId, condition = 'good', note = '') => {
    const d = await api.post('/store/returns', { copyId, condition, note });
    setLog((l) => [d.returned, ...l].slice(0, 30));
    toast(`${d.returned.code} ${condition === 'good' ? 'returned' : condition}`);
    setPiece(null);
    setPerson((p) => (p ? { ...p, holding: p.holding.filter((h) => h.copyId !== copyId) } : p));
  };
  const onScan = async (code) => {
    setError('');
    try {
      const { found: f } = await api.get(`/store/scan?code=${encodeURIComponent(code)}`);
      if (f.type === 'student' || f.type === 'staff') { setPiece(null); return setPerson(f); }
      if (f.type !== 'copy') return setError(`${f.name} does not come back, so there is nothing to return. Only pieces with their own barcode (MC…) are returned.`);
      if (f.status !== 'out') return setError(`${f.code} (${f.item}) is not out: it is ${f.status === 'in' ? 'already in the store' : f.status}.`);
      if (!f.here) return setError(`${f.code} (${f.item}) belongs to ${f.store}. It is returned there.`);
      if (quick) await giveBack(f.id); else setPiece(f);
    } catch (e) { setError(e.message); }
  };
  return (
    <>
      <Panel title="Scan what comes back" right={<label className="checkline"><input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} /> In good condition: save at once</label>}>
        <ScanBox onScan={onScan} placeholder="Scan the piece (or the person's ID to see what they hold)" />
        <ErrorNote error={error} />
        <p className="note"><Icon name="alert" /> Damaged or lost? Untick the box, scan the piece, then choose. To report a lost thing without the piece, scan the person's ID.</p>
      </Panel>
      {person && (
        <Panel title="This person holds" flush right={<button className="btn sm" onClick={() => setPerson(null)}>Close</button>}>
          <PersonCard p={{ ...person, holding: [] }} />
          {!person.holding.length ? <Empty>Nothing to return.</Empty> : (
            <div className="tw"><table className="lines"><thead><tr><th>Thing</th><th>Barcode</th><th>Since</th><th /></tr></thead>
              <tbody>{person.holding.map((h) => (
                <tr key={h.copyId}><td><b>{h.item}</b></td><td className="mono small">{h.code}</td><td className="small">{fmtWhen(h.at)} · {h.issue}</td>
                  <td className="n"><button className="btn sm" onClick={() => setPiece({ id: h.copyId, code: h.code, item: h.item, holder: { name: person.name } })}>Returned / lost…</button></td></tr>
              ))}</tbody></table></div>
          )}
        </Panel>
      )}
      <Panel title="Returned just now" flush>
        {!log.length ? <Empty>Nothing yet.</Empty> : (
          <div className="list">{log.map((r, i) => (
            <div className="li" key={`${r.code}-${i}`}><div className="grow"><b><span className="mono">{r.code}</span> · {r.item}</b><span>from {r.from}{r.detail ? ` (${r.detail})` : ''} · {r.issue}</span></div>
              <span className={`pill ${r.condition === 'good' ? 'ok' : 'bad'}`}>{r.condition === 'good' ? 'Back in the store' : r.condition === 'damaged' ? 'Damaged' : 'Lost'}</span></div>
          ))}</div>
        )}
      </Panel>
      {piece && <ReturnModal piece={piece} onClose={() => setPiece(null)} onSave={giveBack} />}
    </>
  );
}

function ReturnModal({ piece, onClose, onSave }) {
  const [condition, setCondition] = useState('good');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await onSave(piece.id, condition, note); } catch (e) { setError(e.message); setBusy(false); } };
  return (
    <Modal title={`${piece.code} · ${piece.item}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" disabled={busy || (condition !== 'good' && note.trim().length < 3)} onClick={go}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="stack">
        {piece.holder && <p style={{ margin: 0 }}>Given to <b>{piece.holder.name}</b>{piece.holder.detail ? ` (${piece.holder.detail})` : ''}{piece.holder.since ? ` · ${fmtWhen(piece.holder.since)}` : ''}</p>}
        <div className="seg">{[['good', 'Returned, good'], ['damaged', 'Returned, damaged'], ['lost', 'Lost']].map(([k, t]) => <button key={k} type="button" className={condition === k ? 'on' : ''} onClick={() => setCondition(k)}>{t}</button>)}</div>
        {condition !== 'good' && <label>What happened<textarea rows={2} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. cover torn; lost on the way home" /></label>}
        {condition !== 'good' && <p className="small muted" style={{ margin: 0 }}>It will not go back into the stock. The Head Master and the finance office are told.</p>}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

function List({ open }) {
  const school = useSchoolQs();
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const p = new URLSearchParams();
  if (school) p.set('school', school);
  if (open) p.set('open', '1');
  if (q.trim()) p.set('q', q.trim());
  const qs = p.toString();
  const load = useCallback(() => api.get(`/store/issues?${qs}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [qs]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useLive(['issue'], load);
  const rows = (data?.issues || []).flatMap((i) => i.lines.filter((l) => !open || (l.comesBack && !l.returned)).map((l) => ({ i, l })));
  return (
    <>
      {data && <div className="kpis"><Kpi tone={data.outNow ? 'warn' : 'ok'} label="Pieces out now" value={data.outNow} sub="must come back" /><Kpi label="Issues today" value={data.today} /></div>}
      <div className="filters">
        <div className="searchbox"><Icon name="search" /><input placeholder="Search name or ISS number" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <ExcelButton href={`/api/store/issues/export.xlsx?${qs}`} />
      </div>
      <ErrorNote error={error} />
      <Panel flush>
        {!data ? <Empty>Loading…</Empty> : !rows.length ? <Empty>{open ? 'Everything is back.' : 'Nothing given out yet.'}</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th>No.</th><th>Date</th><th className="stick">Given to</th><th>Thing</th><th>Barcode</th><th className="n">Qty</th><th>Store</th><th>State</th><th>By</th></tr></thead>
            <tbody>{rows.map(({ i, l }) => (
              <tr key={l.id}>
                <td className="mono small">{i.number}</td><td className="small">{fmtWhen(i.at)}</td>
                <td className="stick"><b>{i.toName}</b><div className="small muted">{i.toDetail}</div></td>
                <td>{l.item}</td><td className="mono small">{l.code || ''}</td><td className="n">{l.qty} <span className="small muted">{l.unit}</span></td><td className="small">{i.store}</td>
                <td>{!l.comesBack ? <span className="pill">Used</span> : !l.returned ? <span className="pill warn">Out</span>
                  : <span className={`pill ${l.returned === 'good' ? 'ok' : 'bad'}`} title={l.returnNote || ''}>{l.returnedLabel}</span>}</td>
                <td className="small">{i.by}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
