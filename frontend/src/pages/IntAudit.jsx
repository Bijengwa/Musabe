// Internal audit: the Accountant office (2026-11-24). Automatic checks, findings, notes, close with a reason.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useLive } from '../live';
import { useAuth } from '../auth/AuthContext';
import { useSchools } from '../layout/scope';
import { Empty, ErrorNote, ExcelButton, Kpi, Loading, Modal, PageHead, Panel, Tabs, fmtWhen, tsh, useToast } from '../components/ui';

const TONE = { high: 'bad', medium: 'warn', low: 'ok' };

export default function IntAudit() {
  const toast = useToast();
  const { user } = useAuth();
  const schools = useSchools();
  const admin = !user.school?.id;
  const [tab, setTab] = useState('checks');
  const [school, setSchool] = useState('');
  const [c, setC] = useState(null);
  const [f, setF] = useState(null);
  const [error, setError] = useState('');
  const [pick, setPick] = useState(null);   // { check, item } to open as a finding
  const [open, setOpen] = useState(null);   // finding shown
  const load = useCallback(() => {
    const q = school ? `?school=${school}` : '';
    return Promise.all([api.get(`/intaudit/checks${q}`), api.get('/intaudit/findings')]).then(([a, b]) => { setC(a); setF(b); setError(''); }).catch((e) => setError(e.message));
  }, [school]);
  useEffect(() => { load(); }, [load]);
  useLive(['finding', 'receipt', 'stock'], load);
  const total = c ? c.checks.reduce((s, x) => s + x.count, 0) : 0;
  return (
    <>
      <PageHead title="Internal audit" sub="The system checks its own records. Open a finding for anything that needs follow-up, and close it with a written reason.">
        {admin && <select value={school} onChange={(e) => setSchool(e.target.value)} aria-label="School"><option value="">All schools</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.shortName}</option>)}</select>}
        <ExcelButton href={`/api/intaudit/checks/export.xlsx${school ? `?school=${school}` : ''}`} />
      </PageHead>
      <ErrorNote error={error} />
      {c && <div className="kpis"><Kpi tone={total ? 'warn' : 'ok'} label="Items found" value={total} /><Kpi tone={c.openFindings ? 'warn' : 'ok'} label="Open findings" value={c.openFindings} /></div>}
      <Tabs tabs={[['checks', 'Checks'], ['open', 'Open findings'], ['closed', 'Closed']]} value={tab} onChange={setTab} />
      {!c || !f ? <Loading /> : tab === 'checks' ? c.checks.map((k) => (
        <Panel key={k.key} title={`${k.title} (${k.count})`} flush>
          <p className="small muted" style={{ margin: '8px 12px' }}><span className={`pill ${TONE[k.severity]}`}>{k.severity}</span> {k.why}{k.amount ? ` Total: ${tsh(k.amount)}.` : ''}</p>
          {!k.count ? <p className="small" style={{ margin: '0 12px 12px' }}>Nothing found.</p> : (
            <div className="tw"><table className="stafftable"><thead><tr><th>School</th><th>What</th><th>Detail</th><th>Amount</th><th /></tr></thead>
              <tbody>{k.items.map((i) => (
                <tr key={i.ref}><td>{i.school}</td><td><b>{i.title}</b></td><td className="small">{i.detail}</td><td>{i.amount != null ? tsh(i.amount) : ''}</td>
                  <td>{i.findingId ? <span className="pill warn sm">Finding open</span> : c.canWrite && <button className="btn sm" onClick={() => setPick({ check: k.key, item: i })}>Open finding</button>}</td></tr>))}</tbody></table></div>)}
        </Panel>
      )) : (
        <Panel flush>{(() => { const list = f.findings.filter((x) => x.status === tab); return !list.length ? <Empty icon="file" title="No findings here" steps={['Open a finding from a check.', 'Add notes as you follow it up.', 'Close it with a written reason.']} /> : (
          <div className="tw"><table className="stafftable"><thead><tr><th>Finding</th><th>School</th><th>Severity</th><th>Opened</th><th /></tr></thead>
            <tbody>{list.map((x) => <tr key={x.id} onClick={() => setOpen(x)} style={{ cursor: 'pointer' }}><td><b>{x.title}</b></td><td>{x.school || 'Office'}</td><td><span className={`pill ${TONE[x.severity]}`}>{x.severity}</span></td><td className="small nowrap">{fmtWhen(x.openedAt)}</td><td><button className="btn sm">Open</button></td></tr>)}</tbody></table></div>); })()}</Panel>
      )}
      {pick && <OpenModal pick={pick} onClose={() => setPick(null)} onDone={() => { setPick(null); load(); toast('Finding opened'); }} />}
      {open && <FindingModal id={open.id} list={f} canWrite={f.canWrite} onClose={() => setOpen(null)} onDone={() => { load(); }} toast={toast} />}
    </>
  );
}

function OpenModal({ pick, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const go = () => api.post('/intaudit/findings', { check: pick.check, ref: pick.item.ref, title: pick.item.title, schoolId: pick.item.schoolId, note }).then(onDone).catch((e) => setError(e.message));
  return (
    <Modal title="Open audit finding" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={go}>Open finding</button></>}>
      <p><b>{pick.item.title}</b><br /><span className="small muted">{pick.item.detail}</span></p>
      <label className="small">What will you look into?</label>
      <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%' }} />
      <ErrorNote error={error} />
    </Modal>
  );
}

function FindingModal({ id, list, canWrite, onClose, onDone, toast }) {
  const x = list.findings.find((y) => y.id === id);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  if (!x) return <Modal title="Finding" onClose={onClose}><Loading /></Modal>;
  const act = (path, okMsg) => api.post(`/intaudit/findings/${id}/${path}`, { note }).then(() => { setNote(''); setError(''); onDone(); toast(okMsg); if (path === 'close') onClose(); }).catch((e) => setError(e.message));
  return (
    <Modal wide title={x.title} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close window</button>}>
      <p><span className={`pill ${TONE[x.severity]}`}>{x.severity}</span> <span className="small muted">{x.school || 'Office'} · opened by {x.by} on {fmtWhen(x.openedAt)}</span></p>
      <ul className="small">{x.notes.map((n, i) => <li key={i}><b>{n.by}</b> ({fmtWhen(n.at)}): {n.note}</li>)}</ul>
      {x.status === 'closed' ? <p className="small"><b>Closed by {x.closedBy}</b> on {fmtWhen(x.closedAt)}: {x.closeNote}</p> : canWrite && (
        <>
          <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write a note, or how it was settled" style={{ width: '100%' }} />
          <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn" onClick={() => act('note', 'Note added')}>Add note</button><button className="btn primary" onClick={() => act('close', 'Finding closed')}>Close finding</button></div>
        </>)}
      <ErrorNote error={error} />
    </Modal>
  );
}
