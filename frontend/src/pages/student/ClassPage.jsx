// One class (2026-11-23): opened from Students -> Classes. Shows the subjects of the class level (names change from class
// to class, e.g. Numeracy -> Arithmetic -> Mathematics), the subject teacher of this stream and the built-in syllabus of
// each subject (main competence -> specific competence -> learning activities, with periods in the year).
// The Academic Master assigns teachers, adds, renames and switches off subjects. Everyone else only looks.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useLive } from '../../live';
import { DetailSkeleton, Empty, ErrorNote, Icon, Modal, PageHead, Panel, Skeleton, useToast } from '../../components/ui';

const CUR_TONE = { new: 'ok', old: 'warn', school: '' };
const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

export default function ClassPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);      // subject whose syllabus is open
  const [edit, setEdit] = useState(null);      // subject being edited, or {} for a new one
  const [saving, setSaving] = useState(null);  // subject id whose teacher is being saved
  const load = useCallback(() => api.get(`/class-subjects/class/${id}`).then((x) => { setD({ id, ...x }); setError(''); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  useLive(['class', 'academic'], load);

  const setTeacher = async (s, teacherId) => {
    setSaving(s.id);
    try { await api.put(`/class-subjects/class/${id}/teacher`, { subjectId: s.id, teacherId: teacherId ? Number(teacherId) : null }); toast(`${s.name}: teacher saved`); await load(); }
    catch (e) { toast(e.message); }
    finally { setSaving(null); }
  };

  if (!d || d.id !== id) return <><div className="crumbs"><Link to="/students/classes">← Classes</Link></div><ErrorNote error={error} />{!error && <DetailSkeleton />}</>;
  const c = d.class;
  const shown = d.subjects.filter((s) => s.active || d.canEdit);
  const main = shown.filter((s) => !s.parentId);
  const kids = (s) => shown.filter((k) => k.parentId === s.id);
  const withSyllabus = main.filter((s) => s.syllabus).length;
  const unassigned = shown.filter((s) => s.active && !s.teacher && !kids(s).length).length;
  const missing = main.filter((s) => s.noSyllabus === 'missing').length;
  const parts = shown.filter((s) => s.parentId).length;

  return (
    <>
      <div className="crumbs"><Link to="/students/classes">← Classes</Link></div>
      <PageHead title={c.label} sub={<>{c.fullName}{c.curriculumLabel && <> · <span className={`pill sm ${CUR_TONE[c.curriculum] || ''}`}>{c.curriculumLabel}</span></>} · {c.students} students ({c.boys} boys, {c.girls} girls)</>}>
        {d.streams.length > 1 && (
          <div className="seg" role="group" aria-label="Streams">
            {d.streams.map((s) => <button key={s.id} type="button" className={String(s.id) === String(id) ? 'on' : ''} onClick={() => navigate(`/students/classes/${s.id}`)}>{s.stream || s.label}</button>)}
          </div>
        )}
        <button className="btn" onClick={() => { try { sessionStorage.setItem('musabe-class', String(c.id)); } catch { /* ignore */ } navigate('/students'); }}><Icon name="users" /> Students</button>
      </PageHead>
      <ErrorNote error={error} />

      <Panel title={`Subjects (${main.filter((s) => s.active).length})`}
        sub={`${withSyllabus} with the built-in syllabus${parts ? ` · ${n(parts, 'part')} under ${main.filter((s) => kids(s).length).map((s) => s.shortName).join(', ')}` : ''}${d.canEdit && unassigned ? ` · ${unassigned} without a teacher in ${c.label}` : ''}`}
        right={d.canEdit && c.level && <button className="btn sm p" onClick={() => setEdit({})}><Icon name="plus" /> Add subject</button>} flush>
        {!main.length ? <Empty>No subjects for this class yet.{d.canEdit ? ' Add the subjects taught in this class.' : ''}</Empty> : (
          <div className="tw tw-full"><table className="stafftable subjtable">
            <thead><tr><th className="n">No.</th><th>Subject</th><th>Short</th><th>Syllabus</th><th>Teacher in {c.label}</th><th /></tr></thead>
            <tbody>{main.map((s, i) => [
              <SubjectRow key={s.id} no={i + 1} s={s} d={d} saving={saving} onTeacher={setTeacher} onOpen={() => setOpen(s)} onEdit={() => setEdit(s)} />,
              ...kids(s).map((k) => <SubjectRow key={k.id} part s={k} d={d} saving={saving} onTeacher={setTeacher} onOpen={() => setOpen(k)} onEdit={() => setEdit(k)} parentShort={s.shortName} />),
            ])}</tbody>
          </table></div>
        )}
      </Panel>
      <p className="small muted" style={{ margin: 0 }}>
        The subject list is the same for every stream of {c.name}; each stream has its own subject teachers.
        Syllabi are read from the official TIE syllabus books; subjects marked “School's own” have no government syllabus.
        {missing > 0 && ` The ${c.curriculumLabel} syllabus books for ${c.shortName} are not loaded yet.`}
      </p>
      <div className="help-room" aria-hidden="true" />

      {open && <SyllabusModal subject={open} cls={c} onClose={() => setOpen(null)} />}
      {edit && <SubjectForm subject={edit.id ? edit : null} cls={c} onClose={() => setEdit(null)} onSaved={(m) => { toast(m); setEdit(null); load(); }} />}
    </>
  );
}

function SubjectRow({ no, s, d, part, parentShort, saving, onTeacher, onOpen, onEdit }) {
  return (
    <tr className={s.active ? '' : 'off'}>
      <td className="n muted nocard">{part ? '' : no}</td>
      <td data-l="Subject">{part ? <span className="muted">↳ </span> : null}<b>{s.name}</b>
        {part && <span className="pill sm" title="Taught on its own, marked together on the report">part of {parentShort}</span>}
        {!s.active && <span className="pill sm">Off</span>}
        {!s.onReport && !part && <span className="pill sm" title="Not shown on the report card">not on report</span>}
      </td>
      <td data-l="Short"><span className="mono">{s.shortName || '—'}</span></td>
      <td data-l="Syllabus">{s.syllabus
        ? <button type="button" className="linkbtn" onClick={onOpen}>{n(s.topics, 'topic')} · {n(s.activities, 'activity', 'activities')}{s.periods ? ` · ${s.periods} periods/year` : ''}</button>
        : <span className="muted">{d.subjects.some((k) => k.parentId === s.id) ? 'See its parts' : s.noSyllabus === 'missing' ? 'Not loaded yet' : "School's own"}</span>}</td>
      <td data-l="Teacher">{d.subjects.some((k) => k.parentId === s.id) ? <span className="muted">By its parts</span> : d.canEdit ? (
        <select value={s.teacher?.id || ''} disabled={saving === s.id || !s.active} onChange={(e) => onTeacher(s, e.target.value)} aria-label={`Teacher for ${s.name}`}>
          <option value="">— Not assigned —</option>
          {d.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}{t.role !== 'Subject Teacher' ? ` (${t.role})` : ''}</option>)}
        </select>
      ) : (s.teacher ? s.teacher.name : <span className="muted">Not assigned</span>)}</td>
      <td className="acts-cell"><div className="row nowrap">
        {s.syllabus && <button className="btn sm" onClick={onOpen}><Icon name="book" /> Syllabus</button>}
        {d.canEdit && <button className="btn sm" onClick={onEdit}><Icon name="edit" /> Edit</button>}
      </div></td>
    </tr>
  );
}

