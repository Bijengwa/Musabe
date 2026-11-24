// Class levels built into the system (2026-11-20). The Academic Master does not type class names any more:
// he picks a level from this list and adds the streams of his school (e.g. FORM ONE + stream A, B).
// To add or rename a level, change this list (one place). `key` is saved in classes.level and never changes.
//
// curriculum: which syllabus the level follows by default. The Academic Master can change it per class
// (e.g. FORM FOUR 2027 still on the OLD curriculum, FORM ONE to THREE on the NEW one).
//   new    = shown as "2027 curriculum" (TIE 2023, "mtaala ulioboreshwa"; P1–P6, PP2, F1–F3 in 2027)
//   old    = shown as "2026 and before curriculum" (P7 and F4 in 2027: the last groups on it)
//   school = the school's own (no government syllabus, e.g. Baby Class)
// The school asked (2026-11-23) never to show the words "new" and "old": the keys stay, only the labels say the year.

const pre = [
  { key: 'BABY', name: 'BABY CLASS', short: 'BC', curriculum: 'school' },
  { key: 'PP1', name: 'PREP ONE', short: 'PP 1', curriculum: 'school' },
  { key: 'PP2', name: 'PREP TWO', short: 'PP 2', curriculum: 'new' },     // government pre-primary (1 year, age 5)
  { key: 'P1', name: 'PRIMARY ONE', short: 'P 1', curriculum: 'new' },
  { key: 'P2', name: 'PRIMARY TWO', short: 'P 2', curriculum: 'new' },
  { key: 'P3', name: 'PRIMARY THREE', short: 'P 3', curriculum: 'new' },
  { key: 'P4', name: 'PRIMARY FOUR', short: 'P 4', curriculum: 'new' },
  { key: 'P5', name: 'PRIMARY FIVE', short: 'P 5', curriculum: 'new' },
  { key: 'P6', name: 'PRIMARY SIX', short: 'P 6', curriculum: 'new' },
  { key: 'P7', name: 'PRIMARY SEVEN', short: 'P 7', curriculum: 'old' },  // Std VII is not in the new curriculum yet
];
const secondary = [
  { key: 'F1', name: 'FORM ONE', short: 'F 1', curriculum: 'new' },
  { key: 'F2', name: 'FORM TWO', short: 'F 2', curriculum: 'new' },
  { key: 'F3', name: 'FORM THREE', short: 'F 3', curriculum: 'new' },
  { key: 'F4', name: 'FORM FOUR', short: 'F 4', curriculum: 'old' },      // 2027: last group on the old curriculum
];

// Levels of each school, by schools.code. A school not listed here gets every level.
const BY_SCHOOL = { pre, boys: secondary, girls: secondary };
const ALL = [...pre, ...secondary];
const CURRICULA = { new: '2027 curriculum', old: '2026 and before curriculum', school: "School's own" };

const levelsFor = (schoolCode) => BY_SCHOOL[schoolCode] || ALL;
const levelOf = (key) => ALL.find((l) => l.key === key) || null;

// An old class typed by hand ("P 1", "F.2", "PRIMARY ONE") -> its level key, or null.
function guessLevel(c) {
  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const short = norm(c.short_name), name = norm(c.name);
  return (ALL.find((l) => norm(l.short) === short || norm(l.name) === name) || {}).key || null;
}

module.exports = { levelsFor, levelOf, guessLevel, CURRICULA, LEVEL_KEYS: ALL.map((l) => l.key) };
