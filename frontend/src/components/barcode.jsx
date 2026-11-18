/* eslint-disable react-refresh/only-export-components */
// Barcodes drawn by the app itself (Code 128, set B): no extra package, prints sharp at any size.
// Any ordinary barcode scanner reads them, and so does a phone camera.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';
import { QR } from './qr';
import { api } from '../api';

// Bar and space widths of the 107 Code 128 symbols (103 = start A, 104 = start B, 105 = start C, 106 = stop).
const PATTERNS = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 '
  + '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 '
  + '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 '
  + '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 '
  + '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 '
  + '114131 311141 411131 211412 211214 211232 2331112').split(' ');

// Text -> list of bar/space widths (starts with a bar). Only printable ASCII; anything else becomes "?".
export function code128(text) {
  const values = [...String(text)].map((ch) => { const v = ch.charCodeAt(0) - 32; return v >= 0 && v <= 94 ? v : 31; });
  const check = values.reduce((s, v, i) => s + v * (i + 1), 104) % 103;
  return [104, ...values, check, 106].map((v) => PATTERNS[v]).join('');
}

export function Barcode({ value, height = 38, showText = true }) {
  const widths = code128(value);
  const total = [...widths].reduce((s, w) => s + Number(w), 0);
  const quiet = 10;
  const bars = [];
  let x = quiet;
  [...widths].forEach((w, i) => { if (i % 2 === 0) bars.push(<rect key={i} x={x} y="0" width={Number(w)} height={height} />); x += Number(w); });
  return (
    <span className="barcode">
      <svg viewBox={`0 0 ${total + quiet * 2} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Barcode ${value}`} shapeRendering="crispEdges">
        <rect x="0" y="0" width={total + quiet * 2} height={height} fill="#fff" /><g fill="#000">{bars}</g>
      </svg>
      {showText && <span className="bc-text">{value}</span>}
    </span>
  );
}

// Prints its children on A4 (labels or ID cards), then closes. Waits for the photos to load first (at most 4 s).
export function PrintSheet({ children, onDone }) {
  const ref = useRef();
  useEffect(() => {
    const done = () => onDone();
    window.addEventListener('afterprint', done);
    let stop = false;
    const imgs = [...(ref.current?.querySelectorAll('img') || [])];
    const ready = Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
    Promise.race([ready, new Promise((r) => setTimeout(r, 4000))]).then(() => setTimeout(() => { if (!stop) window.print(); }, 80));
    return () => { stop = true; window.removeEventListener('afterprint', done); };
  }, [onDone]);
  return createPortal(<div ref={ref} className="print-root sheet">{children}</div>, document.body);
}

// A sheet of small QR labels (63.5 x 38.1 mm, 3 across A4): [{ code, title, sub }]
export const LabelSheet = ({ labels }) => (
  <div className="labelgrid">{labels.map((l, i) => (
    <div className="label" key={`${l.code}-${i}`}>
      <QR value={l.code} />
      <div className="label-t"><img src="/musabe-logo.png" alt="" /><b>{l.title}</b><span className="code">{l.code}</span>{l.sub && <span className="sub">{l.sub}</span>}</div>
    </div>
  ))}</div>
);

// QR labels of one delivery: the store-keeper prints them and sticks them on before the goods go to the school.
export function DeliveryLabelsButton({ id, className = 'btn sm', label = 'Print QR labels' }) {
  const [labels, setLabels] = useState(null);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const d = await api.get(`/store/delivery-labels/${id}`);
      setLabels(d.lines.flatMap((l) => (l.returnable
        ? l.labels.filter((x) => x.status !== 'lost').map((x) => ({ code: x.code, title: l.item, sub: `${d.number} · ${d.school}` }))
        : Array.from({ length: Math.min(l.labels[0].count, 500) }, () => ({ code: l.labels[0].code, title: l.item, sub: d.school })))));
    } catch (e) { window.alert(e.message); }
    setBusy(false);
  };
  return (
    <>
      <button type="button" className={className} disabled={busy} onClick={open}><Icon name="scan" /> {busy ? 'Loading…' : label}</button>
      {labels && labels.length > 0 && <PrintSheet onDone={() => setLabels(null)}><LabelSheet labels={labels} /></PrintSheet>}
    </>
  );
}

export function PrintButton({ label = 'Print', disabled, children, className = 'btn p' }) {
  const [on, setOn] = useState(false);
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => setOn(true)}><Icon name="file" /> {label}</button>
      {on && <PrintSheet onDone={() => setOn(false)}>{children}</PrintSheet>}
    </>
  );
}
