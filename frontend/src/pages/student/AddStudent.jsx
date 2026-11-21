// Add one student. "Save and add another" keeps the class, for typing a class list by hand.
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Empty, ErrorNote, Icon, PageHead, Panel, useToast } from '../../components/ui';
import StudentForm from './StudentForm';
import { InterviewPanel } from '../Interviews';
import { useClasses, useStudentSchool } from './shared';

export default function AddStudent() {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const school = useStudentSchool();
  const { classes, error } = useClasses(school);
  const [busy, setBusy] = useState(false);
  const [again, setAgain] = useState(false);
  const [added, setAdded] = useState([]);
  // Registering a child who passed the admission interview: the form is filled in from it (2026-11-20).
  const ivId = params.get('interview');
  const [iv, setIv] = useState(null);
  const [ivErr, setIvErr] = useState('');
  useEffect(() => { if (ivId) api.get(`/interviews/${ivId}`).then((d) => setIv(d.interview)).catch((e) => setIvErr(e.message)); }, [ivId]);

  if (!can('students', 'f')) return <><PageHead title="Add student" /><Panel>Your account can only look at students.</Panel></>;
  if (!school) return <><PageHead title="Add student" /><Panel>Choose a school at the top of the page.</Panel></>;
  return (
    <>
      <PageHead title="Add student" sub="One student at a time. For a whole class, upload the class list from Excel.">
        <Link className="btn" to="/students/upload">Upload class list instead</Link>
      </PageHead>
      <ErrorNote error={error || ivErr} />
      {iv && <div className="warnnote info"><Icon name="pen" /><span><b>From the admission interview:</b> {iv.fullName} · {iv.levelName || 'class not given'} · {iv.resultLabel}{iv.total != null ? ` · ${iv.total}${iv.outOf ? `/${iv.outOf}` : ''} marks` : ''}{iv.previousSchool ? ` · from ${iv.previousSchool}` : ''}. Give the Admission No. and check the class, then save.</span></div>}
      {iv?.studentId && <Panel><p style={{ margin: 0 }}>{iv.fullName} is already registered. <Link to={`/students/${iv.studentId}`}>Open the student</Link></p></Panel>}
      {(ivId && !iv && !ivErr) ? <Empty>Loading…</Empty> : iv?.studentId ? null : !classes ? <Empty>Loading…</Empty> : !classes.some((c) => c.active) ? (
        <Panel><p style={{ margin: 0 }}>No classes yet. The Academic Master adds them on <Link to="/students/classes">Classes</Link>.</p></Panel>
      ) : (
        <div className="sellgrid">
          <Panel title="Student">
            <StudentForm key={iv?.id || 'new'} classes={classes} school={school} onBusy={setBusy}
              defaultClass={params.get('class') || (iv && String(classes.find((c) => c.active && c.level === iv.level)?.id || '')) || ''}
              initial={iv ? { firstName: iv.firstName, middleName: iv.middleName || '', lastName: iv.lastName, sex: iv.sex, parentName: iv.parentName || '', parentPhone: iv.parentPhone || '' } : undefined}
              extra={iv ? { interviewId: iv.id } : undefined}
              onSaved={(st, clear) => {
                toast(`${st.fullName} added to ${st.className}`);
                if (again && !iv) { clear(); setAdded((a) => [st, ...a]); } else navigate(`/students/${st.id}`);
              }} />
            <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn" form="stform" disabled={busy} onClick={() => setAgain(true)}>Save and add another</button>
              <button className="btn p" form="stform" disabled={busy} onClick={() => setAgain(false)}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </Panel>
          {iv ? <InterviewPanel iv={iv} title="Admission interview" compact /> : <Panel title="Added now" sub={added.length ? `${added.length}` : ''} flush>
            {!added.length ? <Empty>Students you add with "Save and add another" show here.</Empty> : (
              <div className="list">{added.map((s) => <Link key={s.id} className="li libtn" to={`/students/${s.id}`}><div className="grow"><b>{s.fullName}</b><span>{s.className} · {s.sexLabel} · Adm. {s.admissionNo}</span></div></Link>)}</div>
            )}
          </Panel>}
        </div>
      )}
    </>
  );
}
