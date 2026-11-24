// School calendar (2026-11-24): the Head Master writes the terms, declares holidays, and makes the program for the classes that stay.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useLive } from '../live';
import { useAuth } from '../auth/AuthContext';
import { useSchools } from '../layout/scope';
import { Empty, ErrorNote, Loading, Modal, PageHead, Panel, Tabs, useToast } from '../components/ui';

const NATIONAL_2027 = {
  1: { opensOn: '2027-01-11', breakFrom: '2027-03-25', breakTo: '2027-04-05', closesOn: '2027-06-08', studyDays: '95' },
  2: { opensOn: '2027-07-12', breakFrom: '2027-09-10', breakTo: '2027-09-20', closesOn: '2027-12-03', studyDays: '99' },
};
const dshow = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const LEVELS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6'];

export default function Calendar() {
  const toast = useToast();
  const { user } = useAuth();
  const schools = useSchools();
  const admin = !user.school?.id;
  const [school, setSchool] = useState(user.school?.id ? String(user.school.id) : '');
  const [year, setYear] = useState(2027);
  const [tab, setTab] = useState('terms');
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);   // holiday id
  const [declare, setDeclare] = useState(false);
  useEffect(() => { if (admin && !school && schools.length) setSchool(String(schools[0].id)); }, [admin, school, schools]);
  const load = useCallback(() => (school || !admin) ? api.get(`/calendar?year=${year}${school ? `&school=${school}` : ''}`).then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message)) : null, [school, year, admin]);
  useEffect(() => { load(); }, [load]);
  useLive(['calendar'], load);
  const term = (n) => d?.terms.find((t) => t.term === n);
  return (
    <>
      <PageHead title="School calendar" sub="The Head Master writes the terms, declares a holiday, and makes the program for the classes that stay at school.">
        {admin && <select value={school} onChange={(e) => setSchool(e.target.value)} aria-label="School">{schools.map((s) => <option key={s.id} value={s.id}>{s.shortName}</option>)}</select>}
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">{[2026, 2027, 2028].map((y) => <option key={y}>{y}</option>)}</select>
      </PageHead>
      <ErrorNote error={error} />
      <Tabs tabs={[['terms', 'Terms'], ['holidays', 'Holidays and program']]} value={tab} onChange={setTab} />
      {!d ? <Loading /> : tab === 'terms' ? (
        <div className="stack">
          {[1, 2].map((n) => <TermCard key={`${year}-${n}-${term(n)?.opensOn}`} n={n} year={year} school={school} t={term(n)} canWrite={d.canWrite} onSaved={() => { load(); toast(`Term ${n} saved`); }} />)}
          <p className="small muted">Study days are counted by the Ministry of Education. In 2027 the national calendar has 2 terms and 194 study days.</p>
        </div>
      ) : (
        <Panel flush title="Holidays" right={d.canWrite && <button className="btn p" onClick={() => setDeclare(true)}>Declare a holiday</button>}>
          {!d.holidays.length ? <Empty icon="file" title="No holiday declared" steps={['Declare the holiday (first and last day).', 'Choose the classes that stay at school.', 'Make their program, then publish it.']} /> : (
            <div className="tw"><table className="stafftable"><thead><tr><th>Holiday</th><th>From</th><th>To</th><th>Stay at school</th><th>Program</th><th /></tr></thead>
              <tbody>{d.holidays.map((h) => (
                <tr key={h.id} onClick={() => setOpen(h.id)} style={{ cursor: 'pointer' }}><td><b>{h.name}</b></td><td>{dshow(h.fromDate)}</td><td>{dshow(h.toDate)}</td>
                  <td className="small">{h.classes.length ? h.classes.join(', ') : '—'}</td><td>{h.programStatus ? <span className={`pill ${h.programStatus === 'published' ? 'ok' : 'warn'}`}>{h.programStatus}</span> : <span className="pill">none</span>}</td><td><button className="btn sm">Open</button></td></tr>))}</tbody></table></div>)}
        </Panel>
      )}
      {declare && <DeclareModal school={school} year={year} onClose={() => setDeclare(false)} onDone={(id) => { setDeclare(false); load(); setOpen(id); }} />}
      {open && <HolidayModal id={open} onClose={() => { setOpen(null); load(); }} toast={toast} />}
    </>
  );
}

