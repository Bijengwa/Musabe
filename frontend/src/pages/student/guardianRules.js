// Guardians of a student (2026-11-23): rules and helpers shared by the form, the bulk editor and the lists.
// Each guardian: full names (at least two, no titles like Mr / Mrs / Mama), phone, relationship. Any number of guardians.
import { phoneProblem } from '../../components/ui';

export const RELATIONS = ['father', 'mother', 'brother', 'sister', 'grandfather', 'grandmother', 'uncle', 'aunt', 'guardian', 'other'];
export const relLabel = (r) => (r ? r[0].toUpperCase() + r.slice(1) : '');
const TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'MADAM', 'MADAME', 'SIR', 'DR', 'PROF', 'REV', 'PST', 'PASTOR', 'FR', 'SR', 'ENG', 'HON',
  'MWL', 'MWALIMU', 'MAMA', 'BABA', 'BI', 'BIBI', 'BWANA', 'MZEE', 'SHANGAZI', 'MJOMBA', 'KAKA', 'DADA', 'ANTI', 'AUNTY', 'UNCLE']);

export const emptyGuardian = () => ({ key: Math.random().toString(36).slice(2), fullName: '', phone: '', relationship: '' });
const isBlank = (g) => !g.fullName?.trim() && !g.phone && !g.relationship;

// The same checks as the server, so mistakes show while typing.
export function nameProblem(v) {
  const name = String(v || '').toUpperCase().replace(/\./g, ' ').replace(/[^A-Z' -]/g, '').replace(/\s+/g, ' ').trim();
  if (!name) return 'Write the full names.';
  if (TITLES.has(name.split(' ')[0])) return 'No titles (Mr, Mrs, Mama ...). Write the real names, e.g. JOHN MATHIAS.';
  if (name.split(' ').filter((w) => w.replace(/['-]/g, '').length >= 2).length < 2) return 'At least two names, e.g. GRACE TIBAIJUKA.';
  return '';
}
export function guardianProblems(list) {
  const out = [];
  const used = new Map();
  list.forEach((g, i) => {
    if (isBlank(g)) return;
    const n = `Guardian ${i + 1}`;
    const p = nameProblem(g.fullName); if (p) out.push(`${n}: ${p}`);
    if (!g.phone) out.push(`${n}: phone is empty.`); else if (phoneProblem(g.phone)) out.push(`${n} phone: ${phoneProblem(g.phone)}`);
    if (!g.relationship) out.push(`${n}: choose the relationship.`);
    if (g.phone && used.has(g.phone)) out.push(`${n}: same phone as guardian ${used.get(g.phone)}.`);
    if (g.phone) used.set(g.phone, i + 1);
  });
  if (!list.some((g) => !isBlank(g))) out.push('Add at least one guardian.');
  return out;
}
// What is sent to the server: blank rows dropped.
export const guardiansBody = (list) => list.filter((g) => !isBlank(g)).map(({ id, fullName, phone, relationship }) => ({ id: id ?? null, fullName, phone, relationship }));
export const fromServer = (list) => (list || []).map((g) => ({ key: `g${g.id}`, id: g.id, fullName: g.fullName, phone: g.phone || '', relationship: g.relationship, verified: g.verified }));

