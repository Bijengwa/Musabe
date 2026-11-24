// Examination timetable (2026-11-25): one table, for chosen classes or the whole school.
// Rows are exam sessions (date and time); columns are classes; each box is a drop-down of that class's subjects.
// Excel: download the table, fill it, import it, look, Save.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { useSchools, useScope } from '../layout/scope';
import { Empty, ErrorNote, Icon, Modal, Panel, useToast } from '../components/ui';

const DAYNAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayOf = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? DAYNAME[new Date(`${d}T00:00:00Z`).getUTCDay()] : '');
const bd = { border: '1px solid rgba(128,128,128,.35)', padding: '6px 8px', textAlign: 'center', fontSize: 12.5 };
let seq = 0; const nid = () => `n${++seq}`;

function useSchoolParam() {
  const { user } = useAuth();
  const schools = useSchools();
  const [scope] = useScope();
  return user.scope === 'all' ? scope || schools[0]?.id || '' : '';
}

export default function ExamGrid() {
  const toast = useToast();
  const school = useSchoolParam();
  const [year, setYear] = useState(new Date().getFullYear() + (new Date().getMonth() >= 10 ? 1 : 0));
  const [term, setTerm] = useState(1);
  const [exam, setExam] = useState('');
  const [examKey, setExamKey] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sessions, setSessions] = useState([]);
  const [cells, setCells] = useState({});
  const [scope, setScope] = useState(null); // selected class ids
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const [find, setFind] = useState('');
  const [warn, setWarn] = useState(null);
  const sp = school ? `&school=${school}` : '';

  const load = useCallback(() => api.get(`/exam-timetable/grid?year=${year}&term=${term}${examKey ? `&exam=${encodeURIComponent(examKey)}` : ''}${sp}`).then((x) => {
    setData(x); setError('');
    if (!examKey && x.exam) { setExam(x.exam); }
    const map = new Map(); const cs = {};
    for (const c of x.cells) { const k = `${c.date}|${c.starts}|${c.ends}`; if (!map.has(k)) map.set(k, { id: nid(), date: c.date, starts: c.starts, ends: c.ends }); cs[`${map.get(k).id}:${c.classId}`] = c.subjectId; if (c.invigilatorId) cs[`${map.get(k).id}:${c.classId}:i`] = c.invigilatorId; }
    setSessions([...map.values()].sort((a, b) => `${a.date}${a.starts}`.localeCompare(`${b.date}${b.starts}`)));
    setCells(cs); setDirty(false);
    setScope((s) => s || x.classes.map((c) => c.id));
  }).catch((e) => setError(e.message)), [year, term, examKey, sp]);
  useEffect(() => { load(); }, [load]);
  useLive(['academic', 'class'], () => { if (!dirty) load(); });

  const classes = useMemo(() => (data?.classes || []).filter((c) => !scope || scope.includes(c.id)), [data, scope]);
  const setSession = (id, patch) => { setSessions((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s))); setDirty(true); };
  const setCell = (sid, classId, v) => { setCells((cs) => { const n = { ...cs }; if (v) n[`${sid}:${classId}`] = Number(v); else { delete n[`${sid}:${classId}`]; delete n[`${sid}:${classId}:i`]; } return n; }); setDirty(true); };
  const setInv = (sid, classId, v) => { setCells((cs) => { const n = { ...cs }; if (v) n[`${sid}:${classId}:i`] = Number(v); else delete n[`${sid}:${classId}:i`]; return n; }); setDirty(true); };
  const addSession = () => { const last = sessions[sessions.length - 1]; setSessions([...sessions, { id: nid(), date: '', starts: last?.starts || '08:00', ends: last?.ends || '09:30' }]); setDirty(true); };
  const delSession = (id) => { setSessions(sessions.filter((s) => s.id !== id)); setDirty(true); };

  const busy2 = (s, c) => { const t = cells[`${s.id}:${c.id}:i`]; if (!t) return false; return sessions.some((o) => o.date === s.date && o.starts < s.ends && s.starts < o.ends && classes.some((x) => (o.id !== s.id || x.id !== c.id) && cells[`${o.id}:${x.id}:i`] === t && cells[`${o.id}:${x.id}`])); };
  const body = () => {
    const out = [];
    for (const s of sessions) for (const c of classes) { const sub = cells[`${s.id}:${c.id}`]; if (sub) out.push({ classId: c.id, subjectId: sub, invigilatorId: cells[`${s.id}:${c.id}:i`] || null, date: s.date, starts: s.starts, ends: s.ends }); }
    return { schoolId: school || undefined, year, term, exam: exam.trim(), classIds: classes.map((c) => c.id), cells: out };
  };
  const save = async () => {
    setBusy(true);
    try { const r = await api.put('/exam-timetable/grid', body()); toast(`Saved: ${r.saved} papers for ${r.classes} classes`); setExamKey(exam.trim()); setDirty(false); load(); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/exam-timetable/excel${school ? `?school=${school}` : ''}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Upload failed');
      const map = new Map(); const cs = {};
      for (const c of d.cells) { const k = `${c.date}|${c.starts}|${c.ends}`; if (!map.has(k)) map.set(k, { id: nid(), date: c.date, starts: c.starts, ends: c.ends }); cs[`${map.get(k).id}:${c.classId}`] = c.subjectId; if (c.invigilatorId) cs[`${map.get(k).id}:${c.classId}:i`] = c.invigilatorId; }
      setSessions([...map.values()].sort((a, b) => `${a.date}${a.starts}`.localeCompare(`${b.date}${b.starts}`)));
      setCells(cs); setScope(d.classIds); setDirty(true);
      toast(`Excel read: ${d.cells.length} papers. Look, then press Save.`);
      if (d.warnings.length) setWarn(d);
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Panel><p className="muted" style={{ margin: 0 }}>Loading…</p></Panel>;
  if (!data.classes.length) return <Panel><Empty>No classes yet.</Empty></Panel>;
  const can = data.canWrite;
  const all = scope && scope.length === data.classes.length;
  const download = `/api/exam-timetable/template.xlsx?year=${year}&term=${term}&exam=${encodeURIComponent(exam.trim())}${all ? '' : `&classes=${(scope || []).join(',')}`}${sp}`;
  const levels = []; for (const c of data.classes) { let l = levels.find((x) => x.level === c.level); if (!l) { l = { level: c.level, name: c.levelName, list: [] }; levels.push(l); } l.list.push(c); }

  return (
    <>
      <Panel title="Exam" sub="Choose the term and year, write the exam name, then add sessions." >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, alignItems: 'end' }}>
          <label className="stack" style={{ gap: 4 }}>Term
            <select value={term} style={{ width: '100%' }} onChange={(e) => { setTerm(Number(e.target.value)); setExamKey(''); setExam(''); }}><option value={1}>Term 1</option><option value={2}>Term 2</option></select></label>
          <label className="stack" style={{ gap: 4 }}>Year
            <input type="number" value={year} style={{ width: '100%' }} onChange={(e) => { setYear(Number(e.target.value) || year); setExamKey(''); setExam(''); }} /></label>
          <label className="stack" style={{ gap: 4, gridColumn: 'span 2', minWidth: 240 }}>Exam name
            <input list="exam-names" value={exam} placeholder="e.g. Mid Term Exam" maxLength={160} style={{ width: '100%' }}
              onChange={(e) => { setExam(e.target.value); if (data.exams.includes(e.target.value)) setExamKey(e.target.value); setDirty(true); }} /></label>
          <datalist id="exam-names">{data.exams.map((x) => <option key={x} value={x} />)}</datalist>
          <label className="stack" style={{ gap: 4 }}>Classes
            <button className="btn" style={{ width: '100%' }} onClick={() => setPick(true)}>{all ? `Whole school (${data.classes.length})` : `${classes.length} of ${data.classes.length} chosen`}</button></label>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          <a className="btn" href={download}><Icon name="excel" />Download Excel</a>
          {can && <>
            <label className="btn filepick"><Icon name="upload" />Import Excel<input type="file" accept=".xlsx" style={{ display: 'none' }} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
            <button className="btn" onClick={addSession}><Icon name="plus" />Add session</button>
            <span style={{ flex: 1 }} />
            <button className="btn p" disabled={busy || !dirty || !exam.trim() || !classes.length} onClick={save}>{busy ? 'Saving…' : 'Save timetable'}</button>
          </>}
        </div>
        {can && <p className="muted" style={{ margin: '10px 0 0', fontSize: 12.5 }}>Under each subject, choose the invigilator. An orange invigilator box means that teacher has another paper at the same time.</p>}
        {can && !exam.trim() && <p className="muted" style={{ margin: '10px 0 0' }}>Write the exam name first, then Save will work.</p>}
      </Panel>
      <Panel title={`Examination timetable${exam.trim() ? ` — ${exam.trim()}` : ''}`} sub={`Term ${term}, ${year}`} flush>
        {!sessions.length ? <Empty>{can ? 'No sessions yet. Press "Add session", or import an Excel file.' : 'The exam timetable is not written yet.'}</Empty> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>
                {['DATE', 'DAY', 'TIME'].map((h) => <th key={h} style={{ ...bd, background: 'rgba(22,121,74,.35)', color: 'inherit' }}>{h}</th>)}
                {classes.map((c) => <th key={c.id} style={{ ...bd, background: 'rgba(22,121,74,.35)', color: 'inherit', whiteSpace: 'nowrap' }}>{c.label}</th>)}
                {can && <th style={{ ...bd, background: 'rgba(22,121,74,.35)' }} />}
              </tr></thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td style={bd}>{can ? <input type="date" value={s.date} onChange={(e) => setSession(s.id, { date: e.target.value })} /> : s.date}</td>
                    <td style={bd}>{dayOf(s.date)}</td>
                    <td style={{ ...bd, whiteSpace: 'nowrap' }}>{can ? <><input type="time" value={s.starts} onChange={(e) => setSession(s.id, { starts: e.target.value })} style={{ width: 92 }} /> – <input type="time" value={s.ends} onChange={(e) => setSession(s.id, { ends: e.target.value })} style={{ width: 92 }} /></> : `${s.starts}–${s.ends}`}</td>
                    {classes.map((c) => {
                      const v = cells[`${s.id}:${c.id}`];
                      return <td key={c.id} style={{ ...bd, background: v ? 'rgba(22,121,74,.2)' : undefined, minWidth: 130 }}>
                        {can ? <>
                          <select value={v || ''} style={{ width: '100%', fontSize: 12 }} onChange={(e) => setCell(s.id, c.id, e.target.value)}><option value="" />{c.subjects.map((x) => <option key={x.id} value={x.id}>{x.short}</option>)}</select>
                          {v && <select value={cells[`${s.id}:${c.id}:i`] || ''} title="Invigilator" style={{ width: '100%', fontSize: 11.5, marginTop: 4, outline: busy2(s, c) ? '2px solid #f59e0b' : undefined }} onChange={(e) => setInv(s.id, c.id, e.target.value)}><option value="">Invigilator…</option>{data.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
                        </> : <><b>{c.subjects.find((x) => x.id === v)?.short || ''}</b>{v && <div className="muted" style={{ fontSize: 11 }}>{data.teachers.find((t) => t.id === cells[`${s.id}:${c.id}:i`])?.name || ''}</div>}</>}
                      </td>;
                    })}
                    {can && <td style={bd}><button className="btn sm" title="Remove this session" onClick={() => delSession(s.id)}>✕</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {pick && <Modal title="Which classes?" onClose={() => setPick(false)} footer={<button className="btn primary" onClick={() => setPick(false)}>Done — {classes.length} chosen</button>}>
        <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={() => setScope(data.classes.map((c) => c.id))}>Whole school</button>
          <button className="btn sm" onClick={() => setScope([])}>None</button>
          <button className="btn sm" onClick={() => setScope(data.classes.filter((c) => !scope.includes(c.id)).map((c) => c.id))}>Swap</button>
          <input placeholder="Search class…" value={find} onChange={(e) => setFind(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
        </div>
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          {levels.map((l) => {
            const list = l.list.filter((c) => !find.trim() || `${c.label} ${l.name}`.toUpperCase().includes(find.trim().toUpperCase()));
            if (!list.length) return null;
            const on = l.list.filter((c) => scope.includes(c.id)).length;
            const allOn = on === l.list.length;
            return (
              <div key={l.level} style={{ marginBottom: 12 }}>
                <div className="row" style={{ gap: 10, alignItems: 'center', marginBottom: 6 }}>
                  <b>{l.name}</b><span className="muted" style={{ fontSize: 12 }}>{on}/{l.list.length}</span>
                  <button className="btn sm" onClick={() => setScope(allOn ? scope.filter((i) => !l.list.some((c) => c.id === i)) : [...new Set([...scope, ...l.list.map((c) => c.id)])])}>{allOn ? 'Clear' : 'Select all'}</button>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {list.map((c) => { const yes = scope.includes(c.id); return (
                    <button key={c.id} type="button" className="btn" aria-pressed={yes}
                      style={{ background: yes ? 'rgba(22,121,74,.45)' : undefined, borderColor: yes ? '#16794a' : undefined, fontWeight: yes ? 700 : 400 }}
                      onClick={() => setScope(yes ? scope.filter((i) => i !== c.id) : [...scope, c.id])}>{yes ? '✓ ' : ''}{c.label}</button>
                  ); })}
                </div>
              </div>
            );
          })}
        </div>
        <p className="muted" style={{ margin: '8px 0 0', fontSize: 12.5 }}>Classes you do not choose are left as they are when you Save.</p>
      </Modal>}

      {warn && <Modal title="Look at these" onClose={() => setWarn(null)} footer={<button className="btn primary" onClick={() => setWarn(null)}>OK</button>}>
        <ul style={{ maxHeight: 260, overflow: 'auto', fontSize: 12.5 }}>{warn.warnings.map((w, i) => <li key={i}>{w}</li>)}{warn.moreWarnings > 0 && <li>…and {warn.moreWarnings} more</li>}</ul>
        <p className="muted">The rest was read. Press Save to keep it.</p>
      </Modal>}
    </>
  );
}

// The teacher's side: only his own papers (subjects he teaches, or where he invigilates), as a small table.
export function ExamMine() {
  const toast = useToast();
  const school = useSchoolParam();
  const [year, setYear] = useState(new Date().getFullYear() + (new Date().getMonth() >= 10 ? 1 : 0));
  const [term, setTerm] = useState(1);
  const [exam, setExam] = useState('');
  const [d, setD] = useState(null);
  const sp = school ? `&school=${school}` : '';
  const load = useCallback(() => api.get(`/exam-timetable/mine?year=${year}&term=${term}${exam ? `&exam=${encodeURIComponent(exam)}` : ''}${sp}`).then(setD).catch((e) => toast(e.message)), [year, term, exam, sp, toast]);
  useEffect(() => { load(); }, [load]);
  useLive(['academic'], load);
  const days = []; for (const p of d?.papers || []) { let g = days.find((x) => x.date === p.date); if (!g) { g = { date: p.date, day: p.day, list: [] }; days.push(g); } g.list.push(p); }
  return (
    <>
      <Panel title="My exams" sub="Only the papers of the subjects you teach, and the ones you invigilate.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
          <label className="stack" style={{ gap: 4 }}>Term
            <select value={term} style={{ width: '100%' }} onChange={(e) => { setTerm(Number(e.target.value)); setExam(''); }}><option value={1}>Term 1</option><option value={2}>Term 2</option></select></label>
          <label className="stack" style={{ gap: 4 }}>Year
            <input type="number" value={year} style={{ width: '100%' }} onChange={(e) => { setYear(Number(e.target.value) || year); setExam(''); }} /></label>
          <label className="stack" style={{ gap: 4 }}>Exam
            <select value={d?.exam || ''} style={{ width: '100%' }} onChange={(e) => setExam(e.target.value)}>{!d?.exams.length && <option value="">No exam yet</option>}{(d?.exams || []).map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        </div>
      </Panel>
      <Panel title={d?.exam ? `${d.exam}` : 'Exam timetable'} sub={d ? `${d.papers.length} papers for you` : ''} flush>
        {!d ? <p className="muted" style={{ margin: 16 }}>Loading…</p> : !d.papers.length ? <Empty>{d.exams.length ? 'You have no paper in this exam.' : 'The exam timetable is not written yet.'}</Empty> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>{['DATE', 'DAY', 'TIME', 'CLASS', 'SUBJECT', 'YOU ARE'].map((h) => <th key={h} style={{ ...bd, background: 'rgba(22,121,74,.35)' }}>{h}</th>)}</tr></thead>
              <tbody>
                {days.map((g) => g.list.map((p, i) => (
                  <tr key={p.id}>
                    {i === 0 && <td style={bd} rowSpan={g.list.length}>{g.date}</td>}
                    {i === 0 && <td style={bd} rowSpan={g.list.length}>{g.day}</td>}
                    <td style={{ ...bd, whiteSpace: 'nowrap' }}>{p.starts}–{p.ends}</td>
                    <td style={bd}><b>{p.className}</b></td>
                    <td style={bd}>{p.subject}</td>
                    <td style={bd}>{p.role}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
