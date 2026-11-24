// Teacher on Duty (2026-11-23). A week runs Monday to Sunday and is saved by its Monday.
// The Second Master appoints one or more Teachers on Duty for each week of his school.
const TZ = 'Africa/Dar_es_Salaam';
const STATUSES = { P: 'Present', A: 'Absent', L: 'Late', S: 'Sick', R: 'Permission' };
const SESSIONS = { morning: 'Morning', evening: 'Evening', night: 'Night' };

// Today in Tanzania, as YYYY-MM-DD.
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
// Monday of the week of a YYYY-MM-DD day.
function mondayOf(day) {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Is this person a Teacher on Duty of this school on this day?
async function onDuty(db, userId, schoolId, day) {
  return !!(await db('duty_rosters').where({ user_id: userId, school_id: schoolId, week_start: mondayOf(day), active: true }).first('id'));
}

// Home "To do" lines (routes/dashboard.js).
async function dutyTodo(db, user) {
  const out = [];
  if (!user.school_id) return out;
  const day = today();
  if (await onDuty(db, user.id, user.school_id, day)) {
    const classes = await db('classes').where({ school_id: user.school_id, active: true }).whereExists(
      db('students').whereRaw('students.class_id = classes.id').where('students.status', 'active').select(db.raw('1'))).pluck('id');
    const taken = classes.length ? await db('roll_calls').whereIn('class_id', classes).where({ day, session: 'morning' }).pluck('class_id') : [];
    out.push({ n: classes.length - taken.length, label: "classes without today's morning roll call (you are Teacher on Duty)", link: '/rollcall', tone: 'warn' });
    const rep = await db('duty_reports').where({ school_id: user.school_id, day, written_by: user.id }).first('id');
    if (!rep) out.push({ n: 1, label: "duty report for today to write", link: '/duty?tab=report', tone: 'info' });
  }
  if (user.role === 'second') {
    const next = addDays(mondayOf(day), 7);
    for (const [week, label] of [[mondayOf(day), 'this week'], [next, 'next week']]) {
      const n = await db('duty_rosters').where({ school_id: user.school_id, week_start: week, active: true }).count('* as n');
      if (!Number(n[0].n)) out.push({ n: 1, label: `week without a Teacher on Duty (${label})`, link: '/duty', tone: week === next ? 'info' : 'bad' });
    }
    const [r] = await db('duty_reports').where({ school_id: user.school_id }).whereNull('seen_at').count('* as n');
    out.push({ n: Number(r.n), label: 'duty reports to read', link: '/duty?tab=report', tone: 'info' });
  }
  return out;
}

module.exports = { TZ, STATUSES, SESSIONS, today, isDate, mondayOf, addDays, onDuty, dutyTodo };
