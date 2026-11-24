// Fixed times and fixed parts of the class timetables (2026-11-24). These are only the STARTING layouts: the Academic
// Master / Mistress changes the times and the fixed parts (break, lunch, PE, religion ...) on the Timetable page and
// the school's own layout is then kept in the database (table timetable_layouts).
//
// Sources: the nursery timetable photo (PP1 & PP2, 2026) and NEW_TIMETABLE_JULY_2026.xlsx (P1-P7).
// A period is { starts, ends, kind, label }. kind 'lesson' takes a subject; 'break', 'lunch' and 'other' are fixed for
// every day and every stream (label is shown in the merged box). An item is a fixed part on some lesson periods of one
// day (PE on Wednesday ...): { day 1-6, from, to, text }. days = 5 (Monday-Friday) or 6 (with Saturday).

const LEVEL_ORDER = ['BABY', 'PP1', 'PP2', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'F1', 'F2', 'F3', 'F4'];
const LEVEL_NAMES = { BABY: 'Baby class', PP1: 'Prep one', PP2: 'Prep two', P1: 'Primary one', P2: 'Primary two', P3: 'Primary three', P4: 'Primary four', P5: 'Primary five', P6: 'Primary six', P7: 'Primary seven', F1: 'Form one', F2: 'Form two', F3: 'Form three', F4: 'Form four' };

// One sheet / one table for these levels together (the nursery timetable has PP1 and PP2 on one page).
const TOGETHER = [{ key: 'NURSERY', label: 'Nursery (PP1 & PP2)', levels: ['PP1', 'PP2'] }];
function groupOf(level) {
  const t = TOGETHER.find((g) => g.levels.includes(level));
  return t ? { key: t.key, label: t.label } : { key: level, label: LEVEL_NAMES[level] || level };
}
const rankOf = (level) => { const i = LEVEL_ORDER.indexOf(level); return i < 0 ? 999 : i; };

const L = (starts, ends, kind = 'lesson', label = '') => ({ starts, ends, kind, label });
const everyDay = (days, from, to, text, only) => days.filter((d) => !only || only.includes(d)).map((day) => ({ day, from, to, text }));

const NURSERY = {
  days: 5,
  periods: [L('07:20', '08:00', 'other', 'MORNING CIRCLE'), L('08:00', '09:00'), L('09:00', '10:00'), L('10:00', '11:00', 'break', 'BREAK'), L('11:00', '11:55'), L('11:55', '12:40'),
    L('12:40', '14:00', 'lunch', 'LUNCH'), L('14:00', '14:50'), L('14:50', '16:00', 'other', 'RESTING & DEPARTURE')],
  items: [{ day: 3, from: 2, to: 3, text: 'PE' }, { day: 5, from: 5, to: 6, text: 'RELIGION' }],
};
// P1, P2, P3, P5, P6
const PRIMARY = {
  days: 6,
  periods: [L('07:20', '08:00'), L('08:00', '08:55'), L('08:55', '09:50'), L('09:50', '10:30', 'break', 'BREAK'), L('10:30', '11:25'), L('11:25', '12:20'), L('12:20', '13:10'),
    L('13:10', '14:00', 'lunch', 'LUNCH'), L('14:00', '14:50'), L('14:50', '16:00'), L('16:00', '17:00')],
  items: [{ day: 1, from: 1, to: 1, text: 'ASSEMBLY' }, ...everyDay([1, 2, 3, 4, 5, 6], 1, 1, 'REVISION', [2, 3, 4, 5, 6])],
};
// P4 (boarding day)
const P4 = {
  days: 6,
  periods: [L('07:30', '08:00'), L('08:00', '09:00'), L('09:00', '10:00'), L('10:00', '10:50', 'break', 'BREAK'), L('10:50', '11:50'), L('11:50', '12:50'), L('12:50', '13:50', 'lunch', 'LUNCH'),
    L('13:50', '14:50'), L('14:50', '15:50'), L('15:50', '17:20'), L('17:20', '18:00', 'other', 'SPORTS'), L('18:00', '19:00', 'other', 'BATHING & DINNER'), L('19:00', '21:00')],
  items: [],
};
// P7
const P7 = {
  days: 6,
  periods: [L('07:30', '08:30'), L('08:30', '09:30'), L('09:30', '10:30'), L('10:30', '11:00', 'break', 'BREAK'), L('11:00', '12:00'), L('12:00', '13:00'), L('13:00', '14:00'), L('14:00', '15:00'), L('15:00', '16:00'), L('16:00', '17:00')],
  items: [],
};
// Other classes: an empty table of time, written by the Academic Master / Mistress.
const BLANK = { days: 5, periods: Array.from({ length: 8 }, () => L(null, null)), items: [] };

function defaultLayout(groupKey) {
  const src = groupKey === 'NURSERY' ? NURSERY : groupKey === 'P4' ? P4 : groupKey === 'P7' ? P7 : ['P1', 'P2', 'P3', 'P5', 'P6'].includes(groupKey) ? PRIMARY : BLANK;
  return JSON.parse(JSON.stringify(src));
}

module.exports = { LEVEL_ORDER, LEVEL_NAMES, TOGETHER, groupOf, rankOf, defaultLayout };
