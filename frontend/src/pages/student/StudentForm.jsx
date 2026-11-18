// The student form: used by "Add student" (a page) and "Edit" (on the student's page).
// While a new name is typed, students with a similar name are shown, so nobody is added twice.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { ErrorNote, Icon, PhoneInput, phoneProblem } from '../../components/ui';
import { classOption } from './shared';

const EMPTY = { admissionNo: '', firstName: '', middleName: '', lastName: '', sex: '', classId: '', parentName: '', parentPhone: '', note: '' };

export default function StudentForm({ student, classes, school, defaultClass, id = 'stform', onSaved, onBusy }) {
  const s = student;
  const [f, setF] = useState(() => (s ? {
    admissionNo: s.admissionNo, firstName: s.firstName, middleName: s.middleName || '', lastName: s.lastName,
    sex: s.sex, classId: String(s.classId || ''), parentName: s.parentName || '', parentPhone: s.parentPhone || '', note: s.note || '',
  } : { ...EMPTY, classId: defaultClass || '' }));
  const [error, setError] = useState('');
  const [found, setFound] = useState({ probe: '', list: [] });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const full = [f.firstName, f.middleName, f.lastName].map((x) => x.trim().toUpperCase()).filter(Boolean).join(' ');

  // Similar names already saved (new students only).
  const probe = [f.firstName, f.lastName].map((x) => x.trim()).filter(Boolean).join(' ');
  const look = !s && probe.length >= 4 && !!f.firstName.trim() && !!f.lastName.trim();
  useEffect(() => {
    if (!look) return undefined;
    const t = setTimeout(() => api.get(`/students/search?school=${school}&q=${encodeURIComponent(probe)}`).then((d) => setFound({ probe, list: d.students })).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [probe, look, school]);
  const twins = look && found.probe === probe ? found.list : [];

  const save = async (e) => {
    e.preventDefault(); setError('');
    if (!f.sex) { setError('Choose Boy or Girl.'); return; }
    if (phoneProblem(f.parentPhone)) { setError(`Phone: ${phoneProblem(f.parentPhone)}`); return; }
    onBusy?.(true);
    try {
      const body = { ...f, classId: f.classId ? Number(f.classId) : null, schoolId: Number(school) };
      const r = s ? await api.patch(`/students/${s.id}`, body) : await api.post('/students', body);
      onBusy?.(false);
      onSaved(r.student, () => { setF((x) => ({ ...EMPTY, classId: x.classId })); }); // second argument: clear for the next student
    } catch (err) { setError(err.message); onBusy?.(false); }
  };

  return (
    <form id={id} className="stack" onSubmit={save}>
      <div className="fg">
        <label>First name<input value={f.firstName} onChange={(e) => set('firstName', e.target.value)} required autoFocus={!s} /></label>
        <label>Middle name<input value={f.middleName} onChange={(e) => set('middleName', e.target.value)} placeholder="If any" /></label>
        <label>Last name<input value={f.lastName} onChange={(e) => set('lastName', e.target.value)} required /></label>
      </div>
      {full && <p className="small muted" style={{ margin: 0 }}>Saved as <b>{full}</b></p>}
      {twins.length > 0 && (
        <div className="warnnote"><Icon name="alert" /><div>
          <b>Already in the system with a similar name. Is it the same student?</b>
          {twins.slice(0, 5).map((t) => <div key={t.id} className="small"><Link to={`/students/${t.id}`}>{t.fullName}</Link> · {t.className} · Adm. {t.admissionNo}</div>)}
        </div></div>
      )}
      <div className="fg">
        <label>Admission No.<input value={f.admissionNo} onChange={(e) => set('admissionNo', e.target.value)} required className="mono" /></label>
        <div className="lab">Sex<div className="seg">{[['M', 'Boy'], ['F', 'Girl']].map(([k, t]) => <button type="button" key={k} className={f.sex === k ? 'on' : ''} onClick={() => set('sex', k)}>{t}</button>)}</div></div>
      </div>
      <label>Class<select value={f.classId} onChange={(e) => set('classId', e.target.value)} required={s?.status !== 'left'}>
        <option value="">Choose class</option>{classes.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{classOption(c)}</option>)}
      </select></label>
      <div className="fg">
        <label>Parent / guardian<input value={f.parentName} onChange={(e) => set('parentName', e.target.value)} /></label>
        <label>Parent phone<PhoneInput value={f.parentPhone} onChange={(v) => set('parentPhone', v)} /></label>
      </div>
      <label>Note<input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Optional" /></label>
      <ErrorNote error={error} />
    </form>
  );
}
