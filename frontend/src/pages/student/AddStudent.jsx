// Add one student. "Save and add another" keeps the class, for typing a class list by hand.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Empty, ErrorNote, PageHead, Panel, useToast } from '../../components/ui';
import StudentForm from './StudentForm';
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

  if (!can('students', 'f')) return <><PageHead title="Add student" /><Panel>Your account can only look at students.</Panel></>;
  if (!school) return <><PageHead title="Add student" /><Panel>Choose a school at the top of the page.</Panel></>;
  return (
    <>
      <PageHead title="Add student" sub="One student at a time. For a whole class, upload the class list from Excel.">
        <Link className="btn" to="/students/upload">Upload class list instead</Link>
      </PageHead>
      <ErrorNote error={error} />
      {!classes ? <Empty>Loading…</Empty> : !classes.some((c) => c.active) ? (
        <Panel><p style={{ margin: 0 }}>Register the classes first. <Link to="/students/classes">Classes</Link></p></Panel>
      ) : (
        <div className="sellgrid">
          <Panel title="Student">
            <StudentForm classes={classes} school={school} defaultClass={params.get('class') || ''} onBusy={setBusy}
              onSaved={(st, clear) => {
                toast(`${st.fullName} added to ${st.className}`);
                if (again) { clear(); setAdded((a) => [st, ...a]); } else navigate(`/students/${st.id}`);
              }} />
            <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn" form="stform" disabled={busy} onClick={() => setAgain(true)}>Save and add another</button>
              <button className="btn p" form="stform" disabled={busy} onClick={() => setAgain(false)}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </Panel>
          <Panel title="Added now" sub={added.length ? `${added.length}` : ''} flush>
            {!added.length ? <Empty>Students you add with "Save and add another" show here.</Empty> : (
              <div className="list">{added.map((s) => <Link key={s.id} className="li libtn" to={`/students/${s.id}`}><div className="grow"><b>{s.fullName}</b><span>{s.className} · {s.sexLabel} · Adm. {s.admissionNo}</span></div></Link>)}</div>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
