// QR code drawn as SVG (sharp on screen and on paper). Uses the small "qrcode-generator" package (no other packages).
import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

export function QR({ value, title }) {
  const { n, d } = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(String(value));
    q.make();
    const size = q.getModuleCount();
    let path = '';
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (q.isDark(r, c)) path += `M${c + 2},${r + 2}h1v1h-1z`;
    return { n: size + 4, d: path };
  }, [value]);
  return (
    <svg className="qr" viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label={title || `QR code ${value}`}>
      <rect width={n} height={n} fill="#fff" /><path d={d} fill="#000" />
    </svg>
  );
}
