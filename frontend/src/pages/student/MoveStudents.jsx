// Move many students at once: promote a class at the end of the year, split into streams,
// or mark leavers (e.g. P 7 after the national exam) as left school.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Empty, ErrorNote, Icon, Modal, PageHead, Panel, useToast, Loading } from '../../components/ui';
import { classOption, useClasses, useStudentSchool } from './shared';

export default function MoveStudents() {
  const { can } = useAuth();
  const toast = useToast();
  const school = useStudentSchool();
  const { classes: all, error: cErr } = useClasses(school);
  const classes = useMemo(() => (all || []).filter((c) => c.active), [all]);
  const [from, setFrom] = useState('');
  const [list, setList] = useState(null);
  const [ticked, setTicked] = useState(new Set());
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('class'); // class | left
  const [to, setTo] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!from) return;
    api.get(`/students?school=${school}&class=${from}`).then((d) => { setList({ from, rows: d.students }); setTicked(new Set(d.students.map((s) => s.id))); })
      .catch((e) => setError(e.message));
  }, [from, school]);
  useEffect(() => { load(); }, [load]);
  const rows = list?.from === from ? list.rows : null;

  const fromC = classes.find((c) => String(c.id) === from);
  const toC = classes.find((c) => String(c.id) === to);
  const shown = (rows || []).filter((s) => !q.trim() || s.fullName.includes(q.trim().toUpperCase()) || s.admissionNo.includes(q.trim().toUpperCase()));
  const n = ticked.size;
  const flip = (id) => setTicked((t) => { const x = new Set(t); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const ready = n > 0 && (mode === 'left' || (to && to !== from));
  const what = mode === 'left' ? `Mark ${n} student${n === 1 ? '' : 's'} as left school` : `Move ${n} student${n === 1 ? '' : 's'} to ${toC?.label || '…'}`;

  const run = async () => {
    setBusy(true); setError('');
    try {
      await api.post('/students/move', { ids: [...ticked], ...(mode === 'left' ? { left: true } : { classId: Number(to) }) });
      toast(mode === 'left' ? `${n} marked as left school` : `${n} moved to ${toC.label}`);
      setConfirm(false); setBusy(false); load();
    } catch (e) { setError(e.message); setBusy(false); setConfirm(false); }
  };

  if (!can('students', 'f')) return <><PageHead title="Move / promote" /><Panel>Your account can only look at students.</Panel></>;
  if (!school) return <><PageHead title="Move / promote" /><Panel>Choose a school at the top of the page.</Panel></>;
  return (
    <>
      <PageHead title="Move / promote" sub="Move a whole class (or some students) to another class, or mark leavers as left school." />
      <ErrorNote error={cErr || error} />
      <div className="sellgrid">
        <Panel title="1. Students" flush>
          <div className="filters pad">
            <select aria-label="From class" value={from} onChange={(e) => { setFrom(e.target.value); setQ(''); }}>
              <option value="">From class…</option>{classes.map((c) => <option key={c.id} value={c.id}>{classOption(c)} ({c.students})</option>)}
            </select>
            {rows && <div className="searchbox"><Icon name="search" /><input placeholder="Find a student" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
            {rows && <span className="row nowrap"><button className="linkbtn" onClick={() => setTicked(new Set(rows.map((s) => s.id)))}>Tick all</button><button className="linkbtn" onClick={() => setTicked(new Set())}>Tick none</button></span>}
          </div>
          {!from ? <Empty>Choose the class to move from.</Empty> : !rows ? <Loading /> : !rows.length ? <Empty>No students in {fromC?.label}.</Empty> : (
            <div className="list movelist">
              {shown.map((s) => (
                <label key={s.id} className="li chk">
                  <input type="checkbox" checked={ticked.has(s.id)} onChange={() => flip(s.id)} />
                  <div className="grow"><b>{s.fullName}</b><span>{s.sexLabel} · Adm. {s.admissionNo}</span></div>
                </label>
              ))}
            </div>
          )}
        </Panel>
        <div className="cartcol">
          <Panel title="2. Where to">
            <div className="stack">
              <label className="chk"><input type="radio" name="mode" checked={mode === 'class'} onChange={() => setMode('class')} /> Move to another class</label>
              {mode === 'class' && <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="To class">
                <option value="">To class…</option>{classes.filter((c) => String(c.id) !== from).map((c) => <option key={c.id} value={c.id}>{classOption(c)} ({c.students})</option>)}
              </select>}
              <label className="chk"><input type="radio" name="mode" checked={mode === 'left'} onChange={() => setMode('left')} /> Left school (finished, or moved away)</label>
              <button className="btn p big" disabled={!ready} onClick={() => setConfirm(true)}>{what}</button>
              <p className="small muted" style={{ margin: 0 }}>End of year: start from the top class. First mark the last class as left school, then move each class up one (P 6 → P 7, then P 5 → P 6 …), so no class is mixed.</p>
            </div>
          </Panel>
        </div>
      </div>
      {confirm && (
        <Modal title="Check before moving" onClose={() => setConfirm(false)}
          footer={<><button className="btn" onClick={() => setConfirm(false)}>Cancel</button><button className={`btn ${mode === 'left' ? 'danger-bg' : 'p'}`} disabled={busy} onClick={run} autoFocus>{busy ? 'Saving…' : what}</button></>}>
          <p style={{ margin: 0 }}>{n} of {rows?.length} students from <b>{fromC?.label}</b> {mode === 'left' ? <>will be marked as <b>left school</b>. Their receipts and history stay; you can bring any of them back.</> : <>will move to <b>{toC?.label}</b> ({toC?.fullName}).</>}</p>
        </Modal>
      )}
    </>
  );
}
