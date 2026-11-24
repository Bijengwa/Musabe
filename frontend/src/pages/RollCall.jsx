// Roll call (2026-11-23). The Teacher on Duty of the week takes the roll call of every class stream:
// P present, A absent, L late, S sick, R permission (ruhusa). Morning for everyone; evening and night for boarding.
// The Second Master can also take or correct it. Head Master, Academic Master and others only look.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { useScope, useSchools } from '../layout/scope';
import { DetailSkeleton, Empty, ErrorNote, ExcelButton, Icon, Kpi, PageHead, Panel, SkeletonTable, useToast } from '../components/ui';
import { todayStr } from '../components/common';

const MARKS = [['P', 'Present'], ['A', 'Absent'], ['L', 'Late'], ['S', 'Sick'], ['R', 'Permission']];
const TONE = { P: 'ok', A: 'bad', L: 'warn', S: 'warn', R: '' };
const SESSIONS = [['morning', 'Morning'], ['evening', 'Evening'], ['night', 'Night']];

export default function RollCall() {
  return <Routes><Route index element={<Overview />} /><Route path="class/:id" element={<ClassSheet />} /><Route path="*" element={<Overview />} /></Routes>;
}

function useSchool() {
  const { user } = useAuth();
  const [scope] = useScope();
  const schools = useSchools();
  return user.scope === 'all' ? scope || String(schools[0]?.id || '') : String(user.school?.id || '');
}
function useDaySession() {
  const [sp, setSp] = useSearchParams();
  const day = sp.get('day') || todayStr();
  const session = sp.get('session') || 'morning';
  const set = (k, v) => { const n = new URLSearchParams(sp); n.set(k, v); setSp(n, { replace: true }); };
  return { day, session, setDay: (v) => set('day', v), setSession: (v) => set('session', v) };
}
const fmtDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dar_es_Salaam' }) : '');

