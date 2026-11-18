// Check a class list from Excel before it is saved: every row, its mistakes (red) and warnings (yellow).
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Empty, ErrorNote, Icon, Kpi, PageHead, Panel, fmtPhone, fmtWhen, useToast } from '../components/ui';

const TONE = { New: 'info', Update: 'warn', Move: 'warn', 'Back at school': 'warn', 'No change': '' };
const SHOW = [['all', 'All'], ['errors', 'Mistakes'], ['warnings', 'Check'], ['changes', 'Changes']];

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
  const load = useCallback(() => api.get(`/students/imports/${id}`).then((x) => { setD(x); if (x.summary?.errors) setShow('errors'); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const decide = async (what) => {
    setBusy(true); setError('');
    try {
      await api.post(`/students/imports/${id}/${what}`, { checkedShifted: checked });
      toast(what === 'approve' ? `${d.summary.className} saved` : 'Upload discarded');
      if (what === 'approve') { try { sessionStorage.setItem('musabe-class', String(d.upload.classId)); } catch { /* ignore */ } }
      navigate(what === 'approve' ? '/students' : '/students/upload');
    } catch (e) { setError(e.message); setBusy(false); }
  };

  if (!d) return <><PageHead title="Check class list" /><ErrorNote error={error} />{!error && <Empty>Checking the file…</Empty>}</>;
  const { upload: u, summary: s, lines } = d;
  const done = u.status !== 'pending';
  const rows = lines.filter((l) => show === 'all' || (show === 'errors' ? l.errors.length : show === 'warnings' ? l.warnings.length : !l.errors.length && l.change !== 'No change'));
  const blocked = s.errors > 0 || !s.changes || (s.shifted > 0 && !checked);

  return (
    <>
      <PageHead title={`Check class list: ${u.className}`} sub={`${u.fileName} · uploaded by ${u.uploadedBy} ${fmtWhen(u.createdAt)}${s.sheet ? ` · sheet "${s.sheet}"` : ''}`}>
        <Link className="btn" to="/students/upload">Back</Link>
      </PageHead>
      {done ? <Panel><p style={{ margin: 0 }}>This upload was {u.status} by {u.decidedBy} {fmtWhen(u.decidedAt)}.</p></Panel> : (
        <>
          <div className="kpis">
            <Kpi tone="hi" label="Rows" value={s.rows} sub={`${s.boys} boys · ${s.girls} girls`} />
            <Kpi label="New" value={s.new} />
            <Kpi label="Updated / moved" value={s.update + s.move + s.back} sub={s.move ? `${s.move} moved from another class` : undefined} />
            <Kpi tone={s.errors ? 'bad' : 'ok'} label="Mistakes" value={s.errors} sub={s.errors ? 'Fix in Excel, upload again' : 'None'} />
          </div>
          {s.shifted > 0 && (
            <div className="reviewbar bad">
              <Icon name="alert" />
              <div className="grow"><b>{s.shifted} rows look moved one row down.</b> The parent's name on these rows matches the student on the row above, so the <b>Sex</b> and <b>Parents name</b> columns may have slipped. Fix it in Excel and upload again.
                <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I checked the file: Sex and parents are correct</label></div>
            </div>
          )}
          {s.otherSheets?.length > 0 && <p className="small muted" style={{ margin: 0 }}>Only the first sheet was read. Not read: {s.otherSheets.join(', ')}.</p>}
          <div className="reviewbar">
            <div className="grow">{s.errors ? <>Fix the {s.errors} mistake{s.errors === 1 ? '' : 's'} in Excel, then upload the file again.</>
              : s.changes ? <>Ready: {s.changes} student{s.changes === 1 ? '' : 's'} will be saved in <b>{s.className}</b>.</> : 'Nothing to change.'}</div>
            <button className="btn" disabled={busy} onClick={() => decide('discard')}>Discard</button>
            {can('students', 'f') && <button className="btn p" disabled={busy || blocked} onClick={() => decide('approve')}><Icon name="check" /> Approve</button>}
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
                <thead><tr><th>Row</th><th className="stick">Name</th><th>Adm. No.</th><th>Sex</th><th>Parent</th><th>Phone</th><th>What happens</th></tr></thead>
                <tbody>{rows.map((l) => (
                  <tr key={l.row} className={l.errors.length ? 'bad' : l.change === 'No change' ? 'same' : ''}>
                    <td data-l="Row">{l.row}</td>
                    <td className="stick"><b>{l.fullName || <span className="muted">(no name)</span>}</b>
                      {[...l.errors.map((t) => ['err-t', t]), ...l.warnings.map((t) => ['warn-t', t])].map(([c, t], i) => <div key={i} className={`small ${c}`}>{t}</div>)}</td>
                    <td data-l="Adm. No." className="mono">{l.admissionNo}</td>
                    <td data-l="Sex">{l.sex === 'M' ? 'Boy' : l.sex === 'F' ? 'Girl' : <span className="err-t">?</span>}</td>
                    <td data-l="Parent" className={l.shifted ? 'warn-t' : ''}>{l.parentName || '—'}</td>
                    <td data-l="Phone">{l.parentPhone ? fmtPhone(l.parentPhone) : '—'}</td>
                    <td data-l="What happens">{l.errors.length ? <span className="pill bad">Mistake</span> : <span className={`pill ${TONE[l.change]}`}>{l.change}{l.from ? ` from ${l.from}` : ''}</span>}
                      {l.diff?.length > 0 && <div className="small muted">{l.diff.join(', ')}</div>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
