// Teacher on Duty (2026-11-23). The Second Master (Deputy Head Master) appoints the Teacher(s) on Duty of each week.
// The Teacher on Duty takes the roll call (Roll call page) and writes the daily duty report here.
// The Second Master and the Head Master read the reports and mark them as read.
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { useScope, useSchools } from '../layout/scope';
import { Empty, ErrorNote, Icon, Modal, PageHead, Panel, SkeletonTable, Tabs, useToast } from '../components/ui';

const FIELDS = [
  ['arrival', 'Arrival and opening of the day'], ['assembly', 'Assembly / morning parade'], ['cleanliness', 'Cleanliness (classes, toilets, compound)'],
  ['meals', 'Meals (breakfast, lunch, supper)'], ['lessons', 'Lessons and teachers in class'], ['discipline', 'Discipline cases (who and what)'],
  ['sick', 'Sick students'], ['visitors', 'Visitors'], ['evening', 'Evening prep and night (boarding)'], ['remarks', 'General remarks'],
];
const dm = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

function useSchool() {
  const { user } = useAuth();
  const [scope] = useScope();
  const schools = useSchools();
  return user.scope === 'all' ? scope || String(schools[0]?.id || '') : String(user.school?.id || '');
}

export default function Duty() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'report' ? 'report' : 'roster';
  return (
    <>
      <PageHead title="Teacher on Duty" sub="The Second Master appoints the Teachers on Duty for each week. They take the roll call and write the daily duty report." />
      <Tabs label="Teacher on Duty" value={tab} onChange={(k) => setSp(k === 'report' ? { tab: 'report' } : {}, { replace: true })}
        tabs={[['roster', 'Weeks'], ['report', 'Daily duty reports']]} />
      {tab === 'roster' ? <Roster /> : <Reports />}
    </>
  );
}

