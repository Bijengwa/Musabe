// Admission interviews (2026-11-20): every child who did the interview — names, class applied for, exam centre,
// previous school, marks, result, parent phones, date. The Academic Secretary (and the Assistant Director) enters
// them one by one or from Excel. The School Admin registers those who passed as students; the interview then
// stays on the student's page for follow-up.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { useSchools } from '../layout/scope';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, Modal, PageHead, Panel, PhoneInput, fmtPhone, phoneProblem, useToast, Loading } from '../components/ui';
import { useStudentSchool } from './student/shared';

const TONE = { passed: 'ok', failed: 'bad', reserve: 'info', absent: '', waiting: 'warn' };
const RESULTS = [['passed', 'Passed'], ['failed', 'Failed'], ['reserve', 'Reserve list'], ['absent', 'Absent'], ['waiting', 'Waiting']];
const nextYear = () => { const d = new Date(); return d.getFullYear() + (d.getMonth() >= 6 ? 1 : 0); };
const fmtDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export const ResultPill = ({ iv }) => <span className={`pill ${TONE[iv.result]}`}>{iv.resultLabel}</span>;
export const Score = ({ iv }) => (iv.total == null ? <span className="muted">—</span>
  : <span className="ivscore"><b>{iv.total}</b>{iv.outOf ? <em>/ {iv.outOf}</em> : null}{iv.percent != null ? <em>({iv.percent}%)</em> : null}</span>);

// Shown on the student's page and in the details window.
export function InterviewPanel({ iv, title = 'Admission interview', compact }) {
  return (
    <Panel title={title} sub={`${iv.year}${iv.school ? ` · ${iv.school}` : ''}`} right={<ResultPill iv={iv} />}>
      <div className={compact ? 'stack' : 'grid2'} style={{ gap: 16 }}>
        <div className="kvgrid">
          <span>Class applied for</span><b>{iv.levelFull ? `${iv.levelFull} (${iv.levelName})` : '—'}</b>
          <span>Exam centre</span><b>{iv.examCentre || '—'}</b>
          <span>Previous school</span><b>{iv.previousSchool || '—'}</b>
          <span>Interview date</span><b>{fmtDate(iv.interviewDate)}</b>
          <span>Parent / guardian</span><b>{iv.parentName || '—'}</b>
          <span>Phones</span><b>{[iv.parentPhone, iv.parentPhone2].filter(Boolean).map(fmtPhone).join(' · ') || '—'}</b>
          {iv.note && <><span>Note</span><b>{iv.note}</b></>}
        </div>
        <div>
          {iv.marks.length ? (
            <div className="tw"><table className="stafftable">
              <thead><tr><th>Subject</th><th className="n">Marks</th></tr></thead>
              <tbody>{iv.marks.map((m) => <tr key={m.subject}><td>{m.subject}</td><td className="n">{m.marks}{m.outOf ? <span className="muted"> / {m.outOf}</span> : null}</td></tr>)}</tbody>
              <tfoot><tr><th>Total</th><th className="n"><Score iv={iv} /></th></tr></tfoot>
            </table></div>
          ) : <div className="kvgrid"><span>Total</span><b><Score iv={iv} /></b></div>}
        </div>
      </div>
    </Panel>
  );
}

