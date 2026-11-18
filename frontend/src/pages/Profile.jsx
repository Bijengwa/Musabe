import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { useAuth } from '../auth/AuthContext';
import { IdCardPanel } from '../components/idcard';
import { SignPad } from '../components/signing';
import { Avatar, Empty, ErrorNote, Icon, PageHead, Panel, PhoneInput, SchoolPill, cleanPhone, fmtPhone, fmtWhen, phoneProblem, useToast } from '../components/ui';

// My profile: who I am in the system.
// Name, username, role and school are set by the administrator and are locked here,
// because they appear on receipts, reports and the audit log. Phone and email are mine to change.

// The drawn signature and the signing PIN. Both need the account password. Used to sign requisitions, vouchers and other papers.
function SigningPanel({ user, refresh }) {
  const toast = useToast();
  const [image, setImage] = useState(null);
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [padKey, setPadKey] = useState(0);
  const [current, setCurrent] = useState(null);
  useEffect(() => { if (user.hasSignature) api.get('/me/signature').then((d) => setCurrent(d.image)).catch(() => {}); }, [user.hasSignature]);
  const save = async () => {
    setBusy(true); setError('');
    try {
      if (image) await api.put('/me/signature', { image, password });
      if (pin) await api.put('/me/pin', { pin, password });
      toast('Your signing details are saved');
      setImage(null); setPin(''); setPassword(''); setPadKey((k) => k + 1);
      await refresh();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Panel title="My signature and PIN" sub="Used to sign papers in the system">
      <div className="stack">
        <div className="row"><span className={`pill ${user.hasSignature ? 'ok' : 'warn'}`}>{user.hasSignature ? 'Signature saved' : 'No signature yet'}</span>
          <span className={`pill ${user.hasPin ? 'ok' : 'warn'}`}>{user.hasPin ? 'PIN set' : 'No PIN yet'}</span></div>
        {current && <img src={current} alt="My saved signature" style={{ maxHeight: 70, alignSelf: 'flex-start', border: '1px dashed var(--line)', borderRadius: 8, background: '#fff' }} />}
        <p className="muted small" style={{ margin: 0 }}>{user.hasSignature ? 'Draw again only if you want to change it.' : 'Draw your signature:'}</p>
        <SignPad key={padKey} onChange={setImage} />
        <label>{user.hasPin ? 'New signing PIN (leave empty to keep it)' : 'Signing PIN (4 to 6 digits, not 1234)'}
          <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></label>
        <label>Your account password (to confirm)
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <ErrorNote error={error} />
        <button className="btn p" disabled={busy || !password || (!image && !pin)} onClick={save}>Save</button>
      </div>
    </Panel>
  );
}

export default function Profile() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => api.get('/me/profile').then(setInfo).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useLive(['audit', 'me'], load);

  const saved = async (changed) => {
    setEditing(false);
    if (changed) { toast('Your details are saved'); await refresh(); load(); }
  };

  return (
    <>
      <PageHead title="My profile" sub="Your account in the Musabe Schools System." />
      <ErrorNote error={error} />

      <section className="panel profilehead">
        <Avatar name={user.fullName} size="xl" />
        <div className="grow">
          <h2>{user.fullName}</h2>
          <div className="row">
            <span className="pill info">{user.roleLabel}</span>
            <SchoolPill code={user.school?.code} name={user.school?.name} />
            <span className="muted small">@{user.username}</span>
          </div>
        </div>
        <Link className="btn" to="/settings"><Icon name="gear" /> Settings</Link>
      </section>

      <IdCardPanel me />

      <div className="g-wide">
        <div className="stack">
          <Panel title="Account details" right={<span className="pill"><Icon name="lock" /> Locked</span>}>
            <div className="fields">
              <Locked label="Full name" value={user.fullName} />
              <Locked label="Username" value={user.username} mono />
              <Locked label="Role" value={user.roleLabel} />
              <Locked label="School" value={user.school ? user.school.name : 'Administration (all schools)'} />
            </div>
            <p className="note"><Icon name="shield" /> Only your administrator can change these. They appear on receipts, reports and the audit log, so they must stay the same everywhere.</p>
          </Panel>

          <Panel title="Contact" sub="You can change these yourself"
            right={!editing && <button className="btn sm" onClick={() => setEditing(true)}><Icon name="edit" /> Edit</button>}>
            {editing ? <ContactForm user={user} onDone={saved} /> : (
              <div className="fields">
                <Field icon="phone" label="Phone" value={user.phone && fmtPhone(user.phone)} empty="No phone number yet" />
                <Field icon="mail" label="Email" value={user.email} empty="No email yet" />
              </div>
            )}
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Account">
            {!info ? <Empty>Loading…</Empty> : (
              <div className="stack kvlist">
                <div className="kv"><span>Account made</span><b>{fmtWhen(info.createdAt)}</b></div>
                <div className="kv"><span>Made by</span><b>{info.createdBy || 'System setup'}</b></div>
                <div className="kv"><span>Last sign-in</span><b>{fmtWhen(info.lastLoginAt)}</b></div>
                <div className="kv"><span>Password changed</span><b>{info.passwordChangedAt ? fmtWhen(info.passwordChangedAt) : 'Never'}</b></div>
                <Link className="btn" to="/settings#security"><Icon name="key" /> Change password</Link>
              </div>
            )}
          </Panel>

          <SigningPanel user={user} refresh={refresh} />

          <Panel title="My recent activity" flush>
            {!info ? <Empty>Loading…</Empty> : !info.activity.length ? <Empty>Nothing yet.</Empty> : (
              <div className="list">
                {info.activity.map((a) => (
                  <div className="li" key={a.id}>
                    <Icon name="clock" />
                    <div className="grow"><b className="fw5">{a.summary}</b><span>{fmtWhen(a.at)}</span></div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

const Locked = ({ label, value, mono }) => (
  <div className="field locked">
    <span className="l">{label}</span>
    <span className={`v${mono ? ' mono' : ''}`}>{value}<Icon name="lock" /></span>
  </div>
);

const Field = ({ icon, label, value, empty }) => (
  <div className="field">
    <span className="l">{label}</span>
    <span className={`v${value ? '' : ' muted'}`}><Icon name={icon} />{value || empty}</span>
  </div>
);

function ContactForm({ user, onDone }) {
  const [phone, setPhone] = useState(cleanPhone(user.phone));
  const [email, setEmail] = useState(user.email || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (phoneProblem(phone)) return setError(`Phone: ${phoneProblem(phone)}`);
    setBusy(true); setError('');
    try {
      const r = await api.patch('/me', { phone, email });
      onDone(!r.unchanged);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="fg">
        <label>Phone<PhoneInput id="p-phone" value={phone} onChange={setPhone} autoFocus /></label>
        <label>Email<input id="p-email" type="email" autoComplete="email" placeholder="name@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Leave a box empty to remove it.</p>
      <ErrorNote error={error} />
      <div className="row">
        <button className="btn p" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn" onClick={() => onDone(false)} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}
