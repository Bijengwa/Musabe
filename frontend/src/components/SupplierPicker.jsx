import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Icon } from './ui';

export default function SupplierPicker({ value, supplierId, onChange, onRegister, autoFocus }) {
  const [q, setQ] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState([]);
  const box = useRef(null);

  useEffect(() => setQ(value || ''), [value]);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setList([]); setBusy(false); return; }
    let stop = false;
    setBusy(true);
    const timer = setTimeout(() => {
      api.get(`/suppliers?q=${encodeURIComponent(text)}`)
        .then((d) => { if (!stop) setList(d.suppliers || []); })
        .catch(() => { if (!stop) setList([]); })
        .finally(() => { if (!stop) setBusy(false); });
    }, 180);
    return () => { stop = true; clearTimeout(timer); };
  }, [q]);

  useEffect(() => {
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const choose = (supplier) => {
    setQ(supplier.name);
    setOpen(false);
    onChange(supplier.name, supplier.id);
  };

  const type = (e) => {
    const name = e.target.value;
    setQ(name);
    setOpen(true);
    onChange(name, null);
  };

  const register = () => {
    const name = q.trim();
    if (name.length < 3) return;
    onRegister(name);
  };

  return (
    <div className="picker" ref={box}>
      <div className="searchbox wide"><Icon name="search" />
        <input value={q} onChange={type} onFocus={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          placeholder="Type or choose a shop / supplier" autoFocus={autoFocus} autoComplete="off" role="combobox" aria-expanded={open} />
      </div>
      {open && q.trim().length >= 2 && (
        <div className="pickdrop" role="listbox">
          {busy ? <div className="pickempty">Searching…</div> : list.map((supplier) => (
            <button type="button" key={supplier.id} role="option" onClick={() => choose(supplier)}>{supplier.name}</button>
          ))}
          {!busy && !list.some((supplier) => supplier.name === q.trim().toUpperCase()) && (
            <button type="button" className="picknew" onClick={register}><Icon name="plus" /> Register “{q.trim().toUpperCase()}”</button>
          )}
        </div>
      )}
    </div>
  );
}
