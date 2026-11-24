/* eslint-disable react-refresh/only-export-components */
// Small pieces shared by the stock, money and report screens.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useScope } from '../layout/scope';
import { Icon, Skeleton, tsh } from './ui';

// "?school=2" for administration when a school is chosen at the top; school staff always get their own school.
export function useSchoolQs() {
  const { user } = useAuth();
  const [scope] = useScope();
  return user.scope === 'all' && scope ? scope : '';
}

// Today in Tanzania as YYYY-MM-DD, and a few ready-made ranges.
export const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
const shift = (d, days) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10); };
export function presets() {
  const t = todayStr();
  const monthStart = `${t.slice(0, 8)}01`;
  const lastMonthEnd = shift(monthStart, -1);
  const dow = (new Date(`${t}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return [
    ['today', 'Today', t, t],
    ['week', 'This week', shift(t, -dow), t],
    ['month', 'This month', monthStart, t],
    ['lastmonth', 'Last month', `${lastMonthEnd.slice(0, 8)}01`, lastMonthEnd],
    ['year', 'This year', `${t.slice(0, 4)}-01-01`, t],
  ];
}

export function DateRange({ from, to, onChange, quick = true }) {
  const list = presets();
  const on = list.find(([, , a, b]) => a === from && b === to)?.[0];
  return (
    <>
      {quick && <div className="seg">{list.map(([k, t, a, b]) => <button key={k} type="button" className={on === k ? 'on' : ''} onClick={() => onChange(a, b)}>{t}</button>)}</div>}
      <label className="datein">From<input type="date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} /></label>
      <label className="datein">To<input type="date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} /></label>
    </>
  );
}

// Items sold in one school (for sending stock, requests, damage).
export function useSchoolItems(schoolId) {
  const [got, setGot] = useState({ schoolId: null, items: null });
  useEffect(() => {
    if (!schoolId) return undefined;
    let live = true;
    api.get('/items').then((d) => { if (live) setGot({ schoolId, items: d.items.filter((i) => i.active && i.prices[schoolId]) }); })
      .catch(() => live && setGot({ schoolId, items: [] }));
    return () => { live = false; };
  }, [schoolId]);
  if (!schoolId) return [];
  return got.schoolId === schoolId ? got.items : null;
}

// Pick items and how many: [{ itemId, name, qty }]. Used by Send stock and Stock requests.
export function LinesEditor({ items, lines, setLines, extra }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => (items || []).filter((i) => !q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase())), [items, q]);
  const add = (i) => setLines((ls) => (ls.some((l) => l.itemId === i.id) ? ls : [...ls, { itemId: i.id, name: i.name, qty: 1 }]));
  const set = (id, qty) => setLines((ls) => ls.map((l) => (l.itemId === id ? { ...l, qty: Math.max(0, Math.min(100000, qty)) } : l)));
  const drop = (id) => setLines((ls) => ls.filter((l) => l.itemId !== id));
  return (
    <div className="lineseditor">
      <div className="stack" style={{ gap: 8 }}>
        <div className="searchbox wide"><Icon name="search" /><input placeholder="Find an item" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="itemchips">
          {!items ? <><Skeleton width="46%" height={14} /><Skeleton width="62%" height={14} /><Skeleton width="38%" height={14} /></> : !shown.length ? <span className="muted small">No items.</span> : shown.map((i) => {
            const on = lines.some((l) => l.itemId === i.id);
            return <button type="button" key={i.id} className={on ? 'on' : ''} onClick={() => (on ? drop(i.id) : add(i))}>{on && <Icon name="check" />}{i.name}</button>;
          })}
        </div>
      </div>
      {lines.length > 0 && (
        <div className="tw"><table className="lines">
          <thead><tr><th>Item</th>{extra && <th className="n">{extra.header}</th>}<th className="n">Quantity</th><th /></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.itemId}>
              <td><b>{l.name}</b></td>
              {extra && <td className="n">{extra.cell(l)}</td>}
              <td className="n"><input className="qtyin" inputMode="numeric" value={l.qty || ''} onChange={(e) => set(l.itemId, Number(e.target.value.replace(/\D/g, '')) || 0)} aria-label={`${l.name} quantity`} /></td>
              <td className="n"><button type="button" className="iconbtn" onClick={() => drop(l.itemId)} aria-label={`Remove ${l.name}`}><Icon name="x" /></button></td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={extra ? 2 : 1}>{lines.length} item{lines.length === 1 ? '' : 's'}</td><td className="n">{tsh(lines.reduce((s, l) => s + (l.qty || 0), 0))}</td><td /></tr></tfoot>
        </table></div>
      )}
    </div>
  );
}

// ---------- Control number slip (for the parent) ----------
export function ControlSlip({ b }) {
  return (
    <div className="cnslip">
      <div className="cn-head">
        <img src="/musabe-logo.png" alt="" />
        <div><h2>{b.receiptTitle}</h2>{b.receiptContact.split('\n').map((l, i) => <p key={i}>{l}</p>)}</div>
      </div>
      <h3>PAYMENT CONTROL NUMBER</h3>
      <div className="cn-no">{b.controlSpaced}</div>
      <div className="cn-grid">
        <span>Student</span><b>{b.studentName} · {b.studentClass}</b>
        {b.payerName && <><span>Parent / guardian</span><b>{b.payerName}</b></>}
        <span>Amount to pay</span><b>TSh {tsh(b.total)}/= (pay the full amount)</b>
        <span>Valid until</span><b>{new Date(b.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</b>
      </div>
      <table className="cn-lines">
        <thead><tr><th>Item</th><th>No.</th><th>Amount</th></tr></thead>
        <tbody>{b.lines?.map((l) => <tr key={l.id}><td>{l.name}</td><td>{l.qty}</td><td>{tsh(l.amount)}</td></tr>)}</tbody>
      </table>
      <p className="cn-how">Pay at the bank, an agent or by mobile money using this control number. Then bring the bank slip or the
        message to the bursar's office. Items are given at the library after the payment is seen.</p>
      <p className="cn-foot">Made by {b.createdBy} · {new Date(b.createdAt).toLocaleString('en-GB')}</p>
    </div>
  );
}

export function PrintSlipButton({ b }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const done = () => setOn(false);
    window.addEventListener('afterprint', done);
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [on]);
  return (
    <>
      <button type="button" className="btn p" onClick={() => setOn(true)}><Icon name="file" /> Print for the parent</button>
      {on && createPortal(<div className="print-root"><ControlSlip b={b} /></div>, document.body)}
    </>
  );
}
