// Academic progress (2026-11-24): the whole school's teaching from the start of the term, and each teacher's work.
// Academic Master / Mistress writes (tests for the whole school); Head Master, offices and HR look.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useLive } from '../live';
import { useAuth } from '../auth/AuthContext';
import { useSchools, useScope } from '../layout/scope';
import { Empty, ErrorNote, Icon, Kpi, Modal, PageHead, Panel, useToast, fmtWhen } from './../components/ui';
import { Bar } from './MyTeaching';

const dayText = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—');

function useSchoolParam() {
  const { user } = useAuth();
  const schools = useSchools();
  const [scope] = useScope();
  return user.scope === 'all' ? `?school=${scope || schools[0]?.id || ''}` : '';
}

function TeacherDetail({ t, qs, onClose }) {
  const [x, setX] = useState(null);
  useEffect(() => { api.get(`/teaching/oversight/teacher/${t.id}${qs}`).then(setX).catch(() => setX({ error: true })); }, [t.id, qs]);
  return (
    <Modal title={`${t.name} — work in the term`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      {!x ? <p className="muted">Loading…</p> : x.error ? <Empty>Could not open.</Empty> : (
        <>
          <h4 style={{ margin: '0 0 6px' }}>Syllabus by class</h4>
          <div className="tw"><table><thead><tr><th>Class</th><th>Subject</th><th>Done</th></tr></thead>
            <tbody>{x.assignments.map((a) => <tr key={a.className + a.subject}><td>{a.className}</td><td>{a.subject}</td><td><div className="row" style={{ gap: 8 }}><Bar pct={a.percent} /><span className="small">{a.topicsDone}/{a.topics}</span></div></td></tr>)}</tbody></table></div>
          <h4 style={{ margin: '14px 0 6px' }}>Lessons written (latest first)</h4>
          {!x.lessons.length ? <Empty>No lesson written this term.</Empty> : (
            <div className="tw"><table><thead><tr><th>Day</th><th>Class</th><th>Subject</th><th>What</th><th>Topic / notes</th></tr></thead>
              <tbody>{x.lessons.map((l) => <tr key={l.id}><td>{dayText(l.day)}</td><td>{l.className}</td><td>{l.subject}</td><td>{l.kindLabel}{l.done ? ' · done' : ''}</td><td>{l.absentReason || l.topic || l.title || '—'}</td></tr>)}</tbody></table></div>
          )}
        </>
      )}
    </Modal>
  );
}

function TestForm({ levels, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ level: levels[0] || '', title: '', day: '', note: '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    try { await api.post('/teaching/tests', f); toast('Test decided for the whole class level'); onSaved(); } catch (err) { toast(err.message); }
  };
  return (
    <Modal title="Decide a test for the whole school" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" form="test-form">Save test</button></>}>
      <form id="test-form" className="stack" onSubmit={submit}>
        <label>Class level (all streams sit the same test)<select required value={f.level} onChange={(e) => set('level', e.target.value)}>{levels.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
        <label>Name of the test<input required value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Mathematics monthly test" /></label>
        <label>Day<input type="date" required value={f.day} onChange={(e) => set('day', e.target.value)} /></label>
        <label>Note for teachers<input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="optional" /></label>
      </form>
    </Modal>
  );
}

function Tests({ qs }) {
  const [x, setX] = useState(null);
  const [add, setAdd] = useState(false);
  const toast = useToast();
  const load = useCallback(() => api.get(`/teaching/tests${qs}`).then(setX).catch((e) => toast(e.message)), [qs, toast]);
  useEffect(() => { load(); }, [load]);
  useLive(['teaching'], load);
  const cancel = async (t) => { try { await api.post(`/teaching/tests/${t.id}/cancel`); toast('Test cancelled'); load(); } catch (e) { toast(e.message); } };
  if (!x) return <Panel><p className="muted" style={{ margin: 0 }}>Loading…</p></Panel>;
  return (
    <Panel title="Tests for the whole school" sub="One test for a class level; every stream of it sits it. Teachers see it on their page." right={x.canWrite && <button className="btn p" onClick={() => setAdd(true)}><Icon name="plus" />New test</button>}>
      {!x.tests.length ? <Empty>No test decided yet.</Empty> : (
        <div className="tw"><table><thead><tr><th>Day</th><th>Test</th><th>Level</th><th>Streams</th><th>Subject</th><th>Lessons written</th><th /></tr></thead>
          <tbody>{x.tests.map((t) => <tr key={t.id}><td>{dayText(t.day)}</td><td>{t.title}{!t.active && <span className="pill bad" style={{ marginLeft: 6 }}>Cancelled</span>}</td><td>{t.level}</td><td>{t.classes.join(', ')}</td><td>{t.subject}</td><td className="n">{t.written}</td>
            <td>{x.canWrite && t.active && <button className="btn sm" onClick={() => cancel(t)}>Cancel</button>}</td></tr>)}</tbody></table></div>
      )}
      {add && <TestForm levels={x.levels} onClose={() => setAdd(false)} onSaved={() => { setAdd(false); load(); }} />}
    </Panel>
  );
}

// The summary used by the Academic Master's home too.
export function ProgressView({ qs, tab }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api.get(`/teaching/oversight${qs}`).then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message)), [qs]);
  useEffect(() => { load(); }, [load]);
  useLive(['teaching', 'academic', 'class'], load);
  if (error) return <ErrorNote error={error} />;
  if (!d) return <Panel><p className="muted" style={{ margin: 0 }}>Loading…</p></Panel>;
  const T = d.totals;
  return (
    <>
      <Panel><p className="small muted" style={{ margin: 0 }}>Term {d.term.term}, {d.term.year}{d.term.opensOn ? ` · ${dayText(d.term.opensOn)} to ${dayText(d.term.closesOn)}` : ' · the Head Master has not written the term dates yet (School calendar)'}.</p></Panel>
      <div className="kpis">
        <Kpi tone="hi" label="Teachers" value={T.teachers} />
        <Kpi tone={T.compliance == null ? '' : T.compliance >= 80 ? 'ok' : 'warn'} label="Lessons written" value={T.compliance == null ? '—' : `${T.compliance}%`} sub={`${T.written} of ${T.expected} on the timetable`} />
        <Kpi label="Syllabus covered" value={T.coverage == null ? '—' : `${T.coverage}%`} />
        <Kpi tone={T.flagged ? 'warn' : 'ok'} label="Teachers to follow up" value={T.flagged} sub={`${T.absences} absences written`} />
      </div>
      {tab === 'teachers' && (
        <Panel title="Teachers: work and conduct" sub="Lessons written against the timetable, absences, syllabus covered and duty weeks">
          {!d.teachers.length ? <Empty>No teacher has a subject yet.</Empty> : (
            <div className="tw"><table><thead><tr><th>Teacher</th><th>Post</th><th className="n">Classes</th><th>Lessons written</th><th className="n">Absent</th><th>Syllabus</th><th className="n">Duty weeks</th><th>Last written</th><th>Follow up</th></tr></thead>
              <tbody>{d.teachers.map((t) => (
                <tr key={t.id} onClick={() => setOpen(t)} style={{ cursor: 'pointer' }}><td><b>{t.name}</b></td><td>{t.role}</td><td className="n">{t.classes}</td>
                  <td><div className="row" style={{ gap: 8 }}><Bar pct={t.compliance} /><span className="small">{t.written}/{t.expected}</span></div></td>
                  <td className="n" title={t.absentReasons.join('\n')}>{t.absent}</td>
                  <td><div className="row" style={{ gap: 8 }}><Bar pct={t.coverage} /><span className="small">{t.topicsDone}/{t.topics}</span></div></td>
                  <td className="n">{t.dutyWeeks}</td><td>{t.lastWritten ? fmtWhen(t.lastWritten) : '—'}</td>
                  <td>{t.flags.map((f) => <span key={f} className="pill warn" style={{ marginRight: 4 }}>{f}</span>)}</td></tr>
              ))}</tbody></table></div>
          )}
        </Panel>
      )}
      {tab === 'classes' && (
        <Panel title="Syllabus by class and subject" sub="From the first day of the term to today">
          {!d.classes.length ? <Empty>No subject has a teacher yet.</Empty> : (
            <div className="tw"><table><thead><tr><th>Class</th><th>Subject</th><th>Teacher</th><th>Topics done</th><th className="n">Lessons</th><th>Last lesson</th></tr></thead>
              <tbody>{d.classes.map((c) => <tr key={`${c.classId}${c.subject}`}><td>{c.className}</td><td>{c.subject}</td><td>{c.teacher}</td>
                <td><div className="row" style={{ gap: 8 }}><Bar pct={c.percent} /><span className="small">{c.topicsDone}/{c.topics}</span></div></td><td className="n">{c.lessons}</td><td>{dayText(c.last)}</td></tr>)}</tbody></table></div>
          )}
        </Panel>
      )}
      {tab === 'weeks' && (
        <Panel title="Lessons written each week" sub="From the start of the term">
          {!d.weeks.length ? <Empty>Nothing written yet.</Empty> : <div className="tw"><table><thead><tr><th>Week of</th><th className="n">Lessons written</th></tr></thead><tbody>{d.weeks.map((w) => <tr key={w.week}><td>{dayText(w.week)}</td><td className="n">{w.n}</td></tr>)}</tbody></table></div>}
        </Panel>
      )}
      {open && <TeacherDetail t={open} qs={qs} onClose={() => setOpen(null)} />}
    </>
  );
}

export default function AcademicProgress() {
  const qs = useSchoolParam();
  const [tab, setTab] = useState('teachers');
  return (
    <>
      <PageHead title="Academic progress" sub="The school's teaching from the start of the term: syllabus, lessons written, tests, and each teacher's work.">
        <div className="seg">{[['teachers', 'Teachers'], ['classes', 'Classes & syllabus'], ['weeks', 'Week by week'], ['tests', 'School tests']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      </PageHead>
      {tab === 'tests' ? <Tests qs={qs} /> : <ProgressView qs={qs} tab={tab} />}
    </>
  );
}
