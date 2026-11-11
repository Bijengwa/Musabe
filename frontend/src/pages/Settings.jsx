import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { chime } from '../layout/Bell';
import { useAuth } from '../auth/AuthContext';
import { Empty, ErrorNote, Icon, Modal, PageHead, Panel, fmtWhen, useToast } from '../components/ui';

const THEMES = [
  { key: 'light', label: 'Light', icon: 'sun', hint: 'White pages' },
  { key: 'dark', label: 'Dark', icon: 'moon', hint: 'Easy on the eyes at night' },
  { key: 'system', label: 'System', icon: 'auto', hint: 'Follows your phone or computer' },
];
const TEXT = [
  { key: 'normal', label: 'Normal' },
  { key: 'large', label: 'Large', hint: 'Bigger text on pages and forms' },
];

// My settings: how the app looks, password, devices, sign out.
export default function Settings() {
  const { user, savePrefs, askLogout } = useAuth();
  const toast = useToast();
  const { hash } = useLocation();
  const [pwOpen, setPwOpen] = useState(false);
  const prefs = { theme: 'system', textSize: 'normal', ...user.preferences };

  // "Change password" links from the profile land on the Security part.
  useEffect(() => {
    if (hash === '#security') document.getElementById('security')?.scrollIntoView({ block: 'start' });
  }, [hash]);

  const set = async (change) => {
    try { await savePrefs(change); } catch (e) { toast(e.message); }
  };

  return (
    <>
      <PageHead title="Settings" sub="These settings are only for your account. They follow you to every phone or computer you sign in on." />

      <Panel title="Appearance">
        <div className="stack">
          <div>
            <h3 className="sh">Theme</h3>
            <div className="choices" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => (
                <button key={t.key} type="button" role="radio" aria-checked={prefs.theme === t.key}
                  className={`choice${prefs.theme === t.key ? ' on' : ''}`} onClick={() => set({ theme: t.key })}>
                  <span className={`swatch sw-${t.key}`}><i /><i /><i /></span>
                  <span className="cl"><Icon name={t.icon} /> {t.label}{prefs.theme === t.key && <Icon name="check" />}</span>
                  <span className="ch">{t.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="sh">Text size</h3>
            <div className="seg" role="radiogroup" aria-label="Text size">
              {TEXT.map((t) => (
                <button key={t.key} role="radio" aria-checked={prefs.textSize === t.key} className={prefs.textSize === t.key ? 'on' : ''}
                  onClick={() => set({ textSize: t.key })}>{t.label}</button>
              ))}
            </div>
            <p className="small muted" style={{ margin: '6px 0 0' }}>Large makes the words on every page a little bigger.</p>
          </div>
        </div>
      </Panel>

      <div id="notifications" className="anchor" />
      <Notifications sound={user.preferences?.sound !== false} set={set} />

      <div id="security" className="anchor" />
      <Panel title="Password" right={<button className="btn sm" onClick={() => setPwOpen(true)}><Icon name="key" /> Change password</button>}>
        <p style={{ margin: 0 }} className="muted">Use a password only you know, with at least 8 characters, letters and numbers. When you change it, your other devices are signed out.</p>
      </Panel>

      <Devices />

      <Panel title="Sign out">
        <div className="row spread">
          <p style={{ margin: 0 }} className="muted">Sign out of this device. Your work is saved.</p>
          <button className="btn danger" onClick={askLogout}><Icon name="logout" /> Sign out</button>
        </div>
      </Panel>

      {pwOpen && <PasswordModal onClose={() => setPwOpen(false)} />}
    </>
  );
}

function Notifications({ sound, set }) {
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const [perm, setPerm] = useState(supported ? window.Notification.permission : 'unsupported');
  const ask = async () => { try { setPerm(await window.Notification.requestPermission()); } catch { /* ignore */ } };
  return (
    <Panel title="Notifications">
      <div className="stack">
        <div className="row spread">
          <div><b className="fw5">Sound</b><p className="small muted" style={{ margin: 0 }}>Play a short sound when something new happens.</p></div>
          <div className="row">
            <button className="btn sm" onClick={chime}><Icon name="volume" /> Test</button>
            <div className="seg" role="radiogroup" aria-label="Sound">
              <button role="radio" aria-checked={sound} className={sound ? 'on' : ''} onClick={() => set({ sound: true })}>On</button>
              <button role="radio" aria-checked={!sound} className={!sound ? 'on' : ''} onClick={() => set({ sound: false })}>Off</button>
            </div>
          </div>
        </div>
        <div className="row spread">
          <div><b className="fw5">Pop-ups on this device</b><p className="small muted" style={{ margin: 0 }}>Show a message on the screen even when the app is in the background.</p></div>
          {perm === 'granted' ? <span className="pill ok"><Icon name="check" /> On</span>
            : perm === 'denied' ? <span className="pill">Blocked in browser settings</span>
              : perm === 'unsupported' ? <span className="pill">Not available here</span>
                : <button className="btn sm" onClick={ask}>Turn on</button>}
        </div>
      </div>
    </Panel>
  );
}

// "Chrome on Windows", "Safari on iPhone" from the browser's user-agent text.
function describe(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : null;
  const phone = /iPhone|Android|Mobile/.test(ua);
  return { name: browser && os ? `${browser} on ${os}` : browser || os || 'Unknown device', phone };
}

function Devices() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get('/me/sessions').then((d) => { setRows(d.sessions); setError(''); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useLive(['auth'], load);

  const end = async (s) => {
    try { await api.post(`/me/sessions/${s.id}/end`); toast('That device is signed out'); load(); } catch (e) { toast(e.message); }
  };
  const endOthers = async () => {
    try {
      const r = await api.post('/me/sessions/end-others');
      toast(r.ended ? `Signed out ${r.ended} other device${r.ended > 1 ? 's' : ''}` : 'No other devices were signed in');
      load();
    } catch (e) { toast(e.message); }
  };
  const others = rows ? rows.filter((s) => !s.current).length : 0;

  return (
    <Panel title="Where you are signed in" sub={rows ? `${rows.length} device${rows.length === 1 ? '' : 's'}` : ''} flush
      right={others > 0 && <button className="btn sm danger" onClick={endOthers}>Sign out all other devices</button>}>
      <ErrorNote error={error} />
      {!rows ? <Empty>Loading…</Empty> : (
        <div className="list">
          {rows.map((s) => {
            const d = describe(s.userAgent);
            return (
              <div className="li" key={s.id}>
                <span className="devic"><Icon name={d.phone ? 'phone' : 'monitor'} /></span>
                <div className="grow">
                  <b>{d.name} {s.current && <span className="pill ok">This device</span>}</b>
                  <span>Signed in {fmtWhen(s.signedInAt)} · last used {fmtWhen(s.lastSeenAt)}{s.ip ? ` · ${s.ip}` : ''}</span>
                </div>
                {!s.current && <button className="btn sm" onClick={() => end(s)}>Sign out</button>}
              </div>
            );
          })}
        </div>
      )}
      <p className="note pad"><Icon name="shield" /> If you see a device you do not know, sign it out and change your password.</p>
    </Panel>
  );
}

function PasswordModal({ onClose }) {
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
      toast('Password changed. Your other devices are signed out.');
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal title="Change password" onClose={onClose}>
      <form className="stack" onSubmit={submit} id="pwform">
        <label>Current password<input id="cp-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required autoFocus /></label>
        <label>New password<input id="cp-new" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></label>
        <label>Type it again<input id="cp-new2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></label>
        <p className="small muted" style={{ margin: 0 }}>At least 8 characters, with letters and numbers.</p>
        <ErrorNote error={error} />
        <div className="row">
          <button className="btn p" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
