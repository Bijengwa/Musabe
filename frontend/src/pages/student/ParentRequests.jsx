// Requests from the parents' app: "my child does not show in the app".
// The School Admin finds the student and links the parent, or answers why not (the parent reads the answer in the app).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useLive } from '../../live';
import { Empty, ErrorNote, Modal, PageHead, Panel, useToast, Loading } from '../../components/ui';
import { useStudentSchool } from './shared';

const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export default function ParentRequests() {
  const { can, user } = useAuth();
  const edit = can('students', 'f');
  const toast = useToast();
  const school = useStudentSchool();
  const [status, setStatus] = useState('pending');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reject, setReject] = useState(null);
  const reload = useCallback(() => {
    const q = new URLSearchParams({ status });
    if (user.scope === 'all' && school) q.set('school', school);
    api.get(`/parent-requests?${q}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  }, [status, school, user.scope]);
  useEffect(() => { reload(); }, [reload]);
  useLive(['parent'], reload);

  const link = async (r, s) => {
    try { const x = await api.post(`/parent-requests/${r.id}/link`, { studentId: s.id }); toast(`${r.parentPhone} can now see ${s.fullName} (${x.how})`); reload(); }
    catch (e) { toast(e.message); }
  };

  return (
    <>
      <PageHead title="Parents' app requests"
        sub="A parent signs in to the parents' app with the phone number on the student's record. When a child does not show, the parent asks here. Check the student and link the parent, or answer why not." />
      <div className="row" style={{ gap: 8 }}>
        {['pending', 'done', 'rejected'].map((s) => (
          <button key={s} className={`btn sm${status === s ? ' p' : ''}`} onClick={() => setStatus(s)}>
            {s === 'pending' ? `Waiting${data?.pending ? ` (${data.pending})` : ''}` : s === 'done' ? 'Linked' : 'Turned down'}
          </button>
        ))}
      </div>
      <ErrorNote error={error} />
      <Panel flush>
        {!data ? <Loading /> : !data.requests.length ? <Empty>{status === 'pending' ? 'No requests waiting.' : 'Nothing here yet.'}</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th>Asked</th><th>Parent</th><th>Child asked for</th><th>School</th><th>{status === 'pending' ? 'Students that match' : 'Answer'}</th></tr></thead>
            <tbody>{data.requests.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{when(r.at)}</td>
                <td><b>{r.parentName || '—'}</b><div className="small mono">{r.parentPhone}</div><div className="small muted">{r.relationLabel}</div></td>
                <td><b>{r.childName}</b><div className="small muted">{[r.admissionNo && `Adm. ${r.admissionNo}`, r.className].filter(Boolean).join(' · ')}</div>
                  {r.note && <div className="small">“{r.note}”</div>}</td>
                <td>{r.school}</td>
                <td>{status === 'pending' ? (
                  <div className="stack" style={{ gap: 6 }}>
                    {!r.matches.length && <span className="small muted">No student matches the name or Adm. No. Check the spelling with the parent.</span>}
                    {r.matches.map((s) => (
                      <div key={s.id} className="row nowrap" style={{ gap: 8, justifyContent: 'space-between' }}>
                        <span><b>{s.fullName}</b> <span className="small muted">{s.admissionNo} · {s.class || 'no class'}{s.status === 'left' ? ' · left' : ''}</span>
                          <div className="small muted">Guardians on record: {s.guardians?.length ? s.guardians.map((g) => `${g.fullName} (${g.relationshipLabel}, ${g.phone})`).join(', ') : 'none'}</div></span>
                        {edit && <button className="btn sm p" onClick={() => link(r, s)}>{s.guardians?.some((g) => g.phone === r.parentPhone) ? 'Link' : 'Add as guardian'}</button>}
                      </div>
                    ))}
                    {edit && <div><button className="btn sm danger" onClick={() => setReject(r)}>Turn down</button></div>}
                  </div>
                ) : (
                  <span>{r.status === 'done' ? <>Linked to <b>{r.student}</b></> : r.answer}<div className="small muted">{r.decidedBy} · {when(r.decidedAt)}</div></span>
                )}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      <p className="small muted" style={{ margin: 0 }}>
        Linking never removes the guardians already on the record: this parent is added to the student's guardians with their phone and relationship.
        To change the main parent phone, edit the student.
      </p>
      {reject && <Reject r={reject} onClose={() => setReject(null)} onDone={() => { setReject(null); toast('Answer sent to the parent'); reload(); }} />}
    </>
  );
}

function Reject({ r, onClose, onDone }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.post(`/parent-requests/${r.id}/reject`, { answer }); onDone(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={`Turn down: ${r.childName}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p danger" form="prj" disabled={busy}>{busy ? 'Sending…' : 'Send answer'}</button></>}>
      <form id="prj" className="stack" onSubmit={save}>
        <label>Answer for the parent (shown in the app)
          <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={200} rows={3} required autoFocus
            placeholder="e.g. Hatuna mwanafunzi kwa jina hili. Tafadhali fika ofisini na cheti cha kuzaliwa." />
        </label>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
