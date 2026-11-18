// Signing on the screen: the drawn signature pad, the PIN box (with an SMS code for big money), the seal badge and the QR under a paper.
// The server checks everything (backend/src/lib/seal.js); this is only how a person types and sees it.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { QR } from './qr';
import { ErrorNote } from './ui';

// A box to draw a signature with a finger or mouse. onChange(pngDataUrl | null).
export function SignPad({ onChange, height = 150 }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio; c.height = height * ratio;
    const g = c.getContext('2d');
    g.scale(ratio, ratio); g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#0a2a8a';
  }, [height]);

  const pos = (e) => { const r = ref.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const down = (e) => { e.preventDefault(); ref.current.setPointerCapture(e.pointerId); drawing.current = true; const g = ref.current.getContext('2d'); const [x, y] = pos(e); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.01, y); g.stroke(); };
  const move = (e) => { if (!drawing.current) return; const g = ref.current.getContext('2d'); const [x, y] = pos(e); g.lineTo(x, y); g.stroke(); dirty.current = true; };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (!dirty.current) return;
    setEmpty(false);
    onChange?.(ref.current.toDataURL('image/png'));
  };
  const clear = () => {
    const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height);
    dirty.current = false; setEmpty(true); onChange?.(null);
  };
  return (
    <div className="signpad">
      <canvas ref={ref} style={{ width: '100%', height, touchAction: 'none' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Signature box" />
      <div className="row"><span className="muted small">{empty ? 'Sign inside the box.' : 'Signed.'}</span><span className="grow" /><button type="button" className="btn sm" onClick={clear} disabled={empty}>Clear</button></div>
    </div>
  );
}

// Asks for the signing PIN (and the SMS code when the server says the amount is big).
// onConfirm({ pin, smsCode }) does the real request; if it throws, the message is shown here and the box stays open.
export function PinBox({ title, amountNote, onCancel, onConfirm }) {
  const [pin, setPin] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [needSms, setNeedSms] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true); setError('');
    try { await onConfirm({ pin, smsCode: needSms ? smsCode : undefined }); }
    catch (err) {
      if (err.data?.needSmsCode) setNeedSms(true);
      setError(err.message || 'It did not work.');
    } finally { setBusy(false); }
  };
  const ready = /^\d{4,6}$/.test(pin) && (!needSms || /^\d{6}$/.test(smsCode));
  return (
    <div className="mwrap" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <form className="modal" onSubmit={submit}>
        <div className="mh"><h2>{title || 'Sign'}</h2></div>
        <div className="mb">
          {amountNote && <p>{amountNote}</p>}
          <label>Your signing PIN
            <input type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="4 to 6 digits" /></label>
          {needSms && <label>SMS code sent to your phone
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={smsCode} onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, ''))} placeholder="6 digits" /></label>}
          <p className="muted small">Your drawn signature from My profile is put on the paper with your name and the time. <Link to="/profile">Change PIN or signature</Link></p>
          <ErrorNote error={error} />
        </div>
        <div className="mf"><button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button><button className="btn p" disabled={!ready || busy}>{busy ? 'Signing…' : 'Sign'}</button></div>
      </form>
    </div>
  );
}

const SEAL = { valid: ['ok', 'Seal good'], broken: ['bad', 'Seal BROKEN'], unsigned: ['', 'Not signed yet'] };
export function SealBadge({ seal }) {
  if (!seal) return null;
  const [tone, text] = SEAL[seal.status] || ['', seal.status];
  return <span className={`pill ${tone}`} title={seal.reason || 'The numbers on this paper are the ones that were signed.'}>{text}</span>;
}

// What the QR opens: a page anyone can use to check the paper (no sign-in).
// eslint-disable-next-line react-refresh/only-export-components
export const verifyUrl = (type, id, code) => `${window.location.origin}/verify/${type}/${id}?c=${encodeURIComponent(code)}`;

export function SealQR({ type, id, seal }) {
  if (!seal?.code) return null;
  return (
    <div className="sealqr no-print">
      <div className="sealqr-box"><QR value={verifyUrl(type, id, seal.code)} title="Check this paper" /></div>
      <div><b>Check this paper</b><br /><span className="muted small">Scan the QR, or compare the code: <b>{seal.code}</b></span>{seal.status === 'broken' && <p className="rq-note bad">{seal.reason}</p>}</div>
    </div>
  );
}