function SyllabusModal({ subject, cls, onClose }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    api.get(`/class-subjects/subject/${subject.id}/syllabus?class=${cls.id}`).then(setD).catch((e) => setError(e.message));
  }, [subject.id, cls.id]);
  const groups = useMemo(() => {
    if (!d) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (t) => !words.length || words.every((w) => [t.text, t.main, ...t.items.map((i) => i.text)].join(' ').toLowerCase().includes(w));
    const out = [];
    for (const t of d.topics.filter(hit)) {
      let g = out.find((x) => x.no === t.mainNo);
      if (!g) out.push(g = { no: t.mainNo, text: t.main, topics: [] });
      g.topics.push(t);
    }
    return out;
  }, [d, q]);
  const total = d ? d.topics.reduce((a, t) => a + (t.periods || 0), 0) : 0;
  return (
    <Modal wide title={`${subject.name} — ${cls.shortName} syllabus`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <ErrorNote error={error} />
      {!d && !error ? <div className="stack">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} width={`${60 + (i % 3) * 12}%`} height={14} />)}</div> : d && (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>{d.syllabus?.title} · from “{d.syllabus?.source}” · {n(d.topics.length, 'topic')}{total ? ` · ${total} periods in the year` : ''}</p>
          {d.topics.length > 6 && <input type="search" placeholder="Find a topic or activity" value={q} onChange={(e) => setQ(e.target.value)} />}
          {!groups.length ? <Empty>{q ? 'Nothing matches.' : 'No topics for this class in the syllabus.'}</Empty> : groups.map((g) => (
            <section key={g.no || 'x'} className="syl-main">
              <h3>{g.no} {g.text}</h3>
              {g.topics.map((t) => (
                <div key={t.id} className="syl-topic">
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <b>{t.no} {t.text}</b>{t.periods ? <span className="pill sm">{t.periods} periods</span> : null}
                  </div>
                  {t.items.length > 0 && <ul>{t.items.map((it) => <li key={it.id}>{it.text}{it.periods && t.items.some((x) => x.id !== it.id && x.periods) ? <span className="muted"> · {it.periods} periods</span> : null}</li>)}</ul>}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}

function SubjectForm({ subject, cls, onClose, onSaved }) {
  const [name, setName] = useState(subject?.name || '');
  const [short, setShort] = useState(subject?.shortName || '');
  const [active, setActive] = useState(subject ? subject.active : true);
  const [onReport, setOnReport] = useState(subject ? subject.onReport : true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (subject) { await api.patch(`/class-subjects/subject/${subject.id}`, { name, shortName: short, active, onReport }); onSaved(`${name} saved`); }
      else { await api.post(`/class-subjects/class/${cls.id}/subjects`, { name, shortName: short }); onSaved(`${name} added to ${cls.shortName}`); }
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Modal title={subject ? `Edit ${subject.name}` : `Add a subject to ${cls.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" form="subjform" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="subjform" className="stack" onSubmit={save}>
        <div className="fg">
          <label>Subject name<input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="e.g. Religious Education" /></label>
          <label>Short name<input value={short} onChange={(e) => setShort(e.target.value.toUpperCase())} placeholder="e.g. RE" maxLength={20} /></label>
        </div>
        {subject && <>
          <label className="checkline"><input type="checkbox" checked={onReport} onChange={(e) => setOnReport(e.target.checked)} /> Show on the report card</label>
          <label className="checkline"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Taught in this class (untick to switch off)</label>
        </>}
        <p className="small muted" style={{ margin: 0 }}>This changes the subject for every stream of {cls.name}.{subject?.builtIn ? ' The built-in syllabus stays linked.' : ''}</p>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
