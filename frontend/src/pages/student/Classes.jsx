// Classes of the school: full name + short name (PRIMARY ONE = P 1), and a stream if the school has them.
import { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Empty, ErrorNote, Icon, Modal, PageHead, Panel, useToast } from '../../components/ui';
import { useClasses, useStudentSchool } from './shared';

export default function Classes() {
  const { can } = useAuth();
  const edit = can('students', 'f');
  const toast = useToast();
  const school = useStudentSchool();
  const { classes, error, reload } = useClasses(school);
  const [modal, setModal] = useState(null);
  const toggle = async (c) => {
    try { await api.patch(`/students/classes/${c.id}`, { active: !c.active }); toast(`${c.label} ${c.active ? 'switched off' : 'switched on'}`); reload(); }
    catch (e) { toast(e.message); }
  };
  if (!school) return <><PageHead title="Classes" /><Panel>Choose a school at the top of the page.</Panel></>;
  return (
    <>
      <PageHead title="Classes" sub="Each class has a full name and a short name, e.g. PRIMARY ONE = P 1. Add a stream if the school has them.">
        {edit && <button className="btn p" onClick={() => setModal({})}><Icon name="plus" /> Add class</button>}
      </PageHead>
      <ErrorNote error={error} />
      <Panel flush>
        {!classes ? <Empty>Loading…</Empty> : !classes.length ? <Empty>No classes yet. Add one for each class (and each stream), e.g. PRIMARY ONE, short name P 1.</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th>Short</th><th>Class</th><th>Stream</th><th className="n">Students</th><th className="n">Boys</th><th className="n">Girls</th><th /></tr></thead>
            <tbody>{classes.map((c) => (
              <tr key={c.id} className={c.active ? '' : 'off'}>
                <td><b className="mono">{c.shortName}</b>{!c.active && <span className="pill sm">Off</span>}</td>
                <td data-l="Class">{c.name}</td>
                <td data-l="Stream">{c.stream || <span className="muted">—</span>}</td>
                <td data-l="Students" className="n"><b>{c.students}</b></td><td data-l="Boys" className="n">{c.boys}</td><td data-l="Girls" className="n">{c.girls}</td>
                <td className="acts-cell">{edit && <div className="row nowrap">
                  <button className="btn sm" onClick={() => setModal(c)}><Icon name="edit" /> Edit</button>
                  <button className={`btn sm${c.active ? ' danger' : ''}`} onClick={() => toggle(c)}>{c.active ? 'Switch off' : 'Switch on'}</button>
                </div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      <p className="small muted" style={{ margin: 0 }}>Classes are listed by short name (P 1, P 2 … P 7). A class with students cannot be switched off: move them first.</p>
      {modal && <ClassForm cls={modal.id ? modal : null} school={school} onClose={() => setModal(null)} onSaved={(c, more) => { toast(`${c.label} saved`); reload(); if (!more) setModal(null); }} />}
    </>
  );
}

function ClassForm({ cls, school, onClose, onSaved }) {
  const [name, setName] = useState(cls?.name || '');
  const [shortName, setShortName] = useState(cls?.shortName || '');
  const [stream, setStream] = useState(cls?.stream || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = { name, shortName, stream, schoolId: Number(school) };
      const r = cls ? await api.patch(`/students/classes/${cls.id}`, body) : await api.post('/students/classes', body);
      onSaved(r.class, more && !cls);
      if (more && !cls) { setName(''); setShortName(''); setStream(''); }
      setBusy(false);
    } catch (err) { setError(err.message); setBusy(false); }
  };
  const show = (v) => v.trim().toUpperCase();
  return (
    <Modal title={cls ? `Edit ${cls.label}` : 'Add class'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{cls ? 'Cancel' : 'Close'}</button>
        {!cls && <button className="btn" form="clsform" disabled={busy} onClick={() => setMore(true)}>Save and add another</button>}
        <button className="btn p" form="clsform" disabled={busy} onClick={() => setMore(false)}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="clsform" className="stack" onSubmit={save}>
        <div className="fg">
          <label>Class<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. PRIMARY ONE" required autoFocus /></label>
          <label>Short name<input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="e.g. P 1" required maxLength={12} /></label>
          <label>Stream<input value={stream} onChange={(e) => setStream(e.target.value)} placeholder="If any, e.g. A" /></label>
        </div>
        {(name || shortName) && <p className="small muted" style={{ margin: 0 }}>Shown as <b>{[show(shortName), show(stream)].filter(Boolean).join(' ') || '…'}</b> — {[show(name), show(stream)].filter(Boolean).join(' ')}</p>}
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