function Overview() {
  const school = useSchool();
  const navigate = useNavigate();
  const { day, session, setDay, setSession } = useDaySession();
  const [d, setD] = useState(null);
  const [abs, setAbs] = useState(null);
  const [error, setError] = useState('');
  const qs = `school=${school}&day=${day}&session=${session}`;
  const load = useCallback(() => {
    if (!school) return;
    api.get(`/duty/rollcall?${qs}`).then((x) => { setD({ key: qs, ...x }); setError(''); }).catch((e) => setError(e.message));
    api.get(`/duty/absent?school=${school}&day=${day}`).then(setAbs).catch(() => setAbs(null));
  }, [qs, school, day]);
  useEffect(() => { load(); }, [load]);
  useLive(['rollcall', 'duty'], load);
  const tot = useMemo(() => {
    const t = { P: 0, A: 0, L: 0, S: 0, R: 0 };
    for (const c of d?.classes || []) for (const k of Object.keys(t)) t[k] += c.counts?.[k] || 0;
    return t;
  }, [d]);
  if (!school) return <><PageHead title="Roll call" /><Panel>Choose a school at the top of the page.</Panel></>;
  const ready = d && d.key === qs;
  const withKids = ready ? d.classes.filter((c) => c.students > 0) : [];
  const taken = withKids.filter((c) => c.taken).length;
  return (
    <>
      <PageHead title="Roll call" sub={ready ? <>{fmtDay(day)} · Teacher on Duty: {d.onDuty.length ? <b>{d.onDuty.join(', ')}</b> : <span className="pill warn">nobody appointed this week</span>}</> : fmtDay(day)}>
        <div className="seg" role="group" aria-label="Session">{SESSIONS.map(([k, l]) => <button key={k} type="button" className={session === k ? 'on' : ''} onClick={() => setSession(k)}>{l}</button>)}</div>
        <input type="date" value={day} max={todayStr()} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Day" style={{ width: 'auto' }} />
        <ExcelButton href={`/api/duty/rollcall/export.xlsx?school=${school}&day=${day}`} />
      </PageHead>
      <ErrorNote error={error} />
      {ready && !d.canTake && <p className="small muted" style={{ margin: 0 }}><Icon name="lock" /> {d.why}</p>}
      {ready && <div className="kpis">
        <Kpi tone={taken === withKids.length && withKids.length ? 'ok' : 'warn'} label="Classes done" value={`${taken} / ${withKids.length}`} />
        <Kpi tone="ok" label="Present" value={tot.P} />
        <Kpi tone={tot.A ? 'bad' : ''} label="Absent" value={tot.A} />
        <Kpi label="Late" value={tot.L} /><Kpi label="Sick" value={tot.S} /><Kpi label="Permission" value={tot.R} />
      </div>}
      <Panel title="Classes" flush>
        {!ready ? <SkeletonTable rows={8} columns={6} /> : !d.classes.length ? <Empty icon="grid" title="No classes yet">The Academic Master adds the class streams in Students → Classes.</Empty> : (
          <div className="tw tw-full"><table className="stafftable">
            <thead><tr><th>Class</th><th className="n">Students</th><th>Roll call</th>{MARKS.map(([k, l]) => <th key={k} className="n" title={l}>{k}</th>)}<th /></tr></thead>
            <tbody>{d.classes.map((c) => (
              <tr key={c.id} className="clickrow" tabIndex={0} onClick={() => navigate(`class/${c.id}?day=${day}&session=${session}`)}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`class/${c.id}?day=${day}&session=${session}`); }}>
                <td><b className="mono">{c.label}</b></td>
                <td className="n">{c.students}</td>
                <td>{c.taken ? <span className="pill sm ok">Done · {c.takenBy} {fmtTime(c.takenAt)}</span> : c.students ? <span className="pill sm warn">Not taken</span> : <span className="muted">No students</span>}</td>
                {MARKS.map(([k]) => <td key={k} className="n">{c.counts ? (c.counts[k] || <span className="muted">0</span>) : ''}</td>)}
                <td className="acts-cell"><span className="btn sm">{c.taken ? 'Open' : d.canTake ? 'Take roll call' : 'Open'}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {abs && (abs.list.length > 0 || abs.threeDays.length > 0) && (
        <div className="grid2">
          <Panel title={`Not present on ${day} (${abs.list.length})`} flush>
            {!abs.list.length ? <Empty>Everyone was present.</Empty> : <div className="tw"><table className="stafftable"><thead><tr><th>Student</th><th>Class</th><th>Mark</th><th>Note</th></tr></thead>
              <tbody>{abs.list.map((x, i) => <tr key={`${x.id}-${x.session}-${i}`}><td><Link to={`/students/${x.id}`}>{x.name}</Link></td><td className="mono">{x.className}</td>
                <td><span className={`pill sm ${TONE[x.status]}`}>{abs.statuses[x.status]}</span>{x.session !== 'morning' && <span className="pill sm">{abs.sessions[x.session]}</span>}</td><td>{x.note || ''}</td></tr>)}</tbody></table></div>}
          </Panel>
          <Panel title={`Absent 3 days in a row (${abs.threeDays.length})`} sub="Morning roll call, last 3 school days. Follow up with the parents." flush>
            {!abs.threeDays.length ? <Empty>Nobody.</Empty> : <div className="list">{abs.threeDays.map((x) => <Link key={x.id} className="li" to={`/students/${x.id}`}><span className="grow"><b>{x.name}</b><span>{x.className} · {x.admissionNo}</span></span><span className="pill bad">3 days</span></Link>)}</div>}
          </Panel>
        </div>
      )}
    </>
  );
}

function ClassSheet() {
  const { id } = useParams();
  const { day, session } = useDaySession();
  const toast = useToast();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [marks, setMarks] = useState({});
  const [notes, setNotes] = useState({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = `${id}|${day}|${session}`;
  const load = useCallback(() => api.get(`/duty/rollcall/class/${id}?day=${day}&session=${session}`).then((x) => {
    setD({ key, ...x }); setError('');
    setMarks(Object.fromEntries(x.students.filter((s) => s.status).map((s) => [s.id, s.status])));
    setNotes(Object.fromEntries(x.students.map((s) => [s.id, s.note || ''])));
    setNote(x.rollCall?.note || '');
  }).catch((e) => setError(e.message)), [id, day, session, key]);
  useEffect(() => { load(); }, [load]);
  const back = `/rollcall?day=${day}&session=${session}`;
  if (!d || d.key !== key) return <><div className="crumbs"><Link to={back}>← Roll call</Link></div><ErrorNote error={error} />{!error && <DetailSkeleton />}</>;
  const list = d.students.filter((s) => !s.moved || marks[s.id]);
  const left = list.filter((s) => !s.moved && !marks[s.id]).length;
  const count = (k) => list.filter((s) => marks[s.id] === k).length;
  const edit = d.canTake;
  const setAll = () => setMarks((m) => ({ ...Object.fromEntries(list.filter((s) => !s.moved).map((s) => [s.id, 'P'])), ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== 'P')) }));
  const save = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.put(`/duty/rollcall/class/${id}`, { day, session, note,
        marks: list.filter((s) => marks[s.id]).map((s) => ({ studentId: s.id, status: marks[s.id], note: marks[s.id] === 'P' ? '' : notes[s.id] || '' })) });
      toast(d.rollCall ? `Saved (${r.changed} changed)` : `${d.class.label}: roll call saved`);
      navigate(back);
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <>
      <div className="crumbs"><Link to={back}>← Roll call</Link></div>
      <PageHead title={`${d.class.label} · ${SESSIONS.find(([k]) => k === session)[1]} roll call`}
        sub={<>{fmtDay(day)} · {list.length} students{d.rollCall && <> · taken by <b>{d.rollCall.takenBy}</b> at {fmtTime(d.rollCall.takenAt)}{d.rollCall.updatedBy && <> · changed by {d.rollCall.updatedBy} at {fmtTime(d.rollCall.updatedAt)}</>}</>}</>}>
        {edit && <button className="btn" onClick={setAll}><Icon name="check" /> Everyone not marked is present</button>}
      </PageHead>
      {!edit && <p className="small muted" style={{ margin: 0 }}><Icon name="lock" /> {d.why}</p>}
      <ErrorNote error={error} />
      <Panel flush>
        {!list.length ? <Empty icon="users" title="No students in this class">Add students in Students first.</Empty> : (
          <div className="rc-list">{list.map((s, i) => (
            <div key={s.id} className={`rc-row${marks[s.id] && marks[s.id] !== 'P' ? ' rc-out' : ''}`}>
              <span className="rc-no muted">{i + 1}</span>
              <span className="rc-name"><b>{s.name}</b><span className="muted small">{s.admissionNo}{s.moved ? ' · moved out of this class' : ''}</span>
                {s.absentBefore > 0 && <span className="pill sm bad">absent {s.absentBefore} day{s.absentBefore === 1 ? '' : 's'} before</span>}</span>
              <span className="rc-marks" role="radiogroup" aria-label={`Mark for ${s.name}`}>{MARKS.map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={marks[s.id] === k} title={l} disabled={!edit}
                  className={`rc-m ${k}${marks[s.id] === k ? ' on' : ''}`} onClick={() => setMarks((m) => ({ ...m, [s.id]: k }))}>{k}<em>{l}</em></button>
              ))}</span>
              {marks[s.id] && marks[s.id] !== 'P' && (edit
                ? <input className="rc-note" placeholder="Reason, if known" value={notes[s.id] || ''} maxLength={200} onChange={(e) => setNotes((n) => ({ ...n, [s.id]: e.target.value }))} />
                : notes[s.id] ? <span className="rc-note muted">{notes[s.id]}</span> : null)}
            </div>
          ))}</div>
        )}
      </Panel>
      {edit && list.length > 0 && <label>Note for this roll call (optional)<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 5 pupils away on a school trip" /></label>}
      {edit && list.length > 0 && (
        <div className="rc-bar">
          <button className="btn p" disabled={busy || left > 0} onClick={save}>{busy ? 'Saving…' : d.rollCall ? 'Save changes' : 'Save roll call'}</button>
          <span>{MARKS.map(([k, l]) => <span key={k} className={`pill sm ${TONE[k]}`}>{l}: {count(k)}</span>)}{left > 0 && <span className="pill sm warn">Not marked: {left}</span>}</span>
        </div>
      )}
      <div className="help-room" aria-hidden="true" />
    </>
  );
}
