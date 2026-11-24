import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api';
import { Icon } from '../components/ui';
import './login.css';

// Three ways in. Phone is the default (easiest for parents). The server accepts all three in the same field.
const METHODS = [
  { key: 'phone', label: 'Phone', icon: 'phone', field: 'Phone number', hint: 'Type your phone number' },
  { key: 'email', label: 'Email', icon: 'mail', field: 'Email address', hint: 'Type your email address' },
  { key: 'username', label: 'Username', icon: 'user', field: 'Username', hint: 'Type your username' },
];
const SCHOOLS = [['pre', 'Nursery & Primary'], ['boys', 'Boys Secondary'], ['girls', 'Girls Secondary']];

const nationalDigits = (v) => {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('255')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 9);
};
const groupNational = (d) => [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean).join(' ');
function nationalProblem(d) {
  if (!d) return '';
  if (d[0] !== '6' && d[0] !== '7') return 'After +255, the number starts with 6 or 7, e.g. 754 123 456.';
  if (d.length < 9) return `${9 - d.length} more digit${9 - d.length > 1 ? 's' : ''} needed (9 digits after +255).`;
  return '';
}

export default function Login() {
  const { login, verifyCode, resendCode } = useAuth();
  // When the account is in use on another device, the owner proves it with a code sent by SMS.
  const [ch, setCh] = useState(null);   // { challenge, phoneHint, minutes }
  const [code, setCode] = useState('');
  // Fingerprint / face sign-in only appears on a device that has a reader (and a secure page); otherwise nothing is shown.
  const [bio, setBio] = useState(false);
  useEffect(() => {
    let live = true;
    const ask = window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable;
    if (window.isSecureContext && typeof ask === 'function') ask.call(window.PublicKeyCredential).then((ok) => { if (live) setBio(!!ok); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const [method, setMethod] = useState('phone');
  const [forgot, setForgot] = useState(false);
  const [values, setValues] = useState({ phone: '', email: '', username: '' });
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [shake, setShake] = useState(0);
  const form = useRef(null);
  const m = METHODS.find((x) => x.key === method);
  const value = values[method];

  useEffect(() => {
    if (shake) form.current?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-9px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(0)' }], { duration: 380 });
  }, [shake]);

  // +255 is already shown, so the person types only the 9 digits that follow it, starting with 6 or 7 (a pasted 0739... or +255739... is cut to that).
  const set = (v) => setValues({ ...values, [method]: method === 'phone' ? nationalDigits(v) : v });
  const problem = method === 'phone' ? nationalProblem(value) : '';
  const typed = method === 'phone' ? `0${value}` : value.trim();   // the server knows the number as 0739 348 123

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setNote('');
    if (method === 'phone' && problem) { setError(problem); setShake((n) => n + 1); return; }
    setBusy(true);
    try {
      if (!forgot) { const r = await login(typed, password, remember); if (r?.needsCode) { setCh(r); setCode(''); } }
      else { const r = await api.post('/auth/forgot', { username: typed }); setNote(r.message); }
    } catch (err) { setError(err.message); setShake((n) => n + 1); } finally { setBusy(false); }
  };
  const checkCode = async (e) => {
    e.preventDefault();
    setError(''); setNote(''); setBusy(true);
    try { await verifyCode(ch.challenge, code); }
    catch (err) { setError(err.message); setShake((n) => n + 1); if (/Sign in again|expired/i.test(err.message)) setCh(null); } finally { setBusy(false); }
  };
  const again = async () => {
    setError(''); setNote('');
    try { const r = await resendCode(ch.challenge); setNote(`A new code was sent to ${r.phoneHint}.`); } catch (err) { setError(err.message); }
  };
  const flip = () => { setForgot(!forgot); setError(''); setNote(''); };

  if (ch) {
    return (
      <div className="lg-page">
        <i className="lg-orb a" /><i className="lg-orb b" />
        <form className="lg-form" ref={form} onSubmit={checkCode} noValidate>
          <header className="lg-top">
            <img className="lg-logo" src="/musabe-logo.png" alt="Musabe Schools" />
            <h1>Check your phone</h1>
            <p>We sent a 6-digit code by SMS to {ch.phoneHint}. It works for {ch.minutes} minutes. Signing in here will sign the other device out.</p>
          </header>
          <label className="lg-field">
            <span>SMS code</span>
            <div className="lg-input">
              <Icon name="lock" />
              <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required />
            </div>
          </label>
          {error && <p className="lg-msg bad" role="alert"><Icon name="alert" /> {error}</p>}
          {note && <p className="lg-msg ok" role="status"><Icon name="check" /> {note}</p>}
          <button className="lg-btn" disabled={busy || code.length !== 6}>{busy ? <><span className="lg-spin" /> Please wait…</> : 'Confirm and sign in'}</button>
          <button type="button" className="lg-back" onClick={again}>Send the code again</button>
          <button type="button" className="lg-back" onClick={() => { setCh(null); setCode(''); setError(''); setNote(''); }}>Back to sign in</button>
        </form>
      </div>
    );
  }

  return (
    <div className="lg-page">
      <i className="lg-orb a" /><i className="lg-orb b" />

      <form className="lg-form" ref={form} onSubmit={submit} noValidate>
        <header className="lg-top">
          <img className="lg-logo" src="/musabe-logo.png" alt="Musabe Schools" />
          <h1>{forgot ? 'Forgot password' : 'Welcome to Musabe'}</h1>
          <p>{forgot ? 'Type your details. Your administrator will give you a temporary password in person.' : 'Please sign in to continue.'}</p>
        </header>

        <div className="lg-tabs" role="tablist" aria-label="Sign in with">
          {METHODS.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={method === x.key} className={method === x.key ? 'on' : ''}
              onClick={() => { setMethod(x.key); setError(''); setNote(''); }}>
              <Icon name={x.icon} /> {x.label}
            </button>
          ))}
        </div>

        <label className="lg-field">
          <span>{m.field}</span>
          <div className={`lg-input${problem && value.length > 1 ? ' warn' : ''}`}>
            <Icon name={m.icon} />
            {method === 'phone' && <b className="lg-cc">+255</b>}
            <input key={method} id="login-id" autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false}
              type={method === 'email' ? 'email' : method === 'phone' ? 'tel' : 'text'} inputMode={method === 'phone' ? 'numeric' : method === 'email' ? 'email' : 'text'}
              autoComplete={method === 'phone' ? 'tel-national' : method === 'email' ? 'email' : 'username'}
              placeholder={method === 'phone' ? '754 123 456' : method === 'email' ? 'name@example.com' : 'your.username'}
              value={method === 'phone' ? groupNational(value) : value} onChange={(e) => set(e.target.value)} required />
          </div>
          {method === 'phone' && problem && value.length > 1 && <em className="lg-small">{problem}</em>}
        </label>

        {!forgot && (
          <label className="lg-field">
            <span className="lg-row">Password
              <button type="button" className="lg-link" onClick={flip}>Forgot password?</button>
            </span>
            <div className="lg-input">
              <Icon name="lock" />
              <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Your password"
                value={password} onChange={(e) => setPassword(e.target.value)} required
                onKeyUp={(ev) => setCaps(ev.getModifierState?.('CapsLock') || false)} onBlur={() => setCaps(false)} />
              <button type="button" className="lg-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                <Icon name={show ? 'eyeoff' : 'eye'} />
              </button>
            </div>
            {caps && <em className="lg-small warn"><Icon name="alert" /> Caps Lock is on</em>}
          </label>
        )}

        {!forgot && (
          <label className="lg-remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span className="lg-box"><Icon name="check" /></span>
            Keep me signed in
          </label>
        )}

        {error && <p className="lg-msg bad" role="alert"><Icon name="alert" /> {error}</p>}
        {note && <p className="lg-msg ok" role="status"><Icon name="check" /> {note}</p>}

        <button className="lg-btn" disabled={busy}>
          {busy ? <><span className="lg-spin" /> Please wait…</> : forgot ? 'Send request' : 'Sign in'}
        </button>

        {forgot ? (
          <button type="button" className="lg-back" onClick={flip}>Back to sign in</button>
        ) : (
          <>
            {bio && <div className="lg-or"><span>Or</span></div>}
            {/* Fingerprint / face sign-in: shown only on a device that has it (fingerprint reader, Windows Hello, Face ID...). */}
            {bio && <button type="button" className="lg-bio" disabled title="Coming soon"><Icon name="scan" /> Use fingerprint or face <small>Soon</small></button>}
          </>
        )}

        <ul className="lg-schools" aria-label="Musabe schools">
          {SCHOOLS.map(([c, n]) => <li key={c}><i className={`dot d-${c}`} />{n}</li>)}
        </ul>
      </form>
    </div>
  );
}
