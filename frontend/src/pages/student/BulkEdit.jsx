// Edit many students on one screen (2026-11-23): names, admission no., sex, class and guardians.
// Pick a class, change what is wrong in the grid, then press Save. Changed rows are coloured.
// The server checks every row first: if one row has a mistake nothing is saved and that row turns red.
// For very big changes, the Excel way still works: download the class list, edit it, upload it back.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Empty, ErrorNote, ExcelButton, Icon, Loading, PageHead, Panel, useConfirm, useToast } from '../../components/ui';
import { classOption, useClasses, useStudentSchool } from './shared';
import { GuardiansEditor } from './guardians';
import { fromServer, guardianProblems, guardiansBody } from './guardianRules';

const FIELDS = ['admissionNo', 'firstName', 'middleName', 'lastName', 'sex', 'residence', 'classId'];
const rowOf = (s) => ({ id: s.id, admissionNo: s.admissionNo, firstName: s.firstName, middleName: s.middleName || '', lastName: s.lastName,
  sex: s.sex, residence: s.residence || '', classId: String(s.classId || ''), guardians: fromServer(s.guardians) });
const gKey = (list) => JSON.stringify(guardiansBody(list).map((g) => [g.fullName.trim().toUpperCase().replace(/\s+/g, ' '), g.phone, g.relationship]));
const isChanged = (a, b) => FIELDS.some((k) => String(a[k] ?? '').trim().toUpperCase() !== String(b[k] ?? '').trim().toUpperCase()) || gKey(a.guardians) !== gKey(b.guardians);

