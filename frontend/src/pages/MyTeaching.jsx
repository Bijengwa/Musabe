// My teaching (2026-11-24): the working page of a teacher. Only the classes, subjects and students given to this person.
// Whoever holds a post (Academic, Discipline, Second Master) and still teaches uses the same page.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { useAuth } from '../auth/AuthContext';
import { Empty, ErrorNote, Icon, Kpi, Modal, PageHead, Panel, useToast } from '../components/ui';

export const Bar = ({ pct, tone }) => (
  <div style={{ background: 'var(--line, #e5e7eb)', borderRadius: 6, height: 8, minWidth: 80 }} title={pct == null ? 'No syllabus loaded' : `${pct}%`}>
    <div style={{ width: `${pct || 0}%`, height: 8, borderRadius: 6, background: tone || (pct >= 70 ? 'var(--ok, #16a34a)' : pct >= 40 ? 'var(--warn, #d97706)' : 'var(--bad, #dc2626)') }} />
  </div>
);
const dayText = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—');

export function useMyTeaching() {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get('/teaching/me').then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useLive(['teaching', 'academic', 'class'], load);
  return { d, error, load };
}

// ---------- write what was done in a lesson ----------
export function LessonForm({ d, preset, onClose, onSaved }) {
  const toast = useToast();
  const first = preset || d.assignments[0] || {};
  const [f, setF] = useState({ classId: first.classId || '', subjectId: first.subjectId || '', day: preset?.day || d.today, period: preset?.period || '', kind: 'taught', topicId: '', topicDone: false, title: '', understanding: '', absentReason: '', schoolTestId: '' });
  const [topics, setTopics] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const pairKey = (a) => `${a.classId}:${a.subjectId}`;
  useEffect(() => {
    if (!f.classId || !f.subjectId) return;
    api.get(`/teaching/class/${f.classId}/subject/${f.subjectId}`).then((x) => setTopics(x.topics || [])).catch(() => setTopics([]));
  }, [f.classId, f.subjectId]);
  const absent = f.kind === 'absent';
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await api.post('/teaching/lessons', { ...f, classId: Number(f.classId), subjectId: Number(f.subjectId), period: f.period ? Number(f.period) : null, topicId: f.topicId ? Number(f.topicId) : null,
        understanding: f.understanding === '' ? null : Number(f.understanding), schoolTestId: f.schoolTestId ? Number(f.schoolTestId) : null });
      toast('Lesson saved'); onSaved();
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="What did you do in this lesson?" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" form="lesson-form" disabled={busy}>Save lesson</button></>}>
      <form id="lesson-form" className="stack" onSubmit={submit}>
        <div className="fg">
          <label>Class and subject
            <select required value={f.classId && f.subjectId ? `${f.classId}:${f.subjectId}` : ''} onChange={(e) => { const [c, s] = e.target.value.split(':'); setF((x) => ({ ...x, classId: c, subjectId: s, topicId: '', topicDone: false })); }}>
              <option value="">Choose</option>
              {d.assignments.map((a) => <option key={pairKey(a)} value={pairKey(a)}>{a.className} · {a.subject}</option>)}
            </select>
          </label>
          <label>Day<input type="date" required value={f.day} max={d.today} onChange={(e) => set('day', e.target.value)} /></label>
          <label>Period<input type="number" min="1" max="12" value={f.period} onChange={(e) => set('period', e.target.value)} placeholder="optional" /></label>
        </div>
        <label>What happened?
          <select required value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            {Object.entries(d.kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {absent ? (
          <label>Why were you absent?<input required value={f.absentReason} onChange={(e) => set('absentReason', e.target.value)} placeholder="Sick, permission, meeting ..." /></label>
        ) : (
          <>
            <label>Syllabus topic
              <select value={f.topicId} onChange={(e) => set('topicId', e.target.value)}>
                <option value="">— none / my own topic —</option>
                {topics.map((t) => <option key={t.id} value={t.id}>{t.done ? '✓ ' : ''}{t.no ? `${t.no} ` : ''}{t.text.slice(0, 90)}</option>)}
              </select>
            </label>
            <label>In your words<input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Addition with carrying, page 24" /></label>
            <div className="fg">
              <label>How well did the class understand? (0–100)<input type="number" min="0" max="100" value={f.understanding} onChange={(e) => set('understanding', e.target.value)} /></label>
              {f.kind === 'test' && d.tests.length > 0 && (
                <label>School test<select value={f.schoolTestId} onChange={(e) => set('schoolTestId', e.target.value)}><option value="">— not a school test —</option>{d.tests.map((t) => <option key={t.id} value={t.id}>{t.title} ({dayText(t.day)})</option>)}</select></label>
              )}
            </div>
            <label className="row" style={{ gap: 8 }}><input type="checkbox" disabled={!f.topicId} checked={f.topicDone} onChange={(e) => set('topicDone', e.target.checked)} /> This topic is finished (mark it done)</label>
          </>
        )}
      </form>
    </Modal>
  );
}

// ---------- one class + subject: my students and the syllabus ----------
function ClassDetail({ a, onClose, onWrite }) {
  const [x, setX] = useState(null);
  const [tab, setTab] = useState('topics');
  useEffect(() => { api.get(`/teaching/class/${a.classId}/subject/${a.subjectId}`).then(setX).catch(() => setX({ error: true })); }, [a]);
  return (
    <Modal title={`${a.className} · ${a.subject}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn p" onClick={onWrite}>Write a lesson</button></>}>
      {!x ? <p className="muted">Loading…</p> : x.error ? <Empty>This class could not be opened.</Empty> : (
        <>
          <div className="seg" style={{ marginBottom: 10 }}>{[['topics', `Syllabus (${x.done}/${x.total})`], ['students', `My students (${x.students.length})`], ['lessons', 'Lessons written']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
          {tab === 'topics' && (!x.topics.length ? <Empty>No syllabus is loaded for this subject yet.</Empty> : (
            <div className="tw"><table><thead><tr><th>No.</th><th>Topic</th><th>Periods</th><th>Done</th></tr></thead>
              <tbody>{x.topics.map((t) => <tr key={t.id}><td>{t.no || ''}</td><td>{t.text}</td><td className="n">{t.periods || ''}</td><td>{t.done ? <span className="pill ok">Done</span> : ''}</td></tr>)}</tbody></table></div>
          ))}
          {tab === 'students' && (
            <div className="tw"><table><thead><tr><th>S/N</th><th>Admission no.</th><th>Name</th><th>Sex</th></tr></thead>
              <tbody>{x.students.map((s, i) => <tr key={s.id}><td>{i + 1}</td><td>{s.admission_no}</td><td>{s.full_name}</td><td>{s.sex}</td></tr>)}</tbody></table></div>
          )}
          {tab === 'lessons' && (!x.lessons.length ? <Empty>No lesson written yet.</Empty> : (
            <div className="tw"><table><thead><tr><th>Day</th><th>What</th><th>Topic / notes</th></tr></thead>
              <tbody>{x.lessons.map((l) => <tr key={l.id}><td>{dayText(l.day)}</td><td>{l.kindLabel}{l.done ? ' · topic done' : ''}</td><td>{l.absentReason || l.topic || l.title || '—'}</td></tr>)}</tbody></table></div>
          ))}
        </>
      )}
    </Modal>
  );
}

// The home of a teacher (also used on the Home page).
export function TeacherHome({ compact }) {
  const { d, error, load } = useMyTeaching();
  const [write, setWrite] = useState(null);
  const [open, setOpen] = useState(null);
  if (error) return <ErrorNote error={error} />;
  if (!d) return <Panel><p className="muted" style={{ margin: 0 }}>Loading…</p></Panel>;
  const p = d.progress;
  return (
    <>
      {d.term.notOpen && <Panel><p className="small muted" style={{ margin: 0 }}>Term {d.term.term} opens on {dayText(d.term.opensOn)}.</p></Panel>}
      <div className="kpis">
        <Kpi tone="hi" label="My classes" value={d.classes.length} sub={`${d.assignments.length} subject${d.assignments.length === 1 ? '' : 's'}`} />
        <Kpi label="My students" value={d.classes.reduce((a, c) => a + c.students, 0)} />
        <Kpi tone={d.missing.length ? 'warn' : 'ok'} label="Lessons to write up" value={d.missing.length + d.todayLessons.filter((l) => !l.written).length} sub="today and last 7 days" />
        <Kpi label={`Term ${d.term.term} progress`} value={p.topics ? `${Math.round((p.topicsDone / p.topics) * 100)}%` : '—'} sub={`${p.topicsDone} of ${p.topics} topics done`} />
      </div>
      {d.tests.length > 0 && (
        <Panel title="School tests" sub="Decided by the Academic Master for the whole class level">
          {d.tests.map((t) => <p key={t.id} style={{ margin: '4px 0' }}><b>{t.title}</b> · {t.level} · {dayText(t.day)}{t.note ? ` · ${t.note}` : ''}</p>)}
        </Panel>
      )}
      <Panel title="Today's lessons" sub={dayText(d.today)} right={<button className="btn p" disabled={!d.assignments.length} onClick={() => setWrite({})}><Icon name="plus" />Write a lesson</button>}>
        {!d.todayLessons.length ? <p className="muted" style={{ margin: 0 }}>No lesson on your timetable today.</p> : (
          <div className="tw"><table><thead><tr><th>Period</th><th>Class</th><th>Subject</th><th>Room</th><th /></tr></thead>
            <tbody>{d.todayLessons.map((l) => (
              <tr key={`${l.classId}${l.subjectId}${l.period}`}><td>{l.period}</td><td>{l.className}</td><td>{l.subject}</td><td>{l.room || '—'}</td>
                <td>{l.written ? <span className="pill ok">Written</span> : <button className="btn sm p" onClick={() => setWrite(l)}>Write</button>}</td></tr>
            ))}</tbody></table></div>
        )}
      </Panel>
      {d.missing.length > 0 && (
        <Panel title="Lessons not written yet" sub="The Academic Master can see lessons that are not written">
          <div className="tw"><table><thead><tr><th>Day</th><th>Period</th><th>Class</th><th>Subject</th><th /></tr></thead>
            <tbody>{d.missing.map((l) => <tr key={`${l.day}${l.classId}${l.subjectId}${l.period}`}><td>{dayText(l.day)}</td><td>{l.period}</td><td>{l.className}</td><td>{l.subject}</td><td><button className="btn sm" onClick={() => setWrite(l)}>Write</button></td></tr>)}</tbody></table></div>
        </Panel>
      )}
      {!compact && (
        <>
          <Panel title="My classes and subjects" sub={`Term ${d.term.term}, ${d.term.year} — my own progress`}>
            {!d.assignments.length ? <Empty>No subject has been given to you yet. The Academic Master gives subjects to teachers.</Empty> : (
              <div className="tw"><table><thead><tr><th>Class</th><th>Subject</th><th className="n">Students</th><th>Syllabus done</th><th>Last lesson</th><th /></tr></thead>
                <tbody>{d.assignments.map((a) => (
                  <tr key={`${a.classId}:${a.subjectId}`}><td>{a.className}</td><td>{a.subject}</td><td className="n">{a.students}</td>
                    <td><div className="row" style={{ gap: 8 }}><Bar pct={a.percent} /><span className="small">{a.topicsDone}/{a.topics}</span></div></td>
                    <td>{dayText(a.lastLesson)}</td><td><button className="btn sm" onClick={() => setOpen(a)}>Open</button></td></tr>
                ))}</tbody></table></div>
            )}
          </Panel>
          {d.classes.length > 0 && (
            <Panel title="Who teaches my classes" sub="The other subjects of each class and their teachers">
              {d.classes.map((c) => (
                <div key={c.classId} style={{ marginBottom: 10 }}>
                  <b>{c.className}</b> <span className="muted small">· {c.students} students</span>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {c.team.map((t) => <span key={t.subject} className={`pill ${t.me ? 'ok' : ''}`}>{t.subject}: {t.me ? 'me' : t.teacher || 'no teacher'}</span>)}
                  </div>
                </div>
              ))}
            </Panel>
          )}
          <Panel title="My year so far" sub={`${p.lessons} lessons written in Term ${d.term.term}`}>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(p.byKind).map(([k, n]) => <span key={k} className="pill">{d.kinds[k]}: {n}</span>)}
              {!p.lessons && <span className="muted">No lesson written yet this term.</span>}
            </div>
            {p.months.length > 0 && <p className="small muted" style={{ marginBottom: 0 }}>{p.months.map((m) => `${m.month}: ${m.n}`).join(' · ')}</p>}
          </Panel>
        </>
      )}
      {compact && <p className="small"><Link to="/teaching">Open My teaching →</Link></p>}
      {write && <LessonForm d={d} preset={write.classId ? write : null} onClose={() => setWrite(null)} onSaved={() => { setWrite(null); load(); }} />}
      {open && <ClassDetail a={open} onClose={() => setOpen(null)} onWrite={() => { setWrite(open); setOpen(null); }} />}
    </>
  );
}

export default function MyTeaching() {
  const { user } = useAuth();
  return (
    <>
      <PageHead title="My teaching" sub={`${user.fullName || user.name || ''} — only the classes, subjects and students given to you. After every lesson, write what you did.`} />
      <TeacherHome />
    </>
  );
}
