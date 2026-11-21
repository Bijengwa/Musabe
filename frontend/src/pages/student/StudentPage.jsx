// One student: details, what they bought, every change, and the actions (edit, move class, left school).
// Previous / Next go through the class one by one (e.g. to check a class after an upload).
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useLive } from '../../live';
import { Empty, ErrorNote, Icon, Modal, Panel, fmtPhone, fmtWhen, tsh, useToast } from '../../components/ui';
import { ReceiptModal, STATUS_TONE } from '../../components/receipt';
import StudentForm from './StudentForm';
import { IdCardPanel } from '../../components/idcard';
import { InterviewPanel } from '../Interviews';
import { classOption, useClasses } from './shared';

const RSTATUS = { waiting: 'Waiting at library', part: 'Partly given', given: 'Given' };

export default function StudentPage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const edit = can('students', 'f');
  const navigate = useNavigate();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // edit | move | left | receipt id | verify guardian
  const load = useCallback(() => api.get(`/students/${id}`).then((x) => { setD({ id, ...x }); setError(''); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  useLive(['student', 'receipt', 'give'], load);
  const { classes } = useClasses(d?.student ? String(d.student.schoolId) : '');

  // Keyboard: ← and → for previous / next student in the class.
  useEffect(() => {
    const k = (e) => {
      if (modal || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if (e.key === 'ArrowLeft' && d?.place?.prev) navigate(`/students/${d.place.prev.id}`);
      if (e.key === 'ArrowRight' && d?.place?.next) navigate(`/students/${d.place.next.id}`);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [d, modal, navigate]);

  const setStatus = async (status) => {
    try { await api.patch(`/students/${id}`, { status }); toast(status === 'left' ? 'Marked as left school' : 'Back at school'); setModal(null); load(); }
    catch (e) { toast(e.message); }
  };

  if (!d || d.id !== id) return <><div className="crumbs"><Link to="/students">← Students</Link></div><ErrorNote error={error} />{!error && <Empty>Loading…</Empty>}</>;
  const { student: s, receipts, history, place } = d;
  const spent = receipts.reduce((n, r) => n + r.total, 0);

  return (
    <>
      <div className="crumbs row" style={{ justifyContent: 'space-between' }}>
        <Link to="/students">← Students{s.className ? ` · ${s.className}` : ''}</Link>
        {place && place.of > 1 && (
          <div className="row nowrap">
            <button className="btn sm" disabled={!place.prev} onClick={() => navigate(`/students/${place.prev.id}`)} title={place.prev?.full_name}>‹ Previous</button>
            <span className="small muted">{place.index} of {place.of}{s.status === 'left' ? ' (left)' : ''}</span>
            <button className="btn sm" disabled={!place.next} onClick={() => navigate(`/students/${place.next.id}`)} title={place.next?.full_name}>Next ›</button>
          </div>
        )}
      </div>

      <div className="stuhead">
        <span className={`stuav ${s.sex === 'F' ? 'f' : 'm'}`}>{s.firstName[0]}{s.lastName[0]}</span>
        <div className="grow">
          <h1>{s.fullName}</h1>
          <div className="row">
            {s.className ? <span className="pill info" title={s.classFullName}>{s.className}</span> : <span className="pill">No class</span>}
            <span className="pill">{s.sexLabel}</span>
            <span className="pill mono">Adm. {s.admissionNo}</span>
            {s.status === 'left' ? <span className="pill bad">Left school</span> : <span className="pill ok">At school</span>}
          </div>
        </div>
        {edit && (
          <div className="row acts">
            <button className="btn" onClick={() => setModal('edit')}><Icon name="edit" /> Edit</button>
            {s.status === 'active' && <button className="btn" onClick={() => setModal('move')}><Icon name="swap" /> Move class</button>}
            {s.status === 'active'
              ? <button className="btn danger" onClick={() => setModal('left')}>Left school</button>
              : <button className="btn p" onClick={() => setStatus('active')}>Back at school</button>}
          </div>
        )}
      </div>
      <ErrorNote error={error} />

      <div className="grid2">
        <Panel title="Details">
          <div className="kvgrid">
            <span>Class</span><b>{s.classFullName ? `${s.classFullName} (${s.className})` : '—'}</b>
            <span>Parent / guardian</span><b>{s.parentName || '—'}</b>
            <span>Phone</span><b>{s.parentPhone ? <a href={`tel:${s.parentPhone}`}>{fmtPhone(s.parentPhone)}</a> : '—'}</b>
            {s.note && <><span>Note</span><b>{s.note}</b></>}
            <span>Added</span><b>{s.addedFrom ? `From Excel ${s.addedFrom.fileName}, by ${s.addedFrom.by}, ${fmtWhen(s.addedFrom.at)}` : `By ${s.createdBy || '—'}, ${fmtWhen(s.createdAt)}`}</b>
            <span>Last change</span><b>{s.updatedBy ? `${s.updatedBy}, ` : ''}{fmtWhen(s.updatedAt)}</b>
          </div>
        </Panel>
        <Panel title="Receipts" sub={receipts.length ? `${receipts.length} · TSh ${tsh(spent)}` : ''} flush>
          {!receipts.length ? <Empty>Nothing bought yet.</Empty> : (
            <div className="list">
              {receipts.map((r) => (
                <button key={r.id} className="li libtn" disabled={!can('receipts')} onClick={() => setModal(r.id)}>
                  <div className="grow"><b><span className="rnum sm">{r.number}</span> · TSh {tsh(r.total)}</b><span>{r.items} · {fmtWhen(r.soldAt)}</span></div>
                  <span className={`pill ${STATUS_TONE[r.status]}`}>{RSTATUS[r.status]}</span>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Guardians" sub={d.guardians?.length ? `${d.guardians.length} recorded` : 'Primary guardian only'} flush>
        {!d.guardians?.length ? <Empty>No additional guardians recorded.</Empty> : (
          <div className="list">
            {d.guardians.map((g) => (
              <div className="li" key={g.id}>
                <div className="grow"><b>{g.fullName}</b><span>{g.relationship[0].toUpperCase() + g.relationship.slice(1)} · {g.phone ? <a href={`tel:${g.phone}`}>{fmtPhone(g.phone)}</a> : 'No phone'}</span>
                  {g.verified && <span className="small muted">Verified by {g.verifiedBy || 'school staff'} · {g.verificationMethod}{g.verificationNote ? ` · ${g.verificationNote}` : ''}</span>}
                </div>
                <div className="row"><span className={`pill ${g.verified ? 'ok' : 'bad'}`}>{g.verified ? 'Verified' : 'Not verified'}</span>
                  {!g.verified && ['sadmin', 'head', 'acad', 'teacher', 'super'].includes(user?.role) &&
                    <button type="button" className="btn sm p" onClick={() => setModal({ verifyGuardian: g })}>Verify</button>}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {s.interview && <InterviewPanel iv={s.interview} />}

      <IdCardPanel kind="student" id={s.id} />

      <Panel title="History" sub="Every change to this student" flush>
        {!history.length && !s.addedFrom ? <Empty>No changes since the student was added.</Empty> : (
          <div className="list hist">
            {history.map((h) => <div className="li" key={h.id}><Icon name="clock" /><div className="grow"><b className="fw5">{h.summary}</b><span>{h.by || 'System'} · {fmtWhen(h.at)}</span></div></div>)}
            {s.addedFrom && <div className="li"><Icon name="excel" /><div className="grow"><b className="fw5">Added from the class list {s.addedFrom.fileName}</b><span>{s.addedFrom.by} · {fmtWhen(s.addedFrom.at)}</span></div></div>}
          </div>
        )}
      </Panel>

      {modal === 'edit' && classes && (
        <EditModal s={s} classes={classes} onClose={() => setModal(null)} onSaved={(st) => { setModal(null); toast(`${st.fullName} saved`); load(); }} />
      )}
      {modal === 'move' && classes && <MoveModal s={s} classes={classes} onClose={() => setModal(null)} onDone={(to) => { setModal(null); toast(`Moved to ${to}`); load(); }} />}
      {modal === 'left' && (
        <Modal title="Left school?" onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn danger-bg" onClick={() => setStatus('left')}>Mark as left school</button></>}>
          <p style={{ margin: 0 }}><b>{s.fullName}</b> will no longer appear for the bursar or in class lists. Nothing is deleted: receipts and history stay, and you can bring the student back any time.</p>
        </Modal>
      )}
      {modal?.verifyGuardian && <VerifyGuardianModal studentId={s.id} guardian={modal.verifyGuardian} onClose={() => setModal(null)} onSaved={() => { setModal(null); toast('Guardian verified'); load(); }} />}
      {typeof modal === 'number' && <ReceiptModal id={modal} onClose={() => setModal(null)} />}
    </>
  );
}

function VerifyGuardianModal({ studentId, guardian, onClose, onSaved }) {
  const [method, setMethod] = useState('Phone call by school staff');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try { await api.patch(`/students/${studentId}/guardians/${guardian.id}/verify`, { verificationMethod: method, verificationNote: note }); onSaved(); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal title={`Verify ${guardian.fullName}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" disabled={busy || !method.trim()} onClick={save}>{busy ? 'Saving…' : 'Verify guardian'}</button></>}>
      <div className="stack">
        <label>Verification method<input value={method} onChange={(e) => setMethod(e.target.value)} required /></label>
        <label>Note<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Example: called on 0795309020 and confirmed relationship" /></label>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

function EditModal({ s, classes, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal wide title={`Edit ${s.fullName}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" form="stedit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <StudentForm id="stedit" student={s} classes={classes} school={String(s.schoolId)} onBusy={setBusy} onSaved={(st) => onSaved(st)} />
    </Modal>
  );
}

function MoveModal({ s, classes, onClose, onDone }) {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const move = async () => {
    setBusy(true); setError('');
    try { await api.post('/students/move', { ids: [s.id], classId: Number(to) }); onDone(classes.find((c) => String(c.id) === to)?.label); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal title={`Move ${s.fullName}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" disabled={!to || busy} onClick={move}>{busy ? 'Moving…' : 'Move'}</button></>}>
      <div className="stack">
        <p style={{ margin: 0 }}>Now in <b>{s.className || 'no class'}</b>.</p>
        <label>Move to<select value={to} onChange={(e) => setTo(e.target.value)} autoFocus>
          <option value="">Choose class</option>{classes.filter((c) => c.active && c.id !== s.classId).map((c) => <option key={c.id} value={c.id}>{classOption(c)}</option>)}
        </select></label>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
