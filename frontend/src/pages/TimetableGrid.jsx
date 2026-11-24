// Class timetable like the paper one (2026-11-24): one table for each class level with all its streams.
// The times and fixed parts (break, lunch, PE ...) are already in place; the Academic Master / Mistress only picks the
// subject in each empty box (a drop-down of that class's subjects). Times and fixed parts can be changed in "Times and fixed parts".
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../live';
import { useSchools, useScope } from '../layout/scope';
import { Empty, ErrorNote, Icon, Modal, Panel, useToast } from '../components/ui';

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const KINDS = [['lesson', 'Lesson'], ['break', 'Break'], ['lunch', 'Lunch'], ['other', 'Other (fixed)']];
const mins = (v) => (/^\d\d:\d\d$/.test(v || '') ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : null);
const overlap = (a, b) => {
  const [as, ae, bs, be] = [mins(a.starts), mins(a.ends), mins(b.starts), mins(b.ends)];
  return as != null && ae != null && bs != null && be != null ? as < be && bs < ae : a.period === b.period;
};
const ck = (c, d, p) => `${c}:${d}:${p}`;
const streamColor = (s) => { const n = String(s || '').toUpperCase(); return n.includes('YELLOW') ? '#ffff66' : n.includes('PINK') ? '#ff9be0' : n.includes('GREEN') ? '#a6e07a' : n.includes('BLUE') ? '#9dc3e6' : n.includes('RED') ? '#ff8a8c' : '#e5e7eb'; };
const bd = { border: '1px solid var(--line, #d1d5db)', padding: '3px 5px', textAlign: 'center', fontSize: 12 };

function useSchoolParam() {
  const { user } = useAuth();
  const schools = useSchools();
  const [scope] = useScope();
  return user.scope === 'all' ? scope || schools[0]?.id || '' : '';
}

// the boxes that are fixed: 'day:period' -> text
function fixedOf(layout) {
  const m = new Map();
  for (let d = 1; d <= layout.days; d++) layout.periods.forEach((p, i) => { if (p.kind !== 'lesson') m.set(`${d}:${i + 1}`, p.label); });
  for (const it of layout.items) for (let p = it.from; p <= it.to; p++) m.set(`${it.day}:${p}`, it.text);
  return m;
}

