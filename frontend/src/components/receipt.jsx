/* eslint-disable react-refresh/only-export-components */
// Receipt pieces shared by Sell, Receipts and Give: status pill, details, and the printed receipt.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useLive } from '../live';
import { Empty, ErrorNote, Icon, Modal, SchoolPill, fmtPhone, fmtWhen, tsh } from './ui';

export const STATUS_TONE = { waiting: 'warn', part: 'info', given: 'ok' };

export function StatusPill({ r }) {
  if (r.late) return <span className="pill bad"><Icon name="clock" /> Late · {r.statusLabel}</span>;
  return <span className={`pill ${STATUS_TONE[r.status]}`}>{r.statusLabel}</span>;
}

// "How long has it waited": 3 h, 2 days
export const waited = (h) => (h == null ? '' : h < 1 ? 'under 1 hour' : h < 48 ? `${h} h` : `${Math.floor(h / 24)} days`);

// 42000 -> "Forty-two thousand shillings only"
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function under1000(n) {
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : '');
  return [h && `${ONES[h]} hundred`, rest].filter(Boolean).join(h && rest ? ' and ' : '');
}
export function inWords(n) {
  n = Math.floor(Number(n) || 0);
  if (!n) return 'Zero shillings only';
  const parts = [];
  for (const [size, word] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'], [1, '']]) {
    const c = Math.floor(n / size) % 1000;
    if (c) parts.push(`${under1000(c)}${word ? ` ${word}` : ''}`);
  }
  const s = parts.join(' ');
  return `${s[0].toUpperCase()}${s.slice(1)} shillings only`;
}

