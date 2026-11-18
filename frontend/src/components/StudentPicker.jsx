// Type part of a name (any order) or the admission number; the list changes as you type; pick the student.
// Used by Sell so names are never typed by hand.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Icon } from './ui';

export default function StudentPicker({ onPick, school, autoFocus, placeholder = 'Type the student\'s name or admission no.' }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef(null);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setList([]); return undefined; }
    let stop = false;
    setBusy(true);
    const t = setTimeout(() => {
      const p = new URLSearchParams({ q: text });
      if (school) p.set('school', school);
      api.get(`/students/search?${p}`).then((d) => { if (!stop) { setList(d.students); setHi(0); setOpen(true); } })
        .catch(() => {}).finally(() => { if (!stop) setBusy(false); });
    }, 180);
    return () => { stop = true; clearTimeout(t); };
  }, [q, school]);

  useEffect(() => {
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const pick = (s) => { onPick(s); setQ(''); setList([]); setOpen(false); };
  const key = (e) => {
    if (!open || !list.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); pick(list[hi]); }
    if (e.key === 'Escape') setOpen(false);
  };

  // Show the matching letters in bold, so the person sees why a name came up.
  const words = q.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const mark = (name) => name.split(' ').map((w, i) => {
    const hit = words.find((x) => w.includes(x));
    if (!hit) return <span key={i}>{w} </span>;
    const at = w.indexOf(hit);
    return <span key={i}>{w.slice(0, at)}<mark>{w.slice(at, at + hit.length)}</mark>{w.slice(at + hit.length)} </span>;
  });

  return (
    <div className="picker" ref={box}>
      <div className="searchbox wide"><Icon name="search" />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} onFocus={() => list.length && setOpen(true)}
          placeholder={placeholder} autoFocus={autoFocus} autoComplete="off" role="combobox" aria-expanded={open} aria-autocomplete="list" />
      </div>
      {open && q.trim().length >= 2 && (
        <div className="pickdrop" role="listbox">
          {busy && !list.length ? <div className="pickempty">Searching…</div>
            : !list.length ? <div className="pickempty">No student found. Check the spelling, or try the admission number.</div>
              : list.map((s, i) => (
                <button type="button" key={s.id} role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''}
                  onMouseEnter={() => setHi(i)} onClick={() => pick(s)}>
                  <b>{mark(s.fullName)}</b>
                  <span>{s.className || 'No class'} · {s.sexLabel} · Adm. {s.admissionNo}</span>
                </button>
              ))}
        </div>
      )}
    </div>
  );
}
