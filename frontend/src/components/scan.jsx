// Scan box for QR / barcode scanners (the kind used in supermarkets): the scanner types the code and presses Enter.
// Typing the code by hand works too. Scanning with a phone camera belongs to the coming mobile app, not this web page.
import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui';

export function ScanBox({ onScan, placeholder = 'Scan the QR code with the scanner, or type the code and press Enter', busy }) {
  const [v, setV] = useState('');
  const ref = useRef();
  // Keep the box ready: after every scan the next one can come at once.
  useEffect(() => { if (!busy) ref.current?.focus(); }, [busy]);
  const send = (code) => { const c = String(code || '').trim(); setV(''); if (c) onScan(c); };
  return (
    <div className="scanbox">
      <form onSubmit={(e) => { e.preventDefault(); send(v); }}>
        <Icon name="scan" />
        <input ref={ref} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} autoFocus autoComplete="off" autoCapitalize="characters"
          spellCheck={false} enterKeyHint="go" aria-label="Scanned code" />
        <button type="submit" className="btn">OK</button>
      </form>
    </div>
  );
}