export default function BulkEdit() {
  const { can } = useAuth();
  const toast = useToast();
  const school = useStudentSchool();
  const [params, setParams] = useSearchParams();
  const { classes: all, error: cErr } = useClasses(school);
  const classes = useMemo(() => (all || []).filter((c) => c.active), [all]);
  const cls = params.get('class') || '';
  const [saved, setSaved] = useState(null); // { cls, rows } as on the server
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [problems, setProblems] = useState({}); // id -> [text]
  const [error, setError] = useState('');
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [allClass, setAllClass] = useState('');

  const load = useCallback(() => {
    if (!school || !cls) return;
    api.get(`/students?school=${school}&class=${cls}&status=active`).then((d) => {
      const list = d.students.map(rowOf);
      setSaved({ cls, rows: list }); setRows(list); setProblems({}); setError('');
    }).catch((e) => setError(e.message));
  }, [school, cls]);
  useEffect(() => { load(); }, [load]);

  const before = useMemo(() => new Map((saved?.rows || []).map((r) => [r.id, r])), [saved]);
  const changed = rows.filter((r) => before.has(r.id) && isChanged(r, before.get(r.id)));
  const dirty = changed.length > 0;
  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return undefined;
    const stop = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', stop);
    return () => window.removeEventListener('beforeunload', stop);
  }, [dirty]);

  const set = (id, k, v) => setRows((x) => x.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
  const words = q.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter((r) => {
    if (onlyChanged && !isChanged(r, before.get(r.id))) return false;
    if (!words.length) return true;
    const text = [r.firstName, r.middleName, r.lastName, r.admissionNo, ...r.guardians.map((g) => `${g.fullName} ${g.phone}`)].join(' ').toUpperCase();
    return words.every((w) => text.includes(w));
  });

  const save = async () => {
    setError('');
    // Check guardians here first (same rules as the server).
    const local = {};
    for (const r of changed) { const p = guardianProblems(r.guardians); if (p.length) local[r.id] = p; }
    if (Object.keys(local).length) { setProblems(local); setError(`${Object.keys(local).length} student(s) have guardian mistakes. Nothing was saved.`); return; }
    setBusy(true);
    try {
      const body = changed.map((r) => ({ id: r.id, admissionNo: r.admissionNo, firstName: r.firstName, middleName: r.middleName, lastName: r.lastName,
        sex: r.sex, residence: r.residence || undefined, classId: r.classId ? Number(r.classId) : null, guardians: guardiansBody(r.guardians) }));
      const x = await api.post('/students/bulk', { rows: body });
      toast(`${x.saved} student${x.saved === 1 ? '' : 's'} saved${x.warnings?.length ? `. Check: ${x.warnings[0]}` : ''}`);
      setBusy(false); load();
    } catch (e) {
      setBusy(false); setError(e.message);
      if (e.data?.rows) setProblems(Object.fromEntries(e.data.rows.map((r) => [r.id, r.errors])));
    }
  };

  if (!can('students', 'f')) return <><PageHead title="Edit many students" /><Panel>Your account can only look at students.</Panel></>;
  if (!school) return <><PageHead title="Edit many students" /><Panel>Choose a school at the top of the page.</Panel></>;
  const current = classes.find((c) => String(c.id) === cls);
  return (
    <>
      <div className="crumbs"><Link to="/students">← Students</Link></div>
      <PageHead title="Edit many students" sub="Change names, admission numbers, sex, Day or Boarding, class and guardians for a whole class here, then save once. Or do it in Excel (below).">
      </PageHead>
      <ErrorNote error={cErr} />
      <ExcelEdit school={school} cls={cls} label={current?.label} />
      <div className="classchips">
        {classes.map((c) => <button key={c.id} title={c.fullName} className={String(c.id) === cls ? 'on' : ''} disabled={busy}
          onClick={async () => { if (dirty && !(await confirm({ title: 'Unsaved changes', body: 'You have changes that are not saved. Leave them?', ok: 'Leave', danger: true }))) return; setParams({ class: String(c.id) }); }}>{c.label} <em>{c.students}</em></button>)}
      </div>
      {!cls ? <Panel><Empty>Choose the class to edit.</Empty></Panel> : saved?.cls !== cls ? <Panel><Loading /></Panel> : (
        <>
          <div className="filters">
            <div className="searchbox"><Icon name="search" /><input placeholder="Find a student or guardian" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <label className="chk"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> Only changed</label>
            <span className="row nowrap">
              <select aria-label="Class for all shown" value={allClass} onChange={(e) => setAllClass(e.target.value)}>
                <option value="">Class for all shown…</option>{classes.map((c) => <option key={c.id} value={c.id}>{classOption(c)}</option>)}
              </select>
              <button className="btn sm" disabled={!allClass} onClick={() => { const ids = new Set(shown.map((r) => r.id)); setRows((x) => x.map((r) => (ids.has(r.id) ? { ...r, classId: allClass } : r))); }}>Set</button>
            </span>
            <span className="muted small">{shown.length} of {rows.length} in {current?.label}</span>
          </div>
          <Panel flush>
            {!rows.length ? <Empty>No students in {current?.label}.</Empty> : (
              <div className="tw"><table className="stafftable bulkgrid">
                <thead><tr><th className="sn">S/N</th><th>Adm. No.</th><th>First name</th><th>Middle name</th><th>Last name</th><th>Sex</th><th>Day / Boarding</th><th>Class</th><th>Guardians (full names · phone · relationship)</th></tr></thead>
                <tbody>
                  {shown.map((r, i) => {
                    const was = before.get(r.id);
                    const ch = isChanged(r, was);
                    const bad = problems[r.id];
                    return (
                      <tr key={r.id} className={bad ? 'bad' : ch ? 'changed' : ''}>
                        <td className="sn">{i + 1}{ch && <div><button className="linkbtn small" title="Undo the changes on this row" onClick={() => setRows((x) => x.map((y) => (y.id === r.id ? was : y)))}>undo</button></div>}</td>
                        <td><input className="mono nm" value={r.admissionNo} onChange={(e) => set(r.id, 'admissionNo', e.target.value)} aria-label="Admission No." /></td>
                        <td><input className="nm" value={r.firstName} onChange={(e) => set(r.id, 'firstName', e.target.value)} aria-label="First name" /></td>
                        <td><input className="nm" value={r.middleName} onChange={(e) => set(r.id, 'middleName', e.target.value)} aria-label="Middle name" /></td>
                        <td><input className="nm" value={r.lastName} onChange={(e) => set(r.id, 'lastName', e.target.value)} aria-label="Last name" /></td>
                        <td><select className="sx" value={r.sex} onChange={(e) => set(r.id, 'sex', e.target.value)} aria-label="Sex"><option value="M">Boy</option><option value="F">Girl</option></select></td>
                        <td><select className="sx" value={r.residence} onChange={(e) => set(r.id, 'residence', e.target.value)} aria-label="Day or boarding"><option value="">Not set</option><option value="day">Day</option><option value="boarding">Boarding</option></select></td>
                        <td><select className="cl" value={r.classId} onChange={(e) => set(r.id, 'classId', e.target.value)} aria-label="Class">{classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></td>
                        <td>
                          <GuardiansEditor compact value={r.guardians} onChange={(v) => set(r.id, 'guardians', v)} />
                          {bad && <div className="err small" role="alert">{bad.join(' ')}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )}
          </Panel>
          <div className="bulkbar">
            <b>{changed.length ? `${changed.length} student${changed.length === 1 ? '' : 's'} changed` : 'No changes yet'}</b>
            <ErrorNote error={error} />
            <span className="grow" />
            <button className="btn" disabled={!dirty || busy} onClick={() => { setRows(saved.rows); setProblems({}); setError(''); }}>Undo all</button>
            <button className="btn p" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : `Save ${changed.length || ''} change${changed.length === 1 ? '' : 's'}`}</button>
          </div>
        </>
      )}
    </>
  );
}

// Bulk edit with Excel: download, change in Excel, upload back. The review page shows every change before saving.
function ExcelEdit({ school, cls, label }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (file) => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/students/imports?school=${school}&class=many`, { method: 'POST', credentials: 'include', headers: { 'X-File-Name': encodeURIComponent(file.name).slice(0, 200) }, body: file });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Upload failed.');
      navigate(`/students/review/${d.id}`);
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Panel title="Edit in Excel" sub="For big changes: download, change in Excel, upload back">
      <div className="row">
        <span className="small muted">1.</span>
        {cls && <ExcelButton href={`/api/students/export.xlsx?school=${school}&class=${cls}`} label={`Download ${label || 'this class'}`} />}
        <ExcelButton href={`/api/students/export.xlsx?school=${school}`} label="Download all classes" />
        <ExcelButton href={`/api/students/export.xlsx?school=${school}&status=left`} label="Download students who left" />
        <span className="small muted">2. In Excel you can change names, sex, Day or Boarding, class (Class column), status (Active / Left) and guardians. Leave a cell empty to keep what is saved.</span>
        <span className="small muted">3.</span>
        <label className={`btn${busy ? ' off' : ''}`} style={{ flexDirection: 'row' }}>
          <input type="file" hidden disabled={busy} accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => send(e.target.files[0])} />
          <Icon name="upload" /> {busy ? 'Checking the file…' : 'Upload the changed file'}
        </label>
      </div>
      <p className="small muted" style={{ margin: '8px 0 0' }}>A review page opens first: every change is listed, mistakes are red, and nothing is saved until you press Approve. Empty cells never erase; write - in Middle name to erase it.</p>
      <ErrorNote error={error} />
    </Panel>
  );
}
