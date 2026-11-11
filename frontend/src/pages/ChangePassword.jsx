import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api';
import { ErrorNote, useToast } from '../components/ui';

// Shown on its own (forced) after a temporary password, or as a page from the profile later.
export default function ChangePassword() {
  const { user, refresh, askLogout } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (pw !== pw2) return setError('The two new passwords are not the same.');
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: cur, newPassword: pw });
      toast('Password changed');
      await refresh();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="centerpage">
      <form className="loginform card" onSubmit={submit}>
        <img className="logo lg" src="/musabe-logo.png" alt="Musabe Schools" />
        <h2>Choose your own password</h2>
        <p className="hint">Welcome, {user.fullName}. You signed in with a temporary password. Choose a new one that only you know.</p>
        <label>Temporary password<input id="cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required autoFocus /></label>
        <label>New password<input id="new" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></label>
        <label>Type it again<input id="new2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></label>
        <p className="small muted">At least 8 characters, with letters and numbers.</p>
        <ErrorNote error={error} />
        <button className="btn p big" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        <button type="button" className="linkbtn" onClick={askLogout}>Sign out</button>
      </form>
    </div>
  );
}
