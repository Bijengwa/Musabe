// Notices for the parents' mobile app (to be built): what their child received from the library, paid for, returned.
// Written in the same transaction as the action, so a notice exists only if the action was saved.
// The app will read parent_notices for the children of the parent, and set sent_at when delivered.
async function notice(trx, { studentId, schoolId, kind, title, body, ref = null }) {
  if (!studentId) return;
  await trx('parent_notices').insert({ student_id: studentId, school_id: schoolId, kind, title: String(title).slice(0, 120), body: String(body).slice(0, 500), ref });
}
module.exports = { notice };
