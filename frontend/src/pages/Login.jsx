import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api';
import { ErrorNote } from '../components/ui';

const SCHOOLS = [
  ['pre', 'Musabe English Medium School', 'Nursery & Primary'],
  ['boys', 'Musabe Boys Secondary School', 'Form I–IV'],
  ['girls', 'Musabe Girls Secondary School', 'Form I–IV'],
];

export default function Login() {
  const { login } = useAuth();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      if (mode === 'login') await login(username.trim(), password, remember);
      else { const r = await api.post('/auth/forgot', { username: username.trim() }); setNote(r.message); }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <div className="brandside">
        <img className="logo lg" src="/musabe-logo.png" alt="Musabe Schools" />
        <div><h1>Musabe Schools System</h1><p>One system for the three schools in Buhongwa, Mwanza.</p></div>
        <div className="schl">
          {SCHOOLS.map(([c, n, l]) => <div key={c}><i className={`dot d-${c}`} /><span><b>{n}</b><br />{l}</span></div>)}
        </div>
      </div>
      <div className="pickside">
        <form className="loginform" onSubmit={submit}>
          <h2>{mode === 'login' ? 'Sign in' : 'Forgot password'}</h2>
          <p className="hint">{mode === 'login' ? 'Use the username and password your administrator gave you.' : 'Type your username. Your administrator will see the request and give you a temporary password in person.'}</p>
          <label>Username<input id="username" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus /></label>
          {mode === 'login' && <>
            <label>Password<input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <label className="chk"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Keep me signed in on this device</label>
          </>}
          <ErrorNote error={error} />
          {note && <p className="okmsg">{note}</p>}
          <button className="btn p big" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Send request'}</button>
          <button type="button" className="linkbtn" onClick={() => { setMode(mode === 'login' ? 'forgot' : 'login'); setError(''); setNote(''); }}>
            {mode === 'login' ? 'Forgot your password?' : 'Back to sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
