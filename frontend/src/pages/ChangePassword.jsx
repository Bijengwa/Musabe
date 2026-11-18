import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api';
import { Icon, useToast } from '../components/ui';
import './login.css';

// Shown on its own (forced) after a temporary password, or as a page from the profile later.
// Same look as the sign-in page (round white emblem, same fields), so it is clear it is the same door.
const MIN = 12;
function Field({ id, label, value, onChange, show, onToggle, auto, autoFocus, note }) {
  return (
    <label className="lg-field">
      <span>{label}</span>
      <div className="lg-input">
        <Icon name="lock" />
        <input id={id} type={show ? 'text' : 'password'} autoComplete={auto} value={value} autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)} required />
        {onToggle && <button type="button" className="lg-eye" onClick={onToggle} aria-label={show ? 'Hide passwords' : 'Show passwords'} aria-pressed={show}><Icon name={show ? 'eyeoff' : 'eye'} /></button>}
      </div>
      {note}
    </label>
  );
}

export default function ChangePassword() {
  const { user, refresh, askLogout } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const long = pw.length >= MIN;
  const same = pw2.length > 0 && pw === pw2;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!long) return setError(`Use at least ${MIN} characters.`);
    if (pw !== pw2) return setError('The two new passwords are not the same.');
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: cur, newPassword: pw });
      toast('Password changed');
      await refresh();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="lg">
      <i className="lg-orb a" /><i className="lg-orb b" />
      <form className="lg-form" onSubmit={submit} noValidate>
        <header className="lg-top">
          <img className="lg-logo" src="/musabe-logo.png" alt="Musabe Schools" />
          <h1>Choose your own password</h1>
          <p>Welcome, {user.fullName}. You signed in with a temporary password. Choose a new one that only you know.</p>
        </header>

        <Field id="cur" label="Temporary password" value={cur} onChange={setCur} show={show} auto="current-password" autoFocus />
        <Field id="new" label="New password" value={pw} onChange={setPw} show={show} onToggle={() => setShow(!show)} auto="new-password"
          note={<em className={`lg-small ${long ? 'ok' : pw ? '' : 'hint'}`}>{long ? <><Icon name="check" /> Long enough</> : `At least ${MIN} characters (${Math.max(0, MIN - pw.length)} more). Not your name or username.`}</em>} />
        <Field id="new2" label="Type it again" value={pw2} onChange={setPw2} show={show} auto="new-password"
          note={pw2 ? <em className={`lg-small ${same ? 'ok' : ''}`}>{same ? <><Icon name="check" /> They match</> : 'Not the same yet'}</em> : null} />
        <p className="lg-small hint" style={{ margin: 0 }}>A short sentence is easiest to remember, e.g. “mama neema 2026”.</p>

        {error && <p className="lg-msg bad" role="alert"><Icon name="alert" /> {error}</p>}
        <button className="lg-btn" disabled={busy || !cur || !long || !same}>{busy ? <><span className="lg-spin" /> Saving…</> : 'Save password'}</button>
        <button type="button" className="lg-back" onClick={askLogout}>Sign out</button>
      </form>
    </div>
  );
}