const ddmm = (iso) => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/`; };
const yy = (iso) => String(new Date(iso).getFullYear()).slice(2);

// The receipt laid out like the school's paper receipt book (A5 landscape): crest and school name,
// No. in red, SCHOOL UNIFORM RECEIPT, Date, Received from / Class, the items table, the sum in words,
// Banked on, the TShs box and the signature line. Used for printing and for the preview on screen.
export function ReceiptBook({ r }) {
  const rows = Math.max(5, r.lines.length);
  const banked = r.method === 'cash' ? '' : `${r.methodLabel}${r.reference ? ` — ${r.reference}` : ''}`;
  return (
    <div className="bkwrap">
      <div className="bk">
        <div className="bk-head">
          <img src="/musabe-logo.png" alt="" />
          <div className="bk-title">
            <h1 className={r.school.receiptTitle.length > 30 ? 'longer' : r.school.receiptTitle.length > 24 ? 'long' : ''}>{r.school.receiptTitle}</h1>
            {r.school.receiptContact.split('\n').map((l, i) => <p key={i}>{l}</p>)}
          </div>
        </div>
        <div className="bk-row1">
          <span className="bk-no">No. <b>{r.number}</b></span>
          <span className="bk-rt">SCHOOL UNIFORM RECEIPT</span>
          <span>Date: <span className="bk-fill">{ddmm(r.soldAt)}</span> 20<span className="bk-fill">{yy(r.soldAt)}</span></span>
        </div>
        <div className="bk-line"><span>Received from</span><span className="bk-fill grow">{r.studentName}</span><span>Class</span><span className="bk-fill cls">{r.studentClass}</span></div>
        <div className="bk-being">Being payment of</div>
        <table className="bk-table">
          <thead><tr><th>ITEM</th><th>No. ITEM</th><th>AMOUNT</th></tr></thead>
          <tbody>
            {Array.from({ length: rows }, (_, i) => {
              const l = r.lines[i];
              return <tr key={i}><td>{l?.name}{l?.outOfStock ? ' *' : ''}</td><td>{l?.qty}</td><td>{l ? tsh(l.amount) : ''}</td></tr>;
            })}
          </tbody>
        </table>
        <div className="bk-line"><span>The sum of shillings</span><span className="bk-dots grow">{inWords(r.total)}</span></div>
        <div className="bk-line"><span className="bk-dots grow" /><i className="bk-thanks">With Thanks</i></div>
        <div className="bk-line"><span>Banked on</span><span className="bk-dots half">{banked}</span></div>
        <div className="bk-foot">
          <span className="bk-tsh">TShs.</span>
          <span className="bk-box">{tsh(r.total)}/=</span>
          <span className="bk-sign"><span className="bk-dots">{r.soldBy}</span><span>For : {r.school.receiptSigner}</span></span>
        </div>
        {r.lines.some((l) => l.outOfStock) && <div className="bk-note">* Not in the library at the time of payment: your child gets it when it arrives.</div>}
        <div className="bk-note">Once fee paid is not refundable</div>
      </div>
    </div>
  );
}

// The paper receipt. Rendered outside the app, shown only when printing.
function PrintSheet({ r }) {
  return createPortal(<div className="print-root"><ReceiptBook r={r} /></div>, document.body);
}

// Print button: puts the receipt on the page, opens the print window, then removes it.
export function PrintButton({ r, big, autoFocus }) {
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
      <button type="button" className={`btn p${big ? ' big' : ''}`} onClick={() => setOn(true)} autoFocus={autoFocus}><Icon name="file" /> Print receipt</button>
      {on && <PrintSheet r={r} />}
    </>
  );
}

// Details of one receipt: what was paid, what was given, when and by whom.
export function ReceiptDetails({ r }) {
  return (
    <div className="stack">
      <div className="rcard">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><span className="muted small">Receipt</span><h3 className="rnum">{r.number}</h3></div>
          <div className="row"><SchoolPill code={r.school.code} name={r.school.shortName} /><StatusPill r={r} /></div>
        </div>
        <div className="kvgrid">
          <span>Student</span><b>{r.studentName} · {r.studentClass}{r.gender ? ` · ${r.gender === 'boy' ? 'Boy' : 'Girl'}` : ''}</b>
          {r.payerName && <><span>Paid by</span><b>{r.payerName}{r.payerPhone ? ` · ${fmtPhone(r.payerPhone)}` : ''}</b></>}
          <span>Payment</span><b>{r.methodLabel}{r.reference ? ` · ${r.reference}` : ''}</b>
          <span>Bursar</span><b>{r.soldBy} · {fmtWhen(r.soldAt)}</b>
          {r.note && <><span>Note</span><b>{r.note}</b></>}
        </div>
      </div>
      <div className="tw"><table className="lines">
        <thead><tr><th>Item</th><th className="n">Qty</th><th className="n">Price</th><th className="n">Amount</th><th className="n">Given</th></tr></thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.name}</td><td className="n">{l.qty}</td><td className="n">{tsh(l.unitPrice)}</td><td className="n money">{tsh(l.amount)}</td>
              <td className="n">{l.left ? <span className="pill warn">{l.given} of {l.qty}</span> : <span className="pill ok"><Icon name="check" /> {l.qty}</span>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={3}>Total (TSh)</td><td className="n money">{tsh(r.total)}</td><td /></tr></tfoot>
      </table></div>
      {r.gives.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">Given by the library</b>
          {r.gives.map((g) => (
            <div key={g.id} className="givebox">
              <span><b>{g.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}</b></span>
              <span className="small muted">{g.givenBy} · {fmtWhen(g.at)}{g.collectedBy ? ` · collected by ${g.collectedBy}` : ''}{g.note ? ` · ${g.note}` : ''}</span>
            </div>
          ))}
        </div>
      )}
      {r.status !== 'given' && <p className="small muted" style={{ margin: 0 }}>Waiting at the library for {waited(r.waitingHours)}.</p>}
    </div>
  );
}

// Open a receipt by id (stays live: a give elsewhere updates it at once).
// Just the receipt, laid out like the paper one — no separate "details" screen to scan through.
export function ReceiptModal({ id, onClose, extra }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const load = () => api.get(`/receipts/${id}`).then((d) => setR(d.receipt)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useLive(['receipt', 'give'], load);
  return (
    <Modal wide title={r ? `Receipt ${r.number}` : 'Receipt'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Close</button>{r && extra?.(r, load)}{r && <PrintButton r={r} />}</>}>
      <ErrorNote error={error} />
      {!r ? <Empty>Loading…</Empty> : <div className="rpreview"><ReceiptBook r={r} /></div>}
    </Modal>
  );
}