function TermCard({ n, year, school, t, canWrite, onSaved }) {
  const [f, setF] = useState({ opensOn: t?.opensOn || '', closesOn: t?.closesOn || '', breakFrom: t?.breakFrom || '', breakTo: t?.breakTo || '', studyDays: t?.studyDays ?? '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => api.post('/calendar/terms', { schoolId: school, year, term: n, ...f }).then(onSaved).catch((e) => setError(e.message));
  return (
    <Panel title={`Term ${n} · ${year}`} right={canWrite && year === 2027 && !t && <button className="btn sm" onClick={() => setF(NATIONAL_2027[n])}>Fill from the national calendar</button>}>
      <div className="fg">
        <label>Opens<input type="date" value={f.opensOn} onChange={set('opensOn')} disabled={!canWrite} /></label>
        <label>Closes<input type="date" value={f.closesOn} onChange={set('closesOn')} disabled={!canWrite} /></label>
        <label>Short break from<input type="date" value={f.breakFrom} onChange={set('breakFrom')} disabled={!canWrite} /></label>
        <label>Short break to<input type="date" value={f.breakTo} onChange={set('breakTo')} disabled={!canWrite} /></label>
        <label>Study days<input type="number" min="1" max="300" value={f.studyDays} onChange={set('studyDays')} disabled={!canWrite} /></label>
      </div>
      <ErrorNote error={error} />
      {canWrite && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><button className="btn p" onClick={save}>Save term {n}</button></div>}
    </Panel>
  );
}

function DeclareModal({ school, year, onClose, onDone }) {
  const [f, setF] = useState({ name: 'June holiday', fromDate: '', toDate: '' });
  const [error, setError] = useState('');
  const go = () => api.post('/calendar/holidays', { schoolId: school, ...f }).then((r) => onDone(r.id)).catch((e) => setError(e.message));
  return (
    <Modal title="Declare a holiday" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" onClick={go}>Declare</button></>}>
      <p className="small muted" style={{ marginTop: 0 }}>The year is {year}. After this you choose the classes that stay and make their program.</p>
      <div className="fg">
        <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>First day<input type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} /></label>
        <label>Last day<input type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></label>
      </div>
      <ErrorNote error={error} />
    </Modal>
  );
}

function HolidayModal({ id, onClose, toast }) {
  const [g, setG] = useState(null);
  const [error, setError] = useState('');
  const [levels, setLevels] = useState(['P4', 'P5', 'P6', 'P7']);
  const [it, setIt] = useState({ day: '', start: '08:00', end: '10:00', activity: '', place: '', classId: '' });
  const load = useCallback(() => api.get(`/calendar/holidays/${id}`).then((x) => { setG(x); setError(''); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  const run = (p) => p.then(() => load()).catch((e) => setError(e.message));
  if (!g) return <Modal title="Holiday" onClose={onClose}>{error ? <ErrorNote error={error} /> : <Loading />}</Modal>;
  const draft = g.program?.status === 'draft', pub = g.program?.status === 'published', w = g.canWrite;
  return (
    <Modal wide title={`${g.holiday.name} · ${dshow(g.holiday.fromDate)} to ${dshow(g.holiday.toDate)}`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <ErrorNote error={error} />
      {!g.program && w && (
        <div className="stack">
          <b>Which classes stay at school?</b>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>{LEVELS.map((l) => <label key={l} className="small"><input type="checkbox" checked={levels.includes(l)} onChange={(e) => setLevels(e.target.checked ? [...levels, l] : levels.filter((x) => x !== l))} /> {l}</label>)}</div>
          <div><button className="btn p" onClick={() => run(api.put(`/calendar/holidays/${id}/program`, { levels }))}>Open the program</button></div>
        </div>)}
      {!g.program && !w && <p className="small muted">No program yet.</p>}
      {g.program && <>
        <p><span className={`pill ${pub ? 'ok' : 'warn'}`}>{g.program.status}</span> Staying: <b>{g.classes.map((c) => c.name).join(', ')}</b>{g.students != null && <> · <b>{g.students}</b> pupils</>}</p>
        <div className="tw"><table className="stafftable"><thead><tr><th>Day</th><th>Time</th><th>Activity</th><th>Class</th><th>Place</th><th /></tr></thead>
          <tbody>{g.items.map((i) => <tr key={i.id}><td>{dshow(i.day)}</td><td>{i.start}–{i.end}</td><td><b>{i.activity}</b></td><td>{i.className}</td><td>{i.place || ''}</td>
            <td>{draft && w && <button className="btn sm" onClick={() => run(api.post(`/calendar/holidays/${id}/items/${i.id}/remove`))}>Remove</button>}</td></tr>)}
            {!g.items.length && <tr><td colSpan={6} className="small muted">No activity yet.</td></tr>}</tbody></table></div>
        {draft && w && <div className="stack" style={{ marginTop: 12 }}>
          <b>Add an activity</b>
          <div className="fg">
            <label>Day<input type="date" min={g.holiday.fromDate} max={g.holiday.toDate} value={it.day} onChange={(e) => setIt({ ...it, day: e.target.value })} /></label>
            <label>From<input type="time" value={it.start} onChange={(e) => setIt({ ...it, start: e.target.value })} /></label>
            <label>To<input type="time" value={it.end} onChange={(e) => setIt({ ...it, end: e.target.value })} /></label>
            <label>Activity<input value={it.activity} onChange={(e) => setIt({ ...it, activity: e.target.value })} placeholder="e.g. Mathematics revision" /></label>
            <label>Class<select value={it.classId} onChange={(e) => setIt({ ...it, classId: e.target.value })}><option value="">All who stay</option>{g.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Place<input value={it.place} onChange={(e) => setIt({ ...it, place: e.target.value })} /></label>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={() => run(api.post(`/calendar/holidays/${id}/items`, it).then(() => setIt({ ...it, activity: '' })))}>Add</button>
            <button className="btn p" onClick={() => run(api.post(`/calendar/holidays/${id}/publish`).then(() => toast('Program published')))}>Publish the program</button>
          </div>
        </div>}
      </>}
    </Modal>
  );
}