function Roster() {
  const school = useSchool();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [appoint, setAppoint] = useState(null);
  const load = useCallback(() => { if (school) api.get(`/duty/roster?school=${school}`).then((x) => { setD({ school, ...x }); setError(''); }).catch((e) => setError(e.message)); }, [school]);
  useEffect(() => { load(); }, [load]);
  useLive(['duty'], load);
  const remove = async (t, w) => {
    try { await api.post(`/duty/roster/${t.id}/remove`); toast(`${t.name} removed from the week of ${dm(w.weekStart)}`); load(); } catch (e) { setError(e.message); }
  };
  if (!school) return <Panel>Choose a school at the top of the page.</Panel>;
  if (!d || d.school !== school) return <><ErrorNote error={error} /><SkeletonTable rows={6} columns={3} /></>;
  const weeks = d.weeks.filter((w) => w.weekStart >= d.thisWeek || w.teachers.length);
  const cur = d.weeks.find((w) => w.current);
  return (
    <>
      <ErrorNote error={error} />
      {d.meOnDuty && <div className="warnnote info"><Icon name="shield" /><span><b>You are Teacher on Duty this week.</b> <Link to="/rollcall">Take the roll call</Link> · <Link to="/duty?tab=report">Write today's report</Link></span></div>}
      <Panel title="This week" sub={`${dm(cur.weekStart)} – ${dm(cur.weekEnd)}`}
        right={d.canEdit && <button className="btn sm p" onClick={() => setAppoint({ weekStart: cur.weekStart })}><Icon name="plus" /> Appoint</button>}>
        {cur.teachers.length ? <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>{cur.teachers.map((t) => <Person key={t.id} t={t} big onRemove={d.canEdit ? () => remove(t, cur) : null} />)}</div>
          : <Empty icon="shield" title="No Teacher on Duty this week">{d.canEdit ? 'Press Appoint and choose the teachers.' : 'The Second Master appoints the Teacher on Duty.'}</Empty>}
      </Panel>
      <Panel title="All weeks" flush>
        <div className="tw tw-full"><table className="stafftable">
          <thead><tr><th>Week</th><th>Teacher(s) on Duty</th><th>Appointed by</th>{d.canEdit && <th />}</tr></thead>
          <tbody>{weeks.map((w) => {
            const past = w.weekStart < d.thisWeek;
            return (
              <tr key={w.weekStart} className={w.current ? 'on' : past ? 'off' : ''}>
                <td className="nowrap"><b>{dm(w.weekStart)} – {dm(w.weekEnd)}</b>{w.current && <span className="pill sm ok">This week</span>}</td>
                <td>{w.teachers.length ? <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{w.teachers.map((t) => <Person key={t.id} t={t} onRemove={d.canEdit && !past ? () => remove(t, w) : null} />)}</div>
                  : <span className={past ? 'muted' : 'pill sm warn'}>{past ? 'Nobody' : 'Not appointed'}</span>}</td>
                <td className="small muted">{[...new Set(w.teachers.map((t) => t.appointedBy))].join(', ')}</td>
                {d.canEdit && <td className="acts-cell">{!past && <button className="btn sm" onClick={() => setAppoint({ weekStart: w.weekStart })}><Icon name="plus" /> Appoint</button>}</td>}
              </tr>
            );
          })}</tbody>
        </table></div>
      </Panel>
      {appoint && <AppointForm d={d} weekStart={appoint.weekStart} onClose={() => setAppoint(null)} onSaved={(n) => { setAppoint(null); toast(n ? `${n} teacher${n === 1 ? '' : 's'} appointed` : 'Already appointed'); load(); }} />}
    </>
  );
}

function Person({ t, big, onRemove }) {
  return (
    <span className={`chip${big ? ' big' : ''}`} title={t.note || ''}>
      <b>{t.name}</b>{t.note && <span className="muted"> · {t.note}</span>}
      {onRemove && <button type="button" className="chip-x" aria-label={`Remove ${t.name}`} onClick={onRemove}><Icon name="x" /></button>}
    </span>
  );
}

function AppointForm({ d, weekStart, onClose, onSaved }) {
  const [week, setWeek] = useState(weekStart);
  const [ids, setIds] = useState([]);
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const w = d.weeks.find((x) => x.weekStart === week);
  const already = new Set((w?.teachers || []).map((t) => t.userId));
  const list = d.teachers.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await api.post('/duty/roster', { weekStart: week, userIds: ids, note }); onSaved(r.added); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title="Appoint Teacher on Duty" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" form="dutyform" disabled={busy || !ids.length}>{busy ? 'Saving…' : `Appoint ${ids.length || ''}`}</button></>}>
      <form id="dutyform" className="stack" onSubmit={save}>
        <label>Week<select value={week} onChange={(e) => { setWeek(e.target.value); setIds([]); }}>
          {d.weeks.filter((x) => x.weekStart >= d.thisWeek).map((x) => <option key={x.weekStart} value={x.weekStart}>{dm(x.weekStart)} – {dm(x.weekEnd)}{x.current ? ' (this week)' : ''}{x.teachers.length ? ` · ${x.teachers.length} already` : ''}</option>)}
        </select></label>
        <label>Teachers (up to 6)<input type="search" placeholder="Find a teacher" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="list" style={{ maxHeight: 260, overflow: 'auto' }}>{list.map((t) => (
          <label key={t.id} className="checkline li">
            <input type="checkbox" disabled={already.has(t.id)} checked={already.has(t.id) || ids.includes(t.id)}
              onChange={(e) => setIds((x) => (e.target.checked ? [...x, t.id].slice(0, 6) : x.filter((i) => i !== t.id)))} />
            <span className="grow">{t.name} <span className="muted small">{t.role}{already.has(t.id) ? ' · already on duty' : ''}</span></span>
          </label>
        ))}{!list.length && <Empty>No teacher matches.</Empty>}</div>
        <label>Note (optional)<input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Main TOD, Boarding side" /></label>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function Reports() {
  const school = useSchool();
  const { user } = useAuth();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(null);
  const load = useCallback(() => { if (school) api.get(`/duty/reports?school=${school}`).then((x) => {
    setD({ school, ...x }); setError('');
    const mine = x.reports.find((r) => r.day === x.today && r.writerId === user.id);
    setF(mine?.fields || {});
  }).catch((e) => setError(e.message)); }, [school, user.id]);
  useEffect(() => { load(); }, [load]);
  useLive(['duty'], load);
  if (!school) return <Panel>Choose a school at the top of the page.</Panel>;
  if (!d || d.school !== school) return <><ErrorNote error={error} /><SkeletonTable rows={5} columns={3} /></>;
  const mine = d.reports.find((r) => r.day === d.today && r.writerId === user.id);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.put('/duty/reports', { day: d.today, fields: f }); toast('Duty report saved'); load(); } catch (err) { setError(err.message); }
    setBusy(false);
  };
  return (
    <>
      <ErrorNote error={error} />
      {d.canWrite && (
        <Panel title={`Today's duty report · ${dm(d.today)}`} sub={mine?.seenAt ? 'Read by the Second Master: it can no longer be changed.' : mine ? 'Saved. You can change it until it is read.' : 'Write what happened today. Leave empty what does not apply.'}>
          <form className="stack" onSubmit={save}>
            <div className="fg">{FIELDS.map(([k, l]) => (
              <label key={k}>{l}<textarea rows={2} maxLength={2000} value={f[k] || ''} disabled={!!mine?.seenAt} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} /></label>
            ))}</div>
            {!mine?.seenAt && <div><button className="btn p" disabled={busy}>{busy ? 'Saving…' : mine ? 'Save changes' : 'Save report'}</button></div>}
          </form>
        </Panel>
      )}
      <Panel title="Reports of the last 14 days" flush>
        {!d.reports.length ? <Empty icon="file" title="No duty reports yet">The Teacher on Duty writes one each day on this page.</Empty> : (
          <div className="list">{d.reports.map((r) => (
            <details key={r.id} className="li duty-rep">
              <summary><span className="grow"><b>{dm(r.day)}</b> · {r.writer}</span>
                {r.seenAt ? <span className="pill sm ok">Read by {r.seenBy}</span> : <span className="pill sm warn">Not read</span>}</summary>
              <dl>{FIELDS.filter(([k]) => r.fields[k]).map(([k, l]) => <div key={k}><dt>{l}</dt><dd>{r.fields[k]}</dd></div>)}</dl>
              {r.seenNote && <p className="small"><b>{r.seenBy}:</b> {r.seenNote}</p>}
              {d.canSee && !r.seenAt && <button className="btn sm p" onClick={() => setSeen(r)}><Icon name="check" /> Mark as read</button>}
            </details>
          ))}</div>
        )}
      </Panel>
      {seen && <SeenForm r={seen} onClose={() => setSeen(null)} onSaved={() => { setSeen(null); toast('Marked as read'); load(); }} />}
    </>
  );
}

function SeenForm({ r, onClose, onSaved }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const save = async () => { try { await api.post(`/duty/reports/${r.id}/seen`, { note }); onSaved(); } catch (e) { setError(e.message); } };
  return (
    <Modal title={`Read: duty report ${dm(r.day)}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" onClick={save}>Mark as read</button></>}>
      <div className="stack"><label>Comment for {r.writer} (optional)<textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label><ErrorNote error={error} /></div>
    </Modal>
  );
}
