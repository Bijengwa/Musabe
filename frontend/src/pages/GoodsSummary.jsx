// Summary of Daily Goods Received (book No. 1701), as on the paper: Date; S/N, Supplier's name, Buyer's name, Item, Qty,
// Unit cost, Total cost, Terms of payment (cash / credit), Destination; TOTAL; Prepared by, Checked by, Approved by.
// Goods count as received the day Mapokezi checked them. Any dates; print or Excel.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Empty, ErrorNote, ExcelButton, Kpi, tsh } from '../components/ui';
import { todayStr } from '../components/common';
import { PrintButton } from '../components/barcode';
import './requisition.css';

const dmy = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-GB') : '');

function Sheet({ d }) {
  return (
    <div className="rq-sheet">
      <div className="rq-top"><img src="/musabe-logo.png" alt="" /><div><h2 style={{ margin: 0 }}>MUSABE SCHOOLS</h2><div className="rq-small">P.O. Box 5154, BUGANDO, MWANZA</div></div></div>
      <div className="rq-title">Summary of Daily Goods Received</div>
      <div className="rq-line"><span className="rq-field" style={{ flex: '0 1 380px' }}><span>Date</span><span className="rq-val">{dmy(d.from)}{d.to !== d.from ? ` to ${dmy(d.to)}` : ''}</span></span></div>
      <div className="tw"><table className="rq-t tight">
        <thead><tr><th>S/N</th>{d.from !== d.to && <th>Date</th>}<th>Supplier's name</th><th>Buyer's name</th><th>Item</th><th className="n">Qty</th><th className="n">Unit cost</th><th className="n">Total cost</th><th>Terms of payment</th><th>Destination</th></tr></thead>
        <tbody>{d.lines.map((l, i) => (
          <tr key={i}><td className="c">{i + 1}</td>{d.from !== d.to && <td>{dmy(l.day)}</td>}<td>{l.supplier}{l.noReceipt && <div className="rq-small" style={{ color: '#c01818' }}>no receipt</div>}</td><td>{l.buyer}</td>
            <td>{l.item}</td><td className="n">{l.qty} {l.unit}</td><td className="n">{tsh(l.unitCost)}</td><td className="n">{tsh(l.total)}</td><td>{l.terms}</td><td>{l.destination}</td></tr>
        ))}
        {d.lines.length < 8 && Array.from({ length: 8 - d.lines.length }, (_, i) => <tr key={`e${i}`}><td className="c">{d.lines.length + i + 1}</td>{Array.from({ length: d.from !== d.to ? 9 : 8 }, (_, j) => <td key={j} />)}</tr>)}</tbody>
        <tfoot><tr><td colSpan={d.from !== d.to ? 7 : 6} className="r"><b>TOTAL</b></td><td className="n"><b>{tsh(d.total)}</b></td><td colSpan={2} /></tr></tfoot>
      </table></div>
      <p className="rq-small" style={{ margin: '6px 0 0' }}>Cash: <b>{tsh(d.cash)}</b> · Credit: <b>{tsh(d.credit)}</b>{d.noReceipt ? ` · ${d.noReceipt} line(s) without a receipt` : ''}</p>
      <div className="rq-signs">
        {['Prepared by', 'Checked by', 'Approved by'].map((x) => <div className="rq-sig" key={x}><div className="rq-sigline" /><b>{x}</b><span className="who">Name ...............................</span><span className="dt">Date: ......./......./20....</span></div>)}
      </div>
    </div>
  );
}

export default function GoodsSummary() {
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get(`/purchases/summary/received?from=${from}&to=${to}`).then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message)); }, [from, to]);
  return (
    <div className="rq-wrap">
      <div className="rq-bar"><Link to="/purchases" className="btn sm">← Purchases</Link><h2 style={{ margin: 0 }}>Goods received summary</h2><span className="grow" />
        <ExcelButton href={`/api/purchases/summary/received?from=${from}&to=${to}&format=xlsx`} />{d && <PrintButton className="btn p" label="Print">{<Sheet d={d} />}</PrintButton>}</div>
      <div className="row" style={{ gap: 12, alignItems: 'end' }}>
        <label>From<input type="date" value={from} max={todayStr()} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} /></label>
        <label>To<input type="date" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <ErrorNote error={error} />
      {d && <div className="kpis">
        <Kpi tone="hi" label="Goods received" value={`TSh ${tsh(d.total)}`} sub={`${d.lines.length} line${d.lines.length === 1 ? '' : 's'}`} />
        <Kpi label="Cash" value={`TSh ${tsh(d.cash)}`} /><Kpi label="Credit" value={`TSh ${tsh(d.credit)}`} tone={d.credit ? 'warn' : undefined} />
        <Kpi label="Without a receipt" value={d.noReceipt} tone={d.noReceipt ? 'bad' : 'ok'} />
      </div>}
      {!d ? <Empty>Loading…</Empty> : <Sheet d={d} />}
    </div>
  );
}
