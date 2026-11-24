// Classes of the school (2026-11-20): the class names are built into the system (BABY CLASS … PRIMARY SEVEN,
// FORM ONE … FORM FOUR). The Academic Master picks a class, adds its streams and sets the curriculum.
// Everyone else with the Students page only looks.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Empty, ErrorNote, Icon, Modal, PageHead, Panel, useToast, Loading } from '../../components/ui';
import { useClasses, useStudentSchool } from './shared';

const CUR_TONE = { new: 'ok', old: 'warn', school: '' };  // new = 2027 curriculum, old = 2026 and before

export default function Classes() {
  const { can, user } = useAuth();
  const edit = can('classlist', 'f');
  const toast = useToast();
  const school = useStudentSchool();
  const { classes, levels, curricula, error, reload } = useClasses(school);
  const [modal, setModal] = useState(null);
  const [clean, setClean] = useState(false);
  const navigate = useNavigate();
  const openClass = (c) => navigate(`/students/classes/${c.id}`);
  const toggle = async (c) => {
    try { await api.patch(`/students/classes/${c.id}`, { active: !c.active }); toast(`${c.label} ${c.active ? 'switched off' : 'switched on'}`); reload(); }
    catch (e) { toast(e.message); }
  };
  if (!school) return <><PageHead title="Classes" /><Panel>Choose a school at the top of the page.</Panel></>;
  const hasStreams = (classes || []).some((c) => c.stream);
  const split = (c) => !c.active && !c.stream && c.level && (classes || []).some((x) => x.level === c.level && x.stream && x.active);
  const noLevel = (classes || []).filter((c) => !c.level && c.active);
  return (
    <>
      <PageHead title="Classes" sub={edit ? 'BABY CLASS to FORM FOUR is fixed. Open a class to create its streams (two or more).' : 'Fixed classes and streams. The Academic Master creates streams inside a class.'}>
        {edit && hasStreams && <button className="btn danger" onClick={() => setClean(true)}>Remove all streams</button>}
        {edit && <button className="btn p" onClick={() => setModal({})}><Icon name="plus" /> Add class</button>}
      </PageHead>
      <ErrorNote error={error} />
      {edit && noLevel.length > 0 && (
        <div className="warnnote"><Icon name="alert" /><span><b>{noLevel.length} unknown class record{noLevel.length === 1 ? ' exists' : 's exist'}.</b> Match it to one of the fixed BABY CLASS–FORM FOUR levels; new class names can no longer be created.</span></div>
      )}
      <Panel flush>
        {!classes ? <Loading /> : !classes.length ? <Empty>{edit ? 'No fixed classes found. Run the standard class migration first.' : 'No fixed classes yet. Ask the Academic Master to apply the standard class setup.'}</Empty> : (
          <div className="tw"><table className="stafftable">
            <thead><tr><th>Short</th><th>Class</th><th>Stream</th><th>Curriculum</th><th className="n">Students</th><th className="n">Boys</th><th className="n">Girls</th>{edit && <th />}</tr></thead>
            <tbody>{classes.map((c) => (
              <tr key={c.id} className={`clickrow${c.active ? '' : ' off'}`} tabIndex={0} title="Open: subjects, teachers and syllabus"
                onClick={() => openClass(c)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openClass(c); }}>
                <td><b className="mono">{c.label}</b>{!c.active && (split(c) ? <span className="pill sm ok">Split into streams</span> : <span className="pill sm">Off</span>)}</td>
                <td data-l="Class">{c.name}{!c.level && <span className="pill sm warn" title="Typed by hand before the built-in list">Not from the list</span>}</td>
                <td data-l="Stream">{c.stream || <span className="muted">—</span>}</td>
                <td data-l="Curriculum">{c.curriculum ? <span className={`pill sm ${CUR_TONE[c.curriculum]}`}>{c.curriculumLabel}</span> : <span className="muted">—</span>}</td>
                <td data-l="Students" className="n"><b>{c.students}</b></td><td data-l="Boys" className="n">{c.boys}</td><td data-l="Girls" className="n">{c.girls}</td>
                {edit && <td className="acts-cell" onClick={(e) => e.stopPropagation()}><div className="row nowrap">
                  <button className="btn sm" onClick={() => setModal(c)}><Icon name="edit" /> Edit</button>
                  {!split(c) && <button className={`btn sm${c.active ? ' danger' : ''}`} onClick={() => toggle(c)}>{c.active ? 'Switch off' : 'Switch on'}</button>}
                </div></td>}
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      <p className="small muted" style={{ margin: 0 }}>
        Click a class to see its subjects, subject teachers and syllabus. Classes are in school order (lowest first). A class with students cannot be switched off: move them first.
        {!edit && user.role === 'sadmin' && ' To add a stream, ask the Academic Master.'}
      </p>
      {clean && <RemoveStreams school={school} onClose={() => setClean(false)} onDone={(m) => { toast(m); setClean(false); reload(); }} />}
      {modal && <ClassForm cls={modal.id ? modal : null} classes={classes || []} levels={levels} curricula={curricula} school={school}
        onClose={() => setModal(null)} onSaved={(msg) => { toast(msg); reload(); setModal(null); }} />}
    </>
  );
}

function ClassForm({ cls, classes, levels, curricula, school, onClose, onSaved }) {
  const [level, setLevel] = useState(cls?.level || '');
  const [streams, setStreams] = useState(cls ? cls.stream || '' : '');
  const lv = levels.find((l) => l.key === level);
  const [curriculum, setCurriculum] = useState(cls?.curriculum || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const list = cls ? [streams.trim()] : streams.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
  const have = (k) => classes.filter((c) => c.level === k);
  const pickLevel = (k) => { setLevel(k); if (!cls?.curriculum) setCurriculum(levels.find((l) => l.key === k)?.curriculum || ''); };
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (cls) {
        const r = await api.patch(`/students/classes/${cls.id}`, { stream: streams, curriculum, ...(cls.level ? {} : { level }) });
        onSaved(`${r.class.label} saved`);
      } else {
        const r = await api.post('/students/classes', { level, streams: [''], curriculum, schoolId: Number(school) });
        onSaved(`Added ${r.classes.map((c) => c.label).join(', ')}`);
      }
    } catch (err) { setError(err.message); setBusy(false); }
  };
  const show = (st) => [lv?.shortName || cls?.shortName, st.toUpperCase()].filter(Boolean).join(' ');
  return (
    <Modal title={cls ? `Edit ${cls.label}` : 'Add class'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn p" form="clsform" disabled={busy || (!level && !cls)}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="clsform" className="stack" onSubmit={save}>
        {cls?.level ? <p style={{ margin: 0 }}>Fixed class: <b>{cls.name}</b> ({cls.shortName})</p> : (
          <label>Fixed class<select value={level} onChange={(e) => pickLevel(e.target.value)} required autoFocus>
            <option value="">Choose the fixed class</option>
            {levels.filter((l) => !have(l.key).some((c) => !c.stream)).map((l) => <option key={l.key} value={l.key}>{l.shortName} — {l.name}</option>)}
          </select></label>
        )}
        {cls && !cls.level && <p className="small muted" style={{ margin: 0 }}>Old/unknown class. This must be corrected to a fixed BABY CLASS–FORM FOUR level.</p>}
        {cls && <label>Stream<input value={streams} onChange={(e) => setStreams(e.target.value)} placeholder="Empty = no stream" /></label>}
        <label>Curriculum<select value={curriculum} onChange={(e) => setCurriculum(e.target.value)}>
          <option value="">Not set</option>{Object.entries(curricula).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select></label>
        {!cls && <p className="small muted" style={{ margin: 0 }}>Streams are made later, inside the class: open the class and press Create streams.</p>}
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

function RemoveStreams({ school, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true); setError('');
    try { const r = await api.post('/class-streams/remove', { all: true, schoolId: Number(school) }); onDone(`${r.removed} streams removed${r.kept ? `, ${r.kept} kept switched off (they have records)` : ''}`); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal title="Remove all streams" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn danger" disabled={busy} onClick={go}>{busy ? 'Removing…' : 'Remove all streams'}</button></>}>
      <p style={{ marginTop: 0 }}>Every stream (PINK, BLUE, YELLOW …) of every class is removed. The students go back into their class (for example P 2). Subject teachers are kept.</p>
      <p className="small muted">A stream that has records cannot be deleted. It is kept switched off.</p>
      <ErrorNote error={error} />
    </Modal>
  );
}