export default function Interviews() {
  const { can, user } = useAuth();
  const edit = can('interviews', 'f');
  const register = can('students', 'f');
  const navigate = useNavigate();
  const toast = useToast();
  const schools = useSchools();
  const school = useStudentSchool();
  const [params, setParams] = useSearchParams();
  const result = params.get('result') || '';
  const registered = params.get('registered') || '';
  const [year, setYear] = useState('');
  const [level, setLevel] = useState('');
  const [q, setQ] = useState('');
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);       // details window
  const [form, setForm] = useState(null);       // add / edit
  const [upload, setUpload] = useState(false);
  const setParam = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (school) p.set('school', school);
    for (const [k, v] of [['year', year], ['result', result], ['registered', registered], ['level', level], ['q', q.trim()]]) if (v) p.set(k, v);
    return p.toString();
  }, [school, year, result, registered, level, q]);
  const load = useCallback(() => api.get(`/interviews?${qs}`).then((x) => { setD({ qs, ...x }); setError(''); }).catch((e) => setError(e.message)), [qs]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useLive(['interview', 'student'], load);
  const data = d?.qs === qs ? d : null;
  const list = data?.interviews;
  const s = data?.summary;
  const schoolName = schools.find((x) => String(x.id) === String(school))?.shortName;

  return (
    <>
      <PageHead title="Admission interviews" sub={edit ? 'Children who did the admission interview: marks, result and where they come from.' : register ? 'Register the children who passed as students. Their interview stays on their page.' : 'Children who did the admission interview.'}>
        <ExcelButton href={`/api/interviews/export.xlsx?${qs}`} />
        {edit && <button className="btn" disabled={!school} title={school ? '' : 'Choose a school at the top first'} onClick={() => setUpload(true)}><Icon name="upload" /> Upload Excel</button>}
        {edit && <button className="btn p" disabled={!school} title={school ? '' : 'Choose a school at the top first'} onClick={() => setForm({})}><Icon name="plus" /> Add applicant</button>}
      </PageHead>
      {edit && !school && <div className="warnnote"><Icon name="alert" /><span>To add or upload, choose the school at the top of the page.</span></div>}
      <ErrorNote error={error} />
      {s && (
        <div className="kpis">
          <Kpi tone="hi" label="Children interviewed" value={s.all} sub={`${s.boys} boys · ${s.girls} girls`} />
          <Kpi label="Passed" value={s.passed} sub={s.reserve ? `${s.reserve} on reserve list` : ''} tone="ok" />
          <Kpi label="Failed / absent" value={s.failed + s.absent} sub={s.waiting ? `${s.waiting} waiting for result` : ''} />
          <Kpi label="Registered as students" value={s.registered} sub={s.toRegister ? `${s.toRegister} passed, not yet registered` : 'none waiting'} tone={s.toRegister ? 'warn' : undefined} />
        </div>
      )}
      <div className="filters">
        <div className="searchbox"><Icon name="search" /><input placeholder="Name, previous school or exam centre" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select aria-label="Year" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">All years</option>{[...new Set([...(data?.years || []), nextYear()])].sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {data?.levels?.length > 0 && <select aria-label="Class" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">All classes</option>{data.levels.map((l) => <option key={l.key} value={l.key}>{l.shortName} — {l.name}</option>)}
        </select>}
        <select aria-label="Registered" value={registered} onChange={(e) => setParam('registered', e.target.value)}>
          <option value="">Registered or not</option><option value="yes">Registered as students</option><option value="no">Not registered</option>
        </select>
      </div>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button className={!result ? 'on' : ''} onClick={() => setParam('result', '')}>All results</button>
        {RESULTS.map(([k, t]) => <button key={k} className={result === k ? 'on' : ''} onClick={() => setParam('result', k)}>{t}</button>)}
      </div>
      <Panel flush>
        {!list ? <Loading /> : !list.length ? (q || result || registered
          ? <Empty icon="search" title="No child matches">Try a different name, or clear the search, year and result filters.</Empty>
          : edit
            ? <Empty icon="pen" title="No interviews yet"
              steps={['Choose the school at the top of the page.', 'Press "Add applicant" to type one child: name, marks, result and parent phone.', 'Or press "Upload Excel" to bring in a whole list at once.', 'When a child passes, press Register to make them a student.']}
              action={<><button className="btn p" disabled={!school} onClick={() => setForm({})}><Icon name="plus" /> Add applicant</button><button className="btn" disabled={!school} onClick={() => setUpload(true)}><Icon name="upload" /> Upload Excel</button></>} />
            : <Empty icon="pen" title="No interviews entered yet">When the admission office records the children who did the interview, they appear here with their marks and results.</Empty>) : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th className="sn">S/N</th><th className="stick">Name</th><th>Sex</th>{!school && <th>School</th>}<th>Class</th><th>Exam centre</th><th>Previous school</th><th className="n">Marks</th><th>Result</th><th>Phone</th><th>Date</th><th>Student</th></tr></thead>
            <tbody>{list.map((iv, i) => (
              <tr key={iv.id} className="clickrow" tabIndex={0} onClick={() => setOpen(iv)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(iv); }}>
                <td className="sn">{i + 1}</td>
                <td className="stick"><b>{iv.fullName}</b></td>
                <td data-l="Sex">{iv.sexLabel}</td>
                {!school && <td data-l="School">{iv.school}</td>}
                <td data-l="Class">{iv.levelName || <span className="muted">—</span>}</td>
                <td data-l="Exam centre">{iv.examCentre || <span className="muted">—</span>}</td>
                <td data-l="Previous school">{iv.previousSchool || <span className="muted">—</span>}</td>
                <td data-l="Marks" className="n"><Score iv={iv} /></td>
                <td data-l="Result"><ResultPill iv={iv} /></td>
                <td data-l="Phone" className="nowrap">{iv.parentPhone ? fmtPhone(iv.parentPhone) : <span className="muted">—</span>}</td>
                <td data-l="Date" className="nowrap">{fmtDate(iv.interviewDate)}</td>
                <td data-l="Student" onClick={(e) => e.stopPropagation()}>
                  {iv.studentId ? <Link to={`/students/${iv.studentId}`} className="mono">{iv.studentAdm}</Link>
                    : iv.result === 'passed' && register ? <button className="btn sm p" onClick={() => navigate(`/students/new?interview=${iv.id}`)}>Register</button>
                      : <span className="muted">—</span>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      <p className="small muted" style={{ margin: 0 }}>
        Sorted by marks, highest first. {user.scope === 'all' && !school ? 'Showing all schools: choose one at the top to add or upload.' : schoolName ? `School: ${schoolName}.` : ''}
      </p>

      {open && (
        <Modal wide title={open.fullName} onClose={() => setOpen(null)}
          footer={<>
            <button className="btn" onClick={() => setOpen(null)}>Close</button>
            {edit && <button className="btn" onClick={() => { setForm(open); setOpen(null); }}><Icon name="edit" /> Edit</button>}
            {register && open.result === 'passed' && !open.studentId && <button className="btn p" onClick={() => navigate(`/students/new?interview=${open.id}`)}><Icon name="plus" /> Register as student</button>}
            {open.studentId && <Link className="btn p" to={`/students/${open.studentId}`}>Open student ({open.studentAdm})</Link>}
          </>}>
          <InterviewPanel iv={open} title={`${open.sexLabel} · applied ${open.year}`} />
        </Modal>
      )}
      {form && <InterviewForm iv={form.id ? form : null} school={school} levels={data?.levels || []} onClose={() => setForm(null)}
        onSaved={(iv, more) => { toast(`${iv.fullName} saved`); load(); if (!more) setForm(null); }} />}
      {upload && <UploadInterviews school={school} schoolName={schoolName} onClose={() => setUpload(false)} onSaved={(n) => { toast(`${n} children saved`); load(); setUpload(false); }} />}
    </>
  );
}

const EMPTY_MARK = { subject: '', marks: '', outOf: '' };

function InterviewForm({ iv, school, levels, onClose, onSaved }) {
  const [f, setF] = useState(() => ({
    year: iv?.year || nextYear(), firstName: iv?.firstName || '', middleName: iv?.middleName || '', lastName: iv?.lastName || '', sex: iv?.sex || '',
    level: iv?.level || '', examCentre: iv?.examCentre || '', previousSchool: iv?.previousSchool || '', interviewDate: iv?.interviewDate || '',
    parentName: iv?.parentName || '', parentPhone: iv?.parentPhone || '', parentPhone2: iv?.parentPhone2 || '',
    total: iv && !iv.marks.length && iv.total != null ? String(iv.total) : '', outOf: iv?.outOf != null && !iv.marks.every((m) => m.outOf) ? String(iv.outOf) : '',
    result: iv?.result || 'waiting', note: iv?.note || '',
  }));
  const [marks, setMarks] = useState(() => (iv?.marks.length ? iv.marks.map((m) => ({ subject: m.subject, marks: String(m.marks), outOf: m.outOf ? String(m.outOf) : '' })) : [{ ...EMPTY_MARK }, { ...EMPTY_MARK }, { ...EMPTY_MARK }]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setMark = (i, k, v) => setMarks((m) => m.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const filled = marks.filter((m) => m.subject.trim() && m.marks !== '');
  const sum = filled.reduce((s, m) => s + (Number(m.marks) || 0), 0);
  const sumOut = filled.length && filled.every((m) => m.outOf) ? filled.reduce((s, m) => s + Number(m.outOf), 0) : null;

  const save = async (e) => {
    e.preventDefault(); setError('');
    if (!f.sex) { setError('Choose Boy or Girl.'); return; }
    for (const p of [f.parentPhone, f.parentPhone2]) if (phoneProblem(p)) { setError(`Phone: ${phoneProblem(p)}`); return; }
    setBusy(true);
    try {
      const body = { ...f, marks: marks.filter((m) => m.subject.trim() || m.marks !== ''), schoolId: Number(school || iv?.schoolId) };
      const r = iv ? await api.patch(`/interviews/${iv.id}`, body) : await api.post('/interviews', body);
      onSaved(r.interview, more && !iv);
      if (more && !iv) { setF((x) => ({ ...x, firstName: '', middleName: '', lastName: '', sex: '', previousSchool: '', parentName: '', parentPhone: '', parentPhone2: '', total: '', result: 'waiting', note: '' }));
        setMarks((m) => m.map((x) => ({ ...x, marks: '' }))); }
      setBusy(false);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal wide title={iv ? `Edit ${iv.fullName}` : 'Add applicant'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{iv ? 'Cancel' : 'Close'}</button>
        {!iv && <button className="btn" form="ivform" disabled={busy} onClick={() => setMore(true)}>Save and add another</button>}
        <button className="btn p" form="ivform" disabled={busy} onClick={() => setMore(false)}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="ivform" className="stack" onSubmit={save}>
        <div className="fg">
          <label>First name<input value={f.firstName} onChange={(e) => set('firstName', e.target.value)} required autoFocus /></label>
          <label>Middle name<input value={f.middleName} onChange={(e) => set('middleName', e.target.value)} placeholder="If any" /></label>
          <label>Last name<input value={f.lastName} onChange={(e) => set('lastName', e.target.value)} required /></label>
        </div>
        <div className="fg">
          <div className="lab">Sex<div className="seg">{[['M', 'Boy'], ['F', 'Girl']].map(([k, t]) => <button type="button" key={k} className={f.sex === k ? 'on' : ''} onClick={() => set('sex', k)}>{t}</button>)}</div></div>
          <label>Class applied for<select value={f.level} onChange={(e) => set('level', e.target.value)}>
            <option value="">Choose class</option>{levels.map((l) => <option key={l.key} value={l.key}>{l.shortName} — {l.name}</option>)}
          </select></label>
          <label>Year of joining<input type="number" min="2020" max="2100" value={f.year} onChange={(e) => set('year', e.target.value)} /></label>
        </div>
        <div className="fg">
          <label>Exam centre<input value={f.examCentre} onChange={(e) => set('examCentre', e.target.value)} placeholder="Where the child did the interview" /></label>
          <label>Previous school<input value={f.previousSchool} onChange={(e) => set('previousSchool', e.target.value)} /></label>
          <label>Interview date<input type="date" value={f.interviewDate} onChange={(e) => set('interviewDate', e.target.value)} /></label>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <b className="small">Marks (from the teacher who marked)</b>
          <div className="markrows">
            <span className="h">Subject</span><span className="h">Marks</span><span className="h">Out of</span><span />
            {marks.map((m, i) => (
              <div key={i} style={{ display: 'contents' }}>
                <input aria-label="Subject" value={m.subject} onChange={(e) => setMark(i, 'subject', e.target.value)} placeholder="e.g. Mathematics" />
                <input aria-label="Marks" inputMode="decimal" value={m.marks} onChange={(e) => setMark(i, 'marks', e.target.value)} />
                <input aria-label="Out of" inputMode="decimal" value={m.outOf} onChange={(e) => setMark(i, 'outOf', e.target.value)} placeholder="100" />
                <button type="button" className="btn sm" aria-label="Remove" onClick={() => setMarks((x) => x.filter((_, j) => j !== i))}><Icon name="x" /></button>
              </div>
            ))}
          </div>
          <button type="button" className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={() => setMarks((x) => [...x, { ...EMPTY_MARK }])}><Icon name="plus" /> Add subject</button>
          {filled.length ? <p className="small muted" style={{ margin: 0 }}>Total: <b>{sum}</b>{sumOut ? ` / ${sumOut}` : ''}</p> : (
            <div className="fg">
              <label>Total (if no subjects)<input inputMode="decimal" value={f.total} onChange={(e) => set('total', e.target.value)} /></label>
              <label>Out of<input inputMode="decimal" value={f.outOf} onChange={(e) => set('outOf', e.target.value)} placeholder="e.g. 400" /></label>
            </div>
          )}
        </div>

        <div className="lab">Result<div className="seg">{RESULTS.map(([k, t]) => <button type="button" key={k} className={f.result === k ? 'on' : ''} onClick={() => set('result', k)}>{t}</button>)}</div></div>
        <div className="fg">
          <label>Parent / guardian<input value={f.parentName} onChange={(e) => set('parentName', e.target.value)} /></label>
          <label>Parent phone<PhoneInput value={f.parentPhone} onChange={(v) => set('parentPhone', v)} /></label>
          <label>Second phone<PhoneInput value={f.parentPhone2} onChange={(v) => set('parentPhone2', v)} /></label>
        </div>
        <label>Note<input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Optional" /></label>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function UploadInterviews({ school, schoolName, onClose, onSaved }) {
  const [year, setYear] = useState(nextYear());
  const [file, setFile] = useState(null);
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (f, save) => {
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/interviews/import?school=${school}&year=${year}${save ? '' : '&check=1'}`, { method: 'POST', credentials: 'include',
        headers: { 'X-File-Name': encodeURIComponent(f.name).slice(0, 200) }, body: f });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Upload failed.');
      if (save) onSaved(d.saved); else { setCheck(d); setBusy(false); }
    } catch (e) { setError(e.message); setBusy(false); }
  };
  const s = check?.summary;
  return (
    <Modal wide title={`Upload interview results${schoolName ? ` · ${schoolName}` : ''}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        {check && <button className="btn p" disabled={busy || !!s.errors} onClick={() => send(file, true)}>{busy ? 'Saving…' : s.errors ? `Fix ${s.errors} row(s) first` : `Save ${s.rows} children`}</button>}</>}>
      <div className="stack">
        <div className="fg">
          <label>Year of joining<input type="number" min="2020" max="2100" value={year} onChange={(e) => { setYear(e.target.value); setCheck(null); }} /></label>
          <label className="filepick">
            <input type="file" disabled={busy} accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => { const f = e.target.files[0]; if (f) { setFile(f); setCheck(null); send(f, false); } }} />
            <Icon name="excel" /> {busy && !check ? 'Checking the file…' : file ? file.name : 'Choose the Excel file (.xlsx)'}
          </label>
        </div>
        {!check && <ol className="steps">
          <li>Columns are found by their names: First / Middle / Last name (or one Name column), Sex, Class, Exam centre, Previous school, Parent name, Parent phone, Interview date, Total, Out of, Result.</li>
          <li>Every other column is a subject: its marks are saved under that subject name.</li>
          <li>Result: Passed, Failed, Reserve or Absent (empty = Waiting). <a className="linkbtn" href="/api/interviews/template.xlsx" download>Empty template</a></li>
          <li>Nothing is saved until you check the rows and press <b>Save</b>.</li>
        </ol>}
        <ErrorNote error={error} />
        {check && <>
          <div className="kpis">
            <Kpi tone="hi" label="Rows" value={s.rows} sub={`${s.boys} boys · ${s.girls} girls`} />
            <Kpi label="Passed" value={s.passed} tone="ok" />
            <Kpi label="Mistakes" value={s.errors} tone={s.errors ? 'bad' : undefined} sub={s.warnings ? `${s.warnings} warnings` : ''} />
          </div>
          {s.subjects.length > 0 && <p className="small muted" style={{ margin: 0 }}>Subjects found: <b>{s.subjects.join(', ')}</b></p>}
          <div className="tw"><table className="stafftable reviewtable">
            <thead><tr><th>Row</th><th className="stick">Name</th><th>Sex</th><th>Class</th><th>Previous school</th><th className="n">Total</th><th>Result</th><th>Check</th></tr></thead>
            <tbody>{check.lines.map((l) => (
              <tr key={l.row} className={l.errors.length ? 'bad' : ''}>
                <td className="mono">{l.row}</td><td className="stick"><b>{l.fullName}</b></td><td>{l.sex || '?'}</td><td>{l.level || '—'}</td>
                <td>{l.previousSchool || '—'}</td><td className="n">{l.total ?? '—'}{l.outOf ? ` / ${l.outOf}` : ''}</td>
                <td>{l.result ? RESULTS.find(([k]) => k === l.result)?.[1] : '?'}</td>
                <td className="small">{[...l.errors.map((e) => <div key={e} style={{ color: 'var(--bad)' }}>{e}</div>), ...l.warnings.map((w) => <div key={w} className="muted">{w}</div>)]}{!l.errors.length && !l.warnings.length && <span className="pill ok">OK</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </>}
      </div>
    </Modal>
  );
}