export default function TimetableGrid() {
  const toast = useToast();
  const school = useSchoolParam();
  const [year, setYear] = useState(new Date().getFullYear() + (new Date().getMonth() >= 10 ? 1 : 0));
  const [term, setTerm] = useState(1);
  const [group, setGroup] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [layout, setLayout] = useState(null);
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [cells, setCells] = useState({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null);
  const [clashList, setClashList] = useState(null);
  const [preview, setPreview] = useState(null);
  const [gen, setGen] = useState(null);
  const sp = school ? `&school=${school}` : '';

  const load = useCallback(() => api.get(`/timetable/level?year=${year}&term=${term}${group ? `&group=${group}` : ''}${sp}`).then((x) => {
    setData(x); setError('');
    if (x.layout) {
      setLayout(x.layout); setLayoutDirty(false);
      const m = {}; for (const c of x.cells) m[ck(c.classId, c.day, c.period)] = { subjectId: c.subjectId, activity: c.activity, teacherId: c.teacherId };
      setCells(m); setDirty(false);
      if (!group) setGroup(x.group.key);
    }
  }).catch((e) => setError(e.message)), [year, term, group, sp]);
  useEffect(() => { load(); }, [load]);
  useLive(['academic', 'teaching'], () => { if (!dirty && !layoutDirty) load(); });

  const subjectsOf = useMemo(() => new Map((data?.classes || []).map((c) => [c.id, new Map(c.subjects.map((s) => [s.id, s]))])), [data]);
  const tname = useMemo(() => new Map((data?.teachers || []).map((t) => [t.id, t.name])), [data]);

  // teachers in two classes at the same time (inside this level, and against the rest of the school)
  const clashKeys = useMemo(() => {
    const out = new Set(); if (!layout || !data) return out;
    const list = Object.entries(cells).filter(([, c]) => c.teacherId).map(([k, c]) => { const [classId, day, period] = k.split(':').map(Number); return { classId, day, period, teacherId: c.teacherId, ...(layout.periods[period - 1] || {}) }; });
    const ext = (data.state?.entries || []).map((e) => ({ classId: e.class_id, day: e.day, period: e.period, teacherId: e.teacher_id,
      ...(data.state.periods.find((p) => p.class_id === e.class_id && p.period === e.period) || {}) }));
    for (const a of list) for (const b of [...list, ...ext]) if (b.teacherId === a.teacherId && b.day === a.day && b.classId !== a.classId && overlap(a, b)) out.add(ck(a.classId, a.day, a.period));
    return out;
  }, [cells, layout, data]);

  const setCell = (classId, d, p, v) => { setCells((cs) => { const n = { ...cs }; if (v) n[ck(classId, d, p)] = v; else delete n[ck(classId, d, p)]; return n; }); setDirty(true); };
  const body = () => ({ schoolId: school || undefined, group: data.group.key, year, term, layout: layoutDirty ? layout : undefined,
    cells: Object.entries(cells).map(([k, c]) => { const [classId, day, period] = k.split(':').map(Number); return { classId, day, period, ...c }; }) });
  const save = async (force) => {
    setBusy(true);
    try {
      const r = await api.put('/timetable/level', { ...body(), force: force === true });
      toast(r.clashes?.length ? `Saved with ${r.clashes.length} clashes` : 'Timetable saved'); setClashList(null); load();
    } catch (e) { if (e.data?.clashes) setClashList(e.data.clashes); else toast(e.message); } finally { setBusy(false); }
  };
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/timetable/excel${school ? `?school=${school}` : ''}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Upload failed');
      setPreview({ levels: d.levels, warnings: d.warnings, more: d.moreWarnings });
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const saveLevels = async (force) => {
    setBusy(true);
    try {
      let n = 0;
      for (const lv of preview.levels) {
        await api.put('/timetable/level', { schoolId: school || undefined, group: lv.group, year, term, force: force === true, layout: lv.changedTimes ? lv.layout : undefined, cells: lv.cells }); n++;
      }
      toast(`${n} class level${n === 1 ? '' : 's'} saved`); setPreview(null); setClashList(null); load();
    } catch (e) { if (e.data?.clashes) setClashList(e.data.clashes); else toast(e.message); } finally { setBusy(false); }
  };
  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.post('/timetable/generate', { schoolId: school || undefined, year, term, classIds: data.classes.map((c) => c.id), layout: true, keep: gen.keep });
      const m = gen.keep ? { ...cells } : {};
      for (const g of r.grids) for (const c of g.cells) m[ck(g.classId, c.day, c.period)] = { subjectId: c.subjectId, activity: c.activity, teacherId: c.teacherId };
      setCells(m); setDirty(true); setGen(null);
      const miss = r.grids.reduce((a, g) => a + g.unplaced.reduce((x, u) => x + u.n, 0), 0);
      toast(miss ? `Written, but ${miss} lessons did not fit. Look, change, then Save.` : 'Written. Look, change, then Save.');
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Panel><p className="muted" style={{ margin: 0 }}>Loading…</p></Panel>;
  if (!data.groups.length) return <Panel><Empty>No classes yet. The Academic Master adds streams in Students → Classes.</Empty></Panel>;
  if (!layout) return <Panel><p className="muted" style={{ margin: 0 }}>Loading…</p></Panel>;
  const can = data.canWrite; const N = data.classes.length; const P = layout.periods.length;
  const download = `/api/timetable/template.xlsx?year=${year}&term=${term}${sp}`;
  const levelRuns = []; data.classes.forEach((c, i) => { const last = levelRuns[levelRuns.length - 1]; if (last && last.level === c.level) last.n++; else levelRuns.push({ level: c.level, name: c.levelName, first: i, n: 1 }); });
  const count = (classId, subjectId) => Object.entries(cells).filter(([k, c]) => k.startsWith(`${classId}:`) && c.subjectId === subjectId).length;

  return (
    <>
      <div className="filters">
        <select value={data.group.key} onChange={(e) => { if ((dirty || layoutDirty) && !window.confirm('You have not saved. Leave this class level?')) return; setGroup(e.target.value); }}>
          {data.groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
        </select>
        <select value={term} onChange={(e) => setTerm(Number(e.target.value))}><option value={1}>Term 1</option><option value={2}>Term 2</option></select>
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} style={{ width: 90 }} />
        <a className="btn" href={download}><Icon name="excel" />Excel</a>
        {can && <>
          <label className="btn filepick"><Icon name="upload" />Import Excel<input type="file" accept=".xlsx" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} style={{ display: 'none' }} /></label>
          <button className="btn" onClick={() => setEditor(JSON.parse(JSON.stringify(layout)))}>Times and fixed parts</button>
          <button className="btn" onClick={() => setGen({ keep: true })}>Write it for me</button>
          <button className="btn primary" disabled={busy || (!dirty && !layoutDirty)} onClick={() => save(false)}>{busy ? 'Saving…' : 'Save'}</button>
        </>}
      </div>
      {layout.isDefault && !layoutDirty && <p className="muted" style={{ margin: '6px 0' }}>These times are the school's usual times. Change them in "Times and fixed parts" if they are different.</p>}
      <Panel title={`${data.group.label} — Term ${term}, ${year}`} sub={can ? 'Choose the subject in each empty box. The times and the coloured parts are fixed.' : 'Read only.'} flush>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 120 + P * 105 }}>
            <thead><tr>{['DAY', 'CLASS', 'STREAM'].map((h) => <th key={h} style={{ ...bd, background: '#16794a', color: '#fff' }}>{h}</th>)}
              {layout.periods.map((p, i) => <th key={i} style={{ ...bd, background: '#16794a', color: '#fff', whiteSpace: 'nowrap' }}>{p.starts && p.ends ? `${p.starts}-${p.ends}` : '—'}</th>)}</tr></thead>
            <tbody>
              {Array.from({ length: layout.days }, (_, di) => di + 1).flatMap((d) => data.classes.map((c, i) => {
                const run = levelRuns.find((r) => r.first === i);
                return (
                  <tr key={`${d}-${c.id}`}>
                    {i === 0 && <td rowSpan={N} style={{ ...bd, fontWeight: 700, fontSize: 14 }}>{SHORT[d]}</td>}
                    {run && <td rowSpan={run.n} style={{ ...bd, fontWeight: 700 }}>{run.level}</td>}
                    <td style={{ ...bd, background: streamColor(c.stream), fontWeight: 700 }}>{c.stream || '—'}</td>
                    {layout.periods.map((p, pi) => {
                      const n = pi + 1;
                      if (p.kind !== 'lesson') return d === 1 && i === 0 ? <td key={n} rowSpan={layout.days * N} style={{ ...bd, background: p.kind === 'other' ? '#f8cbad' : '#bdd7ee', fontWeight: 700, fontSize: 15 }}><div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', margin: '0 auto' }}>{p.label}</div></td> : null;
                      const it = layout.items.find((x) => x.day === d && x.from <= n && n <= x.to);
                      if (it) return n === it.from && i === 0 ? <td key={n} colSpan={it.to - it.from + 1} rowSpan={N} style={{ ...bd, background: '#f8cbad', fontWeight: 700, fontSize: 14 }}>{it.text}</td> : null;
                      const cell = cells[ck(c.id, d, n)]; const bad = clashKeys.has(ck(c.id, d, n));
                      const val = cell ? (cell.subjectId ? `s:${cell.subjectId}` : `a:${cell.activity}`) : '';
                      return (
                        <td key={n} style={{ ...bd, background: bad ? '#fee2e2' : undefined, minWidth: 96 }} title={bad ? 'This teacher is in another class at the same time.' : undefined}>
                          {can ? (
                            <select value={val} style={{ width: '100%', fontSize: 12 }} onChange={(e) => {
                              const v = e.target.value; if (!v) return setCell(c.id, d, n, null);
                              if (v.startsWith('a:')) return;
                              const s = subjectsOf.get(c.id)?.get(Number(v.slice(2))); setCell(c.id, d, n, { subjectId: s.id, teacherId: s.teacherId || null, activity: null });
                            }}>
                              <option value="" />
                              {cell && !cell.subjectId && <option value={val}>{cell.activity}</option>}
                              {c.subjects.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.short}</option>)}
                            </select>
                          ) : <strong>{cell ? (cell.subjectId ? subjectsOf.get(c.id)?.get(cell.subjectId)?.short : cell.activity) : ''}</strong>}
                          {cell?.teacherId && <div className="muted" style={{ fontSize: 10.5 }}>{tname.get(cell.teacherId) || ''}</div>}
                        </td>
                      );
                    })}
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      </Panel>

      {levelRuns.map((r) => {
        const cls = data.classes.slice(r.first, r.first + r.n); const subs = cls[0].subjects;
        return (
          <Panel key={r.level} title={`${r.name} (${r.level}) — number of lessons per subject`} flush>
            <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse' }}>
              <thead><tr><th style={{ ...bd, background: '#16794a', color: '#fff' }}>STREAM</th>{subs.map((s) => <th key={s.id} style={{ ...bd, background: '#16794a', color: '#fff' }}>{s.short}</th>)}</tr></thead>
              <tbody>
                {cls.map((c) => <tr key={c.id}><td style={{ ...bd, background: streamColor(c.stream), fontWeight: 700 }}>{c.stream || r.level}</td>{subs.map((s) => <td key={s.id} style={bd}>{count(c.id, s.id)}</td>)}</tr>)}
                <tr><td style={{ ...bd, fontWeight: 700 }}>TOTAL</td>{subs.map((s) => <td key={s.id} style={{ ...bd, fontWeight: 700 }}>{cls.reduce((a, c) => a + count(c.id, s.id), 0)}</td>)}</tr>
              </tbody>
            </table></div>
          </Panel>
        );
      })}

      {clashList && <Modal title="Teacher clashes" onClose={() => setClashList(null)}>
        <p>A teacher is in two classes at the same time:</p>
        <ul>{clashList.slice(0, 20).map((c, i) => <li key={i}>{c.teacher}: {c.dayName}, {c.a.className} period {c.a.period} and {c.b.className} period {c.b.period}</li>)}</ul>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => setClashList(null)}>Go back and change</button>
          <button className="btn primary" disabled={busy} onClick={() => (preview ? saveLevels(true) : save(true))}>Save anyway</button>
        </div>
      </Modal>}

      {gen && <Modal title="Write it for me" onClose={() => setGen(null)}>
        <p>The system fills the empty boxes of {data.group.label} from the subjects of each class. The fixed parts stay. A teacher is never put in two classes at once. Nothing is saved until you press Save.</p>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={gen.keep} onChange={(e) => setGen({ ...gen, keep: e.target.checked })} /> Keep what is already written; fill only the empty boxes</label>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn" onClick={() => setGen(null)}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={generate}>{busy ? 'Writing…' : 'Write'}</button>
        </div>
      </Modal>}

      {preview && !clashList && <Modal title="Excel read" onClose={() => setPreview(null)}>
        <ul>{preview.levels.map((lv) => <li key={lv.group}>{lv.label}: {lv.cells.length} boxes{lv.changedTimes ? ', times changed' : ''}</li>)}</ul>
        {preview.warnings.length > 0 && <><p className="muted">Look at these:</p><ul style={{ maxHeight: 180, overflow: 'auto', fontSize: 12.5 }}>{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}{preview.more > 0 && <li>…and {preview.more} more</li>}</ul></>}
        <p className="muted">This replaces the boxes of these class levels for Term {term}, {year}.</p>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => setPreview(null)}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={() => saveLevels(false)}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </Modal>}

      {editor && <LayoutEditor value={editor} onClose={() => setEditor(null)} onApply={(v) => { setLayout({ ...v, isDefault: false }); setLayoutDirty(true); setEditor(null); toast('Changed. Press Save to keep it.'); }} />}
    </>
  );
}

