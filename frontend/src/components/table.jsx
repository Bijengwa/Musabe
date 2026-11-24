/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useState } from 'react';
import { Icon } from './ui';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

// Client-side sorting + paging for lists already loaded in the browser.
//   const t = useTable(rows, { pageSize: 25, getters: { name: (u) => u.fullName } });
//   t.rows -> current page · <SortTh t={t} k="name">Name</SortTh> · <Pager t={t} />
export function useTable(rows, { pageSize = 25, getters = {}, initial } = {}) {
  const [sort, setSort] = useState(initial || null); // { key, dir: 1 | -1 }
  const [pg, setPg] = useState({ page: 0, len: -1 }); // page resets when the list changes size

  const sorted = useMemo(() => {
    if (!rows || !sort) return rows || [];
    const get = getters[sort.key] || ((r) => r[sort.key]);
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x == null || x === '') return y == null || y === '' ? 0 : 1; // empty values always last
      if (y == null || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y))) * sort.dir;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = pg.len === total ? Math.min(pg.page, pages - 1) : 0;
  const setPage = (n) => setPg({ page: n, len: total });

  return {
    rows: sorted.slice(safePage * pageSize, (safePage + 1) * pageSize),
    sort, total, pages, page: safePage, pageSize,
    setPage,
    toggle: (key) => { setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null)); setPage(0); },
  };
}

// Sortable column header: click to sort A→Z, again for Z→A, again to clear.
export function SortTh({ t, k, children }) {
  const on = t.sort?.key === k;
  return (
    <th aria-sort={on ? (t.sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`sortbtn${on ? ' on' : ''}`} onClick={() => t.toggle(k)}>
        {children}<span className="sortarrow" aria-hidden="true">{on ? (t.sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

export function Pager({ t }) {
  // Keys: ] next page, [ previous page (not while typing in a field).
  const { page, pages, setPage } = t;
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      if (e.ctrlKey || e.metaKey || e.altKey || (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) || document.querySelector('.mwrap')) return;
      if (e.key === ']' && page < pages - 1) { e.preventDefault(); setPage(page + 1); }
      else if (e.key === '[' && page > 0) { e.preventDefault(); setPage(page - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, pages, setPage]);
  if (t.total <= t.pageSize) return null;
  const from = t.page * t.pageSize + 1;
  const to = Math.min(t.total, (t.page + 1) * t.pageSize);
  return (
    <nav className="pager" aria-label="Pages">
      <span className="muted small">{from}–{to} of {t.total}</span>
      <button className="btn sm" disabled={t.page === 0} onClick={() => t.setPage(t.page - 1)}><span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}><Icon name="chev" /></span> Previous</button>
      <span className="small">Page {t.page + 1} / {t.pages}</span>
      <button className="btn sm" disabled={t.page >= t.pages - 1} onClick={() => t.setPage(t.page + 1)}>Next <Icon name="chev" /></button>
    </nav>
  );
}
