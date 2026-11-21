// All students of the school: pick a class, search, filter. Click a student to open their page.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useLive } from '../../live';
import { Empty, ErrorNote, ExcelButton, Icon, Kpi, PageHead, Panel, fmtPhone } from '../../components/ui';
import { useClasses, useStudentSchool } from './shared';

export default function StudentList() {
  const { can } = useAuth();
  const edit = can('students', 'f');
  const navigate = useNavigate();
  const school = useStudentSchool();
  const { classes: all, error: cErr } = useClasses(school);
  const classes = useMemo(() => (all || []).filter((c) => c.active), [all]);
  const [cls, setCls] = useState(() => { try { return sessionStorage.getItem('musabe-class') || ''; } catch { return ''; } });
  const [status, setStatus] = useState('active');
  const [sex, setSex] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const pickClass = (v) => { setCls(v); try { sessionStorage.setItem('musabe-class', v); } catch { /* ignore */ } };
  const validCls = cls && classes.some((c) => String(c.id) === cls) ? cls : '';

  const qs = useMemo(() => {
    const p = new URLSearchParams({ school, status });
    if (validCls) p.set('class', validCls);
    if (sex) p.set('sex', sex);
    if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [school, status, validCls, sex, q]);
  const load = useCallback(() => { if (school) api.get(`/students?${qs}`).then((d) => { setRows({ qs, list: d.students }); setError(''); }).catch((e) => setError(e.message)); }, [qs, school]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useLive(['student', 'studentimport'], load);
  const list = rows?.qs === qs ? rows.list : null;

  if (!school) return (<><PageHead title="Students" /><Panel><p style={{ margin: 0 }}>Choose a school at the top of the page.</p></Panel></>);
  const total = classes.reduce((s, c) => s + c.students, 0);
  const current = classes.find((c) => String(c.id) === validCls);

  return (
    <>
      <PageHead title="Students" sub={edit ? 'Pick a class, or search any name. Click a student to open their page.' : 'Students and their classes.'}>
        <ExcelButton href={`/api/students/export.xlsx?${qs}`} />
        {edit && <Link className="btn" to="/students/upload"><Icon name="upload" /> Upload class list</Link>}
        {edit && <Link className="btn p" to={`/students/new${validCls ? `?class=${validCls}` : ''}`}><Icon name="plus" /> Add student</Link>}
      </PageHead>
      <ErrorNote error={cErr || error} />
      {all && !classes.length ? (
        <Panel><div className="stack"><p style={{ margin: 0 }}>No classes yet. {can('classlist', 'f') ? 'Add the classes first (choose them from the list and type the streams), then add students.' : 'The Academic Master has not added the classes yet.'}</p>
          {can('classlist', 'f') && <Link className="btn p" style={{ alignSelf: 'flex-start' }} to="/students/classes"><Icon name="plus" /> Add classes</Link>}</div></Panel>
      ) : (
        <>
          {all && (
            <div className="kpis">
              <Kpi tone="hi" label={current ? current.label : 'Students'} value={current ? current.students : total}
                sub={current ? `${current.boys} boys · ${current.girls} girls · ${current.fullName}` : `${classes.reduce((s, c) => s + c.boys, 0)} boys · ${classes.reduce((s, c) => s + c.girls, 0)} girls`} />
              <Kpi label="Classes" value={classes.length} />
            </div>
          )}
          <div className="classchips">
            <button className={!validCls ? 'on' : ''} onClick={() => pickClass('')}>All classes</button>
            {classes.map((c) => <button key={c.id} title={c.fullName} className={String(c.id) === validCls ? 'on' : ''} onClick={() => pickClass(String(c.id))}>{c.label} <em>{c.students}</em></button>)}
          </div>
          <div className="filters">
            <div className="searchbox"><Icon name="search" /><input placeholder="Name or admission no." value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <select aria-label="Sex" value={sex} onChange={(e) => setSex(e.target.value)}><option value="">Boys and girls</option><option value="M">Boys</option><option value="F">Girls</option></select>
            <div className="seg">{[['active', 'At school'], ['left', 'Left']].map(([k, t]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t}</button>)}</div>
            {list && <span className="muted small">{list.length} student{list.length === 1 ? '' : 's'}</span>}
          </div>
          <Panel flush>
            {!list ? <Empty>Loading…</Empty> : !list.length ? <Empty>{q ? 'No student matches.' : current ? `No students in ${current.label} yet.` : 'No students yet.'}</Empty> : (
              <div className="tw"><table className="stafftable">
                <thead><tr><th className="sn">S/N</th><th className="stick">Name</th><th>Adm. No.</th><th>Sex</th>{!validCls && <th>Class</th>}<th>Parent</th><th>Phone</th></tr></thead>
                <tbody>
                  {list.map((s, i) => (
                    <tr key={s.id} className="clickrow" tabIndex={0} onClick={() => navigate(`/students/${s.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/students/${s.id}`); }}>
                      <td className="sn" data-l="S/N">{i + 1}</td>
                      <td className="stick"><b>{s.fullName}</b>{s.status === 'left' && <span className="pill bad sm">Left</span>}</td>
                      <td data-l="Adm. No." className="mono">{s.admissionNo}</td>
                      <td data-l="Sex">{s.sexLabel}</td>
                      {!validCls && <td data-l="Class">{s.className || <span className="muted">No class</span>}</td>}
                      <td data-l="Parent">{s.parentName || <span className="muted">—</span>}</td>
                      <td data-l="Phone">{s.parentPhone ? fmtPhone(s.parentPhone) : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