function LayoutEditor({ value, onClose, onApply }) {
  const [v, setV] = useState(value);
  const setP = (i, patch) => setV({ ...v, periods: v.periods.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const setI = (i, patch) => setV({ ...v, items: v.items.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const num = { width: 62 };
  return (
    <Modal title="Times and fixed parts" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>This is for the whole class level. Fixed periods (break, lunch ...) are the same on every day. "Fixed parts on a day" are things like PE on Wednesday.</p>
      <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={v.days === 6} onChange={(e) => setV({ ...v, days: e.target.checked ? 6 : 5, items: v.items.filter((it) => it.day <= (e.target.checked ? 6 : 5)) })} /> Saturday is a school day</label>
      <h4>Periods</h4>
      {v.periods.map((p, i) => (
        <div key={i} className="row" style={{ gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ width: 22 }}>{i + 1}</span>
          <input type="time" value={p.starts || ''} onChange={(e) => setP(i, { starts: e.target.value || null })} style={{ width: 96 }} />
          <input type="time" value={p.ends || ''} onChange={(e) => setP(i, { ends: e.target.value || null })} style={{ width: 96 }} />
          <select value={p.kind} onChange={(e) => setP(i, { kind: e.target.value, label: e.target.value === 'lesson' ? '' : p.label || e.target.value.toUpperCase() })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {p.kind !== 'lesson' && <input value={p.label} placeholder="Name" maxLength={30} onChange={(e) => setP(i, { label: e.target.value.toUpperCase() })} style={{ width: 150 }} />}
          <button className="btn" disabled={v.periods.length < 2} onClick={() => setV({ ...v, periods: v.periods.filter((_, k) => k !== i), items: [] })} title="Remove (fixed parts on a day are cleared)">✕</button>
        </div>
      ))}
      <button className="btn" disabled={v.periods.length >= 14} onClick={() => setV({ ...v, periods: [...v.periods, { starts: null, ends: null, kind: 'lesson', label: '' }] })}>+ Add period</button>
      <h4>Fixed parts on a day</h4>
      {v.items.map((it, i) => (
        <div key={i} className="row" style={{ gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
          <select value={it.day} onChange={(e) => setI(i, { day: Number(e.target.value) })}>{Array.from({ length: v.days }, (_, k) => k + 1).map((d) => <option key={d} value={d}>{DAYS[d]}</option>)}</select>
          <span>period</span><input type="number" min="1" max={v.periods.length} value={it.from} onChange={(e) => setI(i, { from: Number(e.target.value) || 1 })} style={num} />
          <span>to</span><input type="number" min="1" max={v.periods.length} value={it.to} onChange={(e) => setI(i, { to: Number(e.target.value) || 1 })} style={num} />
          <input value={it.text} maxLength={30} placeholder="e.g. PE" onChange={(e) => setI(i, { text: e.target.value.toUpperCase() })} style={{ width: 130 }} />
          <button className="btn" onClick={() => setV({ ...v, items: v.items.filter((_, k) => k !== i) })}>✕</button>
        </div>
      ))}
      <button className="btn" onClick={() => setV({ ...v, items: [...v.items, { day: 1, from: 1, to: 1, text: '' }] })}>+ Add fixed part</button>
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => onApply({ days: v.days, periods: v.periods, items: v.items.filter((it) => it.text) })}>Use these</button>
      </div>
    </Modal>
  );
}
