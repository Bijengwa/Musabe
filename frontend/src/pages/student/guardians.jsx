// Guardians of a student (2026-11-23): one list, any number of guardians.
// Each guardian: full names (at least two, no titles like Mr / Mrs / Mama), phone, relationship.
// Components; the rules are in guardianRules.js.
import { PhoneInput, fmtPhone } from '../../components/ui';
import { RELATIONS, emptyGuardian, nameProblem, relLabel } from './guardianRules';

// The editor: one row per guardian, add / remove / move up.
export function GuardiansEditor({ value, onChange, compact }) {
  const set = (i, k, v) => onChange(value.map((g, n) => (n === i ? { ...g, [k]: v } : g)));
  const remove = (i) => onChange(value.filter((_, n) => n !== i));
  const up = (i) => { const x = [...value]; [x[i - 1], x[i]] = [x[i], x[i - 1]]; onChange(x); };
  return (
    <div className={`gedit${compact ? ' compact' : ''}`}>
      {value.map((g, i) => {
        const np = g.fullName ? nameProblem(g.fullName) : '';
        return (
          <div className="grow-row" key={g.key || g.id || i}>
            <span className="gnum">{i + 1}</span>
            <label className="gname">{!compact && <span>Full names</span>}
              <input value={g.fullName} placeholder="e.g. JOHN MATHIAS" onChange={(e) => set(i, 'fullName', e.target.value)}
                className={np ? 'bad' : ''} aria-invalid={!!np} aria-label={`Guardian ${i + 1} full names`} />
              {np && !compact && <span className="fieldhint">{np}</span>}
            </label>
            <label className="gphone">{!compact && <span>Phone</span>}<PhoneInput value={g.phone} onChange={(v) => set(i, 'phone', v)} /></label>
            <label className="grel">{!compact && <span>Relationship</span>}
              <select value={g.relationship} onChange={(e) => set(i, 'relationship', e.target.value)} aria-label={`Guardian ${i + 1} relationship`}>
                <option value="">Relationship…</option>{RELATIONS.map((r) => <option key={r} value={r}>{relLabel(r)}</option>)}
              </select></label>
            <span className="gacts">
              {i > 0 && <button type="button" className="btn sm ghost" title="Move up" onClick={() => up(i)}>↑</button>}
              <button type="button" className="btn sm ghost" title="Remove this guardian" onClick={() => remove(i)}>✕</button>
            </span>
            {compact && np && <span className="fieldhint gfull">{np}</span>}
          </div>
        );
      })}
      <button type="button" className="btn sm" onClick={() => onChange([...value, emptyGuardian()])}>+ Add guardian</button>
    </div>
  );
}

// Read-only: "JOHN MATHIAS · Father · 0754 123 456" one per line.
export function GuardianLines({ list, max = 99 }) {
  if (!list?.length) return <span className="pill warn sm">No guardian</span>;
  return (
    <div className="glines">
      {list.slice(0, max).map((g) => (
        <div key={g.id}><b>{g.fullName}</b> <span className="muted small">{g.relationshipLabel || relLabel(g.relationship)}</span> <span className="mono small nowrap">{fmtPhone(g.phone)}</span></div>
      ))}
      {list.length > max && <div className="muted small">+{list.length - max} more</div>}
    </div>
  );
}
