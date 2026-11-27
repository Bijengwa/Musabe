// Check a class list from Excel before it is saved: every row, its mistakes (red) and warnings (yellow).
// One wrong row does not stop the whole list (2026-11-23): press "Fix" to correct that row here, "Skip" to leave it out,
// or save the good rows and leave the wrong ones out (they can be downloaded as Excel afterwards).
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Empty, ErrorNote, Icon, Kpi, Modal, PageHead, Panel, SkeletonKpis, SkeletonTable, fmtPhone, fmtWhen, useToast } from '../components/ui';
import { useClasses } from './student/shared';
import { GuardiansEditor } from './student/guardians';
import { emptyGuardian, guardianProblems, guardiansBody } from './student/guardianRules';

const TONE = { New: 'info', Update: 'warn', Move: 'warn', 'Back at school': 'warn', 'Left school': 'bad', 'No change': '', Skipped: '' };
const SHOW = [['all', 'All'], ['errors', 'Mistakes'], ['warnings', 'Check'], ['changes', 'Changes'], ['fixed', 'Fixed / skipped']];

export default function StudentReview() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [show, setShow] = useState('all');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(null); // the line being fixed
  const load = useCallback((first) => api.get(`/students/imports/${id}`).then((x) => { setD(x); if (first === true && x.summary?.errors) setShow('errors'); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(true); }, [load]);

  const decide = async (what, skipMistakes = false) => {
    setBusy(true); setError('');
    try {
      await api.post(`/students/imports/${id}/${what}`, { checkedShifted: checked, skipMistakes });
      toast(what === 'approve' ? `${d.summary.className} saved${skipMistakes ? `. ${d.summary.errors + (d.summary.skipped || 0)} row(s) left out: download them on Upload class list` : ''}` : 'Upload discarded');
      if (what === 'approve') { try { sessionStorage.setItem('musabe-class', d.upload.classId ? String(d.upload.classId) : ''); } catch { /* ignore */ } }
      navigate(what === 'approve' ? '/students' : '/students/upload');
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const rowAction = async (l, body, msg) => {
    setError('');
    try { await api.put(`/students/imports/${id}/rows/${l.row}`, body); toast(msg); setFixing(null); await load(); }
    catch (e) { setError(e.message); }
  };

  if (!d) return <><PageHead title="Check class list" /><ErrorNote error={error} />{!error && <><SkeletonKpis /><Panel flush><SkeletonTable rows={10} columns={6} /></Panel></>}</>;
  const { upload: u, summary: s, lines } = d;
  const done = u.status !== 'pending';
  const rows = lines.filter((l) => show === 'all' || (show === 'errors' ? l.errors.length : show === 'warnings' ? l.warnings.length
    : show === 'fixed' ? l.fixed : !l.errors.length && !l.skipped && l.change !== 'No change'));
  const edit = can('students', 'f');
  const blocked = s.errors > 0 || !s.changes || (s.shifted > 0 && !checked);
  const partial = s.errors > 0 && s.changes > 0 && !(s.shifted > 0 && !checked);

  return (
    <>
      <PageHead title={s.many ? 'Check Excel bulk edit' : `Check class list: ${u.className}`} sub={`${u.fileName} · uploaded by ${u.uploadedBy} ${fmtWhen(u.createdAt)}${s.sheet ? ` · sheet "${s.sheet}"` : ''}`}>
        <Link className="btn" to={s?.many ? '/students/upload?class=many' : '/students/upload'}>Back</Link>
      </PageHead>
      {done ? <Panel><p style={{ margin: 0 }}>This upload was {u.status} by {u.decidedBy} {fmtWhen(u.decidedAt)}.</p></Panel> : (
        <>
          <div className="kpis">
            <Kpi tone="hi" label="Rows" value={s.rows} sub={`${s.boys} boys · ${s.girls} girls`} />
            <Kpi label="New" value={s.new} />
            <Kpi label="Updated / moved" value={s.update + s.move + s.back + (s.left || 0)} sub={[s.move && `${s.move} moved to another class`, s.left && `${s.left} left school`].filter(Boolean).join(' · ') || undefined} />
            <Kpi tone={s.errors ? 'bad' : 'ok'} label="Mistakes" value={s.errors} sub={s.errors ? 'Press Fix on the row, or skip it' : s.fixed || s.skipped ? [s.fixed && `${s.fixed} fixed here`, s.skipped && `${s.skipped} skipped`].filter(Boolean).join(' · ') : 'None'} />
          </div>
          {s.shifted > 0 && (
            <div className="reviewbar bad">
              <Icon name="alert" />
              <div className="grow"><b>{s.shifted} rows look moved one row down.</b> The first guardian's name on these rows matches the student on the row above, so the <b>Sex</b> and <b>Guardian</b> columns may have slipped. Fix it in Excel and upload again.
                <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I checked the file: Sex and guardians are correct</label></div>
            </div>
          )}
          {s.otherSheets?.length > 0 && <p className="small muted" style={{ margin: 0 }}>Only the first sheet was read. Not read: {s.otherSheets.join(', ')}.</p>}
          <div className="reviewbar">
            <div className="grow">{s.errors ? <><b>{s.errors} row{s.errors === 1 ? ' has a mistake' : 's have mistakes'}.</b> No need to upload again: press <b>Fix</b> on the row to correct it here, or <b>Skip</b> it.{s.changes ? <> Or save the {s.changes} good row{s.changes === 1 ? '' : 's'} now and fix the rest later.</> : ''}</>
              : s.changes ? <>Ready: {s.changes} student{s.changes === 1 ? '' : 's'} will be saved{s.many ? ' (each in the class written on its row)' : <> in <b>{s.className}</b></>}.</> : 'Nothing to change.'}</div>
            <button className="btn" disabled={busy} onClick={() => decide('discard')}>Discard</button>
            {edit && partial && <button className="btn" disabled={busy} onClick={() => decide('approve', true)} title="The rows with mistakes are not saved; you can download them as Excel afterwards">Save {s.changes} good, leave {s.errors} out</button>}
            {edit && <button className="btn p" disabled={busy || blocked} onClick={() => decide('approve')}><Icon name="check" /> Approve</button>}
          </div>
        </>
      )}
      <ErrorNote error={error} />
      {!done && (
        <>
          <div className="filters"><div className="seg">{SHOW.map(([k, t]) => <button key={k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{t}</button>)}</div>
            <span className="muted small">{rows.length} rows</span></div>
          <Panel flush>
            {!rows.length ? <Empty>Nothing here.</Empty> : (
              <div className="tw"><table className="reviewtable">
                <thead><tr><th>Row</th><th className="stick">Name</th><th>Adm. No.</th><th>Sex</th><th>Day / Boarding</th>{s.many && <th>Class</th>}<th>Guardians</th><th>What happens</th>{edit && <th />}</tr></thead>
                <tbody>{rows.map((l) => (
                  <tr key={l.row} className={l.errors.length ? 'bad' : l.change === 'No change' || l.skipped ? 'same' : ''}>
                    <td data-l="Row">{l.row}</td>
                    <td className="stick"><b>{l.fullName || <span className="muted">(no name)</span>}</b>
                      {[...l.errors.map((t) => ['err-t', t]), ...l.warnings.map((t) => ['warn-t', t])].map(([c, t], i) => <div key={i} className={`small ${c}`}>{t}</div>)}</td>
                    <td data-l="Adm. No." className="mono">{l.admissionNo}</td>
                    <td data-l="Sex">{l.sex === 'M' ? 'Boy' : l.sex === 'F' ? 'Girl' : <span className="err-t">?</span>}</td>
                    <td data-l="Day / Boarding">{l.residence === 'day' ? 'Day' : l.residence === 'boarding' ? 'Boarding' : <span className="muted">—</span>}</td>
                    {s.many && <td data-l="Class" className="nowrap">{l.className || <span className="muted">—</span>}</td>}
                    <td data-l="Guardians" className={l.shifted ? 'warn-t' : ''}>{l.guardians?.length ? (
                      <div className="glines">{l.guardians.map((g, i) => <div key={i}><b>{g.fullName}</b> <span className="muted small">{g.relationshipLabel}</span> <span className="mono small nowrap">{fmtPhone(g.phone)}</span></div>)}</div>
                    ) : <span className="muted">—</span>}
                      {l.oldGuardians?.length > 0 && <div className="small muted">Replaces: {l.oldGuardians.join(', ')}</div>}</td>
                    <td data-l="What happens">{l.errors.length ? <span className="pill bad">Mistake</span> : <span className={`pill ${TONE[l.change]}`}>{l.change}{l.from ? ` from ${l.from}` : ''}</span>}
                      {l.diff?.length > 0 && <div className="small muted">{l.diff.join(', ')}</div>}
                      {l.fixed && !l.skipped && <div className="small muted">Fixed here</div>}</td>
                    {edit && <td className="nowrap">
                      {l.skipped ? <button className="btn sm" onClick={() => rowAction(l, { undo: true }, `Row ${l.row} is back in the list`)}>Undo skip</button> : <>
                        <button className={`btn sm${l.errors.length ? ' p' : ''}`} onClick={() => setFixing(l)}><Icon name="edit" /> Fix</button>{' '}
                        <button className="btn sm ghost" title="Leave this row out" onClick={() => rowAction(l, { skip: true }, `Row ${l.row} will be left out`)}>Skip</button>
                        {l.fixed && <button className="linkbtn small" onClick={() => rowAction(l, { undo: true }, `Row ${l.row}: back to what the file says`)}>undo fix</button>}
                      </>}
                    </td>}
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
        </>
      )}
      {fixing && <FixRow line={fixing} many={s.many} schoolId={u.schoolId} onClose={() => setFixing(null)} onSave={(body) => rowAction(fixing, body, `Row ${fixing.row} fixed`)} />}
    </>
  );
}

// Correct one row of the upload here, instead of fixing the Excel file and uploading the whole list again.
function FixRow({ line, many, schoolId, onClose, onSave }) {
  const x = line.input || {};
  const { classes } = useClasses(many ? String(schoolId) : '');
  const [f, setF] = useState({
    admissionNo: x.admissionNo || '', firstName: x.firstName || '', middleName: x.middleName || '', lastName: x.lastName || '',
    sex: /^(m|male|boy)$/i.test(String(x.sex).trim()) ? 'M' : /^(f|female|girl)$/i.test(String(x.sex).trim()) ? 'F' : '',
    residence: /^(d|day|mchana)/i.test(String(x.residence || '').trim()) ? 'day' : /^(b|boarding|boarder|bweni)/i.test(String(x.residence || '').trim()) ? 'boarding' : '',
    className: line.className || x.className || '', status: /left/i.test(x.status || '') ? 'Left' : x.status ? 'Active' : '',
    guardians: (x.guardians?.length ? x.guardians : [{}]).map((g) => ({ ...emptyGuardian(), fullName: g.fullName || '', phone: String(g.phone || '').replace(/\D/g, '').replace(/^255(?=\d{9}$)/, '0').replace(/^(?=[67]\d{8}$)/, '0'), relationship: String(g.relationship || '').toLowerCase() })),
  });
  const [problem, setProblem] = useState('');
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const save = () => {
    const p = guardianProblems(f.guardians);
    if (!f.firstName.trim() || !f.lastName.trim()) return setProblem('First and last name are needed.');
    if (!f.sex) return setProblem('Choose Boy or Girl.');
    if (p.length) return setProblem(p[0]);
    onSave({ ...f, guardians: guardiansBody(f.guardians) });
  };
  return (
    <Modal wide title={`Fix row ${line.row}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" onClick={save}>Save this row</button></>}>
      <div className="stack">
        {line.errors.length > 0 && <div className="warnnote"><Icon name="alert" /><div>{line.errors.map((t, i) => <div key={i} className="small">{t}</div>)}</div></div>}
        <p className="small muted" style={{ margin: 0 }}>The Excel file is not changed. This row is saved like this when you press Approve.</p>
        <div className="fg">
          <label>First name<input value={f.firstName} onChange={(e) => set('firstName', e.target.value)} /></label>
          <label>Middle name<input value={f.middleName} onChange={(e) => set('middleName', e.target.value)} placeholder="If any" /></label>
          <label>Last name<input value={f.lastName} onChange={(e) => set('lastName', e.target.value)} /></label>
        </div>
        <div className="fg">
          <label>Admission No.<input className="mono" value={f.admissionNo} onChange={(e) => set('admissionNo', e.target.value)} /></label>
          <div className="lab">Sex<div className="seg">{[['M', 'Boy'], ['F', 'Girl']].map(([k, t]) => <button type="button" key={k} className={f.sex === k ? 'on' : ''} onClick={() => set('sex', k)}>{t}</button>)}</div></div>
          <div className="lab">Day or boarding<div className="seg">{[['day', 'Day scholar'], ['boarding', 'Boarding']].map(([k, t]) => <button type="button" key={k} className={f.residence === k ? 'on' : ''} onClick={() => set('residence', f.residence === k ? '' : k)}>{t}</button>)}</div></div>
          {many && <label>Class<select value={f.className} onChange={(e) => set('className', e.target.value)}>
            <option value="">Choose class</option>{(classes || []).filter((c) => c.active).map((c) => <option key={c.id} value={c.label}>{c.label}</option>)}</select></label>}
          {many && <label>Status<select value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">As now</option><option>Active</option><option>Left</option></select></label>}
        </div>
        <div className="panel-subtle stack"><b>Guardians</b><GuardiansEditor value={f.guardians} onChange={(v) => set('guardians', v)} /></div>
        <ErrorNote error={problem} />
      </div>
    </Modal>
  );
}
