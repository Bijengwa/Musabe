// Small charts for the home pages. One series each, the theme's primary green, thin rounded bars,
// a tooltip on hover/tap, values written in text colours (never in the bar colour).
import { useState } from 'react';
import { tsh } from './ui';

const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
const dayLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// Money per day: vertical bars, today last.
export function DayBars({ data, height = 170, fmtLabel = dayLabel, todayLast = true }) {
  const [hi, setHi] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.money));
  const top = niceTop(max);
  const W = 640, H = height, L = 44, B = 22, T = 8;
  const bw = (W - L) / data.length;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const every = data.length > 16 ? 5 : data.length > 8 ? 2 : 1;
  const cur = hi != null ? data[hi] : null;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Money, ${data.length} bars`} onMouseLeave={() => setHi(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W} y1={y(top * f)} y2={y(top * f)} className="grid" />
            <text x={L - 6} y={y(top * f) + 4} textAnchor="end" className="ax">{short(top * f)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = Math.max(d.money ? 2 : 0, H - B - y(d.money));
          const x = L + i * bw + 1, w = Math.max(2, bw - 2);
          return (
            <g key={d.day} onMouseEnter={() => setHi(i)} onClick={() => setHi(i)}>
              <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
              {h > 0 && <path d={roundTop(x, H - B - h, w, h, Math.min(4, w / 2))} className={`bar${hi === i ? ' on' : ''}`} />}
              {i % every === (data.length - 1) % every && <text x={x + w / 2} y={H - 6} textAnchor="middle" className="ax">{i === data.length - 1 && todayLast ? 'Today' : fmtLabel(d.day)}</text>}
            </g>
          );
        })}
      </svg>
      <div className="charttip" aria-live="polite">{cur ? <><b>{fmtLabel(cur.day)}</b> TSh {tsh(cur.money)} · {cur.n} receipt{cur.n === 1 ? '' : 's'}</> : <span className="muted">Point at a bar to see the day</span>}</div>
    </div>
  );
}

// Horizontal bars with the value written at the end, e.g. money per school, top items.
export function BarList({ rows, value, label, sub, fmt = (v) => tsh(v), empty = 'Nothing yet.' }) {
  const max = Math.max(1, ...rows.map(value));
  if (!rows.length || !rows.some(value)) return <p className="muted small" style={{ margin: 0 }}>{empty}</p>;
  return (
    <div className="barlist">
      {rows.map((r, i) => (
        <div className="bl" key={i} title={`${label(r)}: ${fmt(value(r))}`}>
          <div className="bl-l"><b>{label(r)}</b>{sub && <span>{sub(r)}</span>}</div>
          <div className="bl-t"><i style={{ width: `${(value(r) / max) * 100}%` }} /></div>
          <b className="bl-v">{fmt(value(r))}</b>
        </div>
      ))}
    </div>
  );
}

function niceTop(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v) || v;
}
function roundTop(x, y, w, h, r) {
  r = Math.min(r, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
