// Upload a class list from Excel: choose the class, choose the file, check it on the review page, approve.
// "Many classes" (bulk edit with Excel): a file downloaded from the system for several classes or the whole school;
// each row goes to the class in its Class column.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useLive } from '../../live';
import { Empty, ErrorNote, Icon, PageHead, Panel, SkeletonTable, fmtWhen } from '../../components/ui';
import { classOption, useClasses, useStudentSchool } from './shared';

export default function UploadList() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const school = useStudentSchool();
  const { classes, error: cErr } = useClasses(school);
  const [params] = useSearchParams();
  const [cls, setCls] = useState(params.get('class') || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async (file) => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/students/imports?school=${school}&class=${cls}`, { method: 'POST', credentials: 'include', headers: { 'X-File-Name': encodeURIComponent(file.name).slice(0, 200) }, body: file });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Upload failed.');
      navigate(`/students/review/${d.id}`);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  if (!can('students', 'f')) return <><PageHead title="Upload class list" /><Panel>Your account can only look at students.</Panel></>;
  if (!school) return <><PageHead title="Upload class list" /><Panel>Choose a school at the top of the page.</Panel></>;
  const active = (classes || []).filter((c) => c.active);
  return (
    <>
      <PageHead title="Upload class list" sub="One Excel file for one class, or many classes at once to edit students in Excel. Your own class lists work as they are." />
      <ErrorNote error={cErr} />
      {classes && !active.length ? <Panel><p style={{ margin: 0 }}>No classes yet. The Academic Master adds them on <Link to="/students/classes">Classes</Link>.</p></Panel> : (
        <div className="sellgrid">
          <Panel title="New upload">
            <div className="stack">
              <label>1. Which class is this file for?<select value={cls} onChange={(e) => setCls(e.target.value)}>
                <option value="">Choose class</option>
                <option value="many">Many classes: each row goes to the class in its Class column</option>
                {active.map((c) => <option key={c.id} value={c.id}>{classOption(c)} ({c.students} now)</option>)}
              </select></label>
              {cls === 'many' && <div className="warnnote info"><Icon name="excel" /><span><b>Bulk edit with Excel.</b> Download the students first (Students → Excel, or Edit many → Download), change names, sex, class, status or guardians in Excel, then upload the same file here. Rows with no change are skipped.</span></div>}
              <label className={`filepick${!cls ? ' off' : ''}`}>
                <input type="file" disabled={busy || !cls} accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => send(e.target.files[0])} />
                <Icon name="excel" /> {busy ? 'Checking the file…' : cls ? '2. Choose the Excel file (.xlsx)' : 'Choose the class first'}
              </label>
              <ErrorNote error={error} />
              <ol className="steps">
                <li>Columns are found by their names: Admission No., first / middle / last name, Sex, Day or Boarding (optional), then Guardian 1 Name, Guardian 1 Phone, Guardian 1 Relationship, Guardian 2 … (as many guardians as needed). Guardian names: the real names, at least two (JOHN MATHIAS, not Mr John). Other columns (fees, PREM number …) are ignored. Only the first sheet is read.</li>
                <li>Every student needs an Admission No., first and last name, and Sex (M or F). <a className="linkbtn" href="/api/students/template.xlsx" download>Empty template</a></li>
                <li>A review page opens. Mistakes are red with the row number. A wrong row does not stop the list: press <b>Fix</b> to correct it there, <b>Skip</b> it, or save the good rows and download the left-out rows as Excel. Nothing is saved until you press <b>Approve</b>.</li>
                <li>Uploading a class again updates it: new phones and names are saved, students from another class are moved here. Empty cells never erase anything (write - in Middle name to erase it).</li>
                <li>Many classes: the Class column (e.g. P 1 A) decides each student's class; Status <b>Left</b> marks a student as left school, <b>Active</b> brings them back.</li>
              </ol>
            </div>
          </Panel>
          <Uploads school={school} />
        </div>
      )}
    </>
  );
}

function Uploads({ school }) {
  const [d, setD] = useState(null);
  const load = useCallback(() => api.get(`/students/imports?school=${school}`).then(setD).catch(() => {}), [school]);
  useEffect(() => { load(); }, [load]);
  useLive(['studentimport'], load);
  if (!d) return <Panel title="Uploads" flush><SkeletonTable rows={4} columns={2} /></Panel>;
  const sum = (u) => { const s = u.summary || {}; return [s.new && `${s.new} new`, s.update && `${s.update} updated`, s.move && `${s.move} moved`, s.errors && `${s.errors} mistakes`].filter(Boolean).join(' · ') || `${s.rows || 0} rows`; };
  return (
    <div className="stack">
      <Panel title="Waiting for approval" flush>
        {!d.pending.length ? <Empty icon="check" title="Nothing waiting">A class list you upload waits here until it is checked and approved. Nothing changes before that.</Empty> : <div className="list">{d.pending.map((u) => (
          <Link key={u.id} className="li libtn" to={`/students/review/${u.id}`}><div className="grow"><b>{u.className} · {u.fileName}</b><span>{u.mine ? 'You' : u.uploadedBy} · {fmtWhen(u.createdAt)} · {sum(u)}</span></div><span className="btn sm p">Review</span></Link>
        ))}</div>}
      </Panel>
      <Panel title="Done" flush>
        {!d.recent.length ? <Empty icon="upload" title="No uploads yet">Class lists you upload from Excel appear here after approval, with how many students were added, updated or moved.</Empty> : <div className="list">{d.recent.map((u) => (
          <div key={u.id} className="li"><div className="grow"><b>{u.className} · {u.fileName}</b><span>{u.status === 'approved' ? 'Approved' : 'Discarded'} by {u.decidedBy} · {fmtWhen(u.decidedAt)}{u.status === 'approved' ? ` · ${sum(u)}` : ''}</span></div>
            {u.summary?.leftOut?.length > 0 && <a className="btn sm" href={`/api/students/imports/${u.id}/left-out.xlsx`} download title="Rows not saved: fix them in this file and upload it">{u.summary.leftOut.length} left out (Excel)</a>}
            <span className={`pill ${u.status === 'approved' ? 'ok' : ''}`}>{u.status === 'approved' ? 'Saved' : 'Discarded'}</span></div>
        ))}</div>}
      </Panel>
    </div>
  );
}
