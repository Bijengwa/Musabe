/* eslint-disable react-refresh/only-export-components */
// A printed school paper (A4) with signature boxes: delivery note, goods received note, requisition form.
// The names and times come from the system; each person also signs by hand on the paper.
import { tsh } from './ui';

// On paper a date must be a real date, never "Today".
export const fmtDate = (v) => (v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dar_es_Salaam' }) : '');

export function Paper({ title, number, school, meta = [], columns, rows, total, totalLabel = 'Total (TSh)', totalAt, contact, signs = [], foot }) {
  return (
    <div className="paper">
      <header className="pp-head">
        <img src="/musabe-logo.png" alt="" />
        <div className="grow"><b>MUSABE SCHOOLS</b><span>{school || 'Administration office'}</span>{contact ? contact.map((c) => <span key={c}>{c}</span>) : <span>P.O. Box, Buhongwa, Mwanza</span>}</div>
        <div className="pp-no"><span>{title}</span><b>{number}</b></div>
      </header>
      <dl className="pp-meta">{meta.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <table className="pp-table">
        <thead><tr><th className="n">S/N</th>{columns.map((c) => <th key={c.key} className={c.n ? 'n' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td className="n">{i + 1}</td>{columns.map((c) => <td key={c.key} className={c.n ? 'n' : ''}>{r[c.key] ?? ''}</td>)}</tr>)}</tbody>
        {total != null && (() => {
          // The total sits under the column named by totalAt (default: a last column of its own).
          const at = columns.findIndex((c) => c.key === totalAt);
          return at < 0 ? <tfoot><tr><td colSpan={columns.length}>{totalLabel}</td><td className="n">{tsh(total)}</td></tr></tfoot>
            : <tfoot><tr><td colSpan={at + 1}>{totalLabel}</td><td className="n">{tsh(total)}</td>{columns.length - at - 1 > 0 && <td colSpan={columns.length - at - 1} />}</tr></tfoot>;
        })()}
      </table>
      <div className="pp-signs">{signs.map((s) => (
        <div className="pp-sign" key={s.role}>
          <span className="pp-role">{s.role}</span>
          <span>Name: <b>{s.name || '........................................'}</b></span>
          <span>Date: {s.at ? fmtDate(s.at) : '......................'}</span>
          {s.note && <span className="pp-note">{s.note}</span>}
          <span className="pp-line">Signature</span>
        </div>
      ))}</div>
      {foot && <p className="pp-foot">{foot}</p>}
    </div>
  );
}
