// The teacher's own timetable (2026-11-25): days down, times across, only the teacher's own lessons.
// A box shows the subject and the class; when the teacher has no lesson the box is empty.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useLive } from '../live';
import { Empty, ErrorNote, Panel } from '../components/ui';

const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const bd = { border: '1px solid var(--line, #d1d5db)', padding: '6px 8px', textAlign: 'center', fontSize: 13, minWidth: 96 };

export default function MyTimetable() {
  const [year, setYear] = useState(new Date().getFullYear() + (new Date().getMonth() >= 10 ? 1 : 0));
  const [term, setTerm] = useState(1);
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get(`/timetable/mine?year=${year}&term=${term}`).then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message)), [year, term]);
  useEffect(() => { load(); }, [load]);
  useLive(['academic', 'class'], load);
  const today = new Date().getDay() || 7; // 1 = Monday
  const days = d && d.cells.some((c) => c.day === 6) ? 6 : 5;
  const cellsAt = (day, slot) => (d?.cells || []).filter((c) => c.day === day && c.slot === slot.key);
  return (
    <>
      <div className="filters">
        <select value={term} onChange={(e) => setTerm(Number(e.target.value))}><option value={1}>Term 1</option><option value={2}>Term 2</option></select>
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} style={{ width: 100 }} />
        {d && <span className="muted">{d.lessons} lesson{d.lessons === 1 ? '' : 's'} a week</span>}
      </div>
      <ErrorNote error={error} />
      <Panel flush>
        {!d ? <p className="muted" style={{ margin: 12 }}>Loading…</p> : !d.lessons ? <Empty>No lessons are written for you in Term {term}, {year} yet.</Empty> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>
                <th style={{ ...bd, background: '#16794a', color: '#fff' }}>DAY</th>
                {d.slots.map((s) => <th key={s.key} style={{ ...bd, background: '#16794a', color: '#fff', whiteSpace: 'nowrap' }}>{s.starts && s.ends ? `${s.starts}–${s.ends}` : `Period ${s.period}`}</th>)}
              </tr></thead>
              <tbody>
                {Array.from({ length: days }, (_, i) => i + 1).map((day) => (
                  <tr key={day}>
                    <td style={{ ...bd, fontWeight: 700, background: day === today ? 'rgba(22,121,74,.18)' : undefined }}>{DAYS[day]}{day === today && <div className="small muted">Today</div>}</td>
                    {d.slots.map((s) => {
                      if (s.kind !== 'lesson') return day === 1 ? <td key={s.key} rowSpan={days} style={{ ...bd, minWidth: 40, background: s.kind === 'other' ? '#f8cbad' : '#bdd7ee', fontWeight: 700 }}><div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', margin: '0 auto' }}>{s.kind === 'break' ? 'BREAK' : s.kind === 'lunch' ? 'LUNCH' : ''}</div></td> : null;
                      const c = cellsAt(day, s);
                      return (
                        <td key={s.key} style={{ ...bd, background: c.length > 1 ? '#fee2e2' : c.length ? 'rgba(22,121,74,.22)' : undefined }}>
                          {c.map((x, i) => <div key={i}><b>{x.subject}</b><div className="small">{x.className}</div></div>)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
