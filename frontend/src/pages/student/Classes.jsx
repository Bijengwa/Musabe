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
  const navigate = useNavigate();
  const openClass = (c) => navigate(`/students/classes/${c.id}`);
  const toggle = async (c) => {
    try { await api.patch(`/students/classes/${c.id}`, { active: !c.active }); toast(`${c.label} ${c.active ? 'switched off' : 'switched on'}`); reload(); }
    catch (e) { toast(e.message); }
  };
  if (!school) return <><PageHead title="Classes" /><Panel>Choose a school at the top of the page.</Panel></>;
  const noLevel = (classes || []).filter((c) => !c.level && c.active);
  return (
    <>
      <PageHead title="Classes" sub={edit ? 'BABY CLASS to FORM FOUR is fixed. Create only streams under each fixed class.' : 'Fixed classes and streams. The Academic Master adds or changes streams.'}>
        {edit && <button className="btn p" onClick={() => setModal({})}><Icon name="plus" /> Add stream</button>}
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
                <td><b className="mono">{c.label}</b>{!c.active && <span className="pill sm">Off</span>}</td>
                <td data-l="Class">{c.name}{!c.level && <span className="pill sm warn" title="Typed by hand before the built-in list">Not from the list</span>}</td>
                <td data-l="Stream">{c.stream || <span className="muted">—</span>}</td>
                <td data-l="Curriculum">{c.curriculum ? <span className={`pill sm ${CUR_TONE[c.curriculum]}`}>{c.curriculumLabel}</span> : <span className="muted">—</span>}</td>
                <td data-l="Students" className="n"><b>{c.students}</b></td><td data-l="Boys" className="n">{c.boys}</td><td data-l="Girls" className="n">{c.girls}</td>
                {edit && <td className="acts-cell" onClick={(e) => e.stopPropagation()}><div className="row nowrap">
                  <button className="btn sm" onClick={() => setModal(c)}><Icon name="edit" /> Edit</button>
                  <button className={`btn sm${c.active ? ' danger' : ''}`} onClick={() => toggle(c)}>{c.active ? 'Switch off' : 'Switch on'}</button>
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
        const r = await api.post('/students/classes', { level, streams: list.length ? list : [''], curriculum, schoolId: Number(school) });
        onSaved(`Added ${r.classes.map((c) => c.label).join(', ')}`);
      }
    } catch (err) { setError(err.message); setBusy(false); }
  };
  const show = (st) => [lv?.shortName || cls?.shortName, st.toUpperCase()].filter(Boolean).join(' ');
  return (
    <Modal title={cls ? `Edit ${cls.label}` : 'Add stream to a fixed class'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn p" form="clsform" disabled={busy || (!level && !cls)}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="clsform" className="stack" onSubmit={save}>
        {cls?.level ? <p style={{ margin: 0 }}>Fixed class: <b>{cls.name}</b> ({cls.shortName})</p> : (
          <label>Fixed class<select value={level} onChange={(e) => pickLevel(e.target.value)} required autoFocus>
            <option value="">Choose the fixed class</option>
            {levels.map((l) => <option key={l.key} value={l.key}>{l.shortName} — {l.name}</option>)}
          </select></label>
        )}
        {cls && !cls.level && <p className="small muted" style={{ margin: 0 }}>Old/unknown class. This must be corrected to a fixed BABY CLASS–FORM FOUR level.</p>}
        <label>{cls ? 'Stream' : 'Streams'}<input value={streams} onChange={(e) => setStreams(e.target.value)} placeholder={cls ? 'Empty = no stream' : 'e.g. A, B, C  or  PINK, BLUE  (empty = one class)'} /></label>
        <label>Curriculum<select value={curriculum} onChange={(e) => setCurriculum(e.target.value)}>
          <option value="">Not set</option>{Object.entries(curricula).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select></label>
        {(lv || cls) && <p className="small muted" style={{ margin: 0 }}>Will show as <b>{(list.length ? list : ['']).map(show).join(', ')}</b></p>}
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
