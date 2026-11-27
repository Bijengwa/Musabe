// Delete ALL students and everything that belongs only to them (receipts of students, fee payments, marks, ID cards, photos,
// guardians, notices ...). Classes, staff, items, stock, suppliers and the B-SMART reports are kept.
// Where a table only POINTS at a student and can live without him (for example a B-SMART control number), the link is cleared.
//
// Use (in the backend folder, on a TEST database only):
//   node scripts/reset-students.js                       shows what would be deleted, deletes nothing
//   node scripts/reset-students.js --yes --db=musabe_db  deletes (the --db name must be the real database name)
// It uses the migration account (MIGRATION_DATABASE_*), all in ONE transaction: if anything fails, nothing is deleted.
// It refuses to run when NODE_ENV=production.
const knex = require('knex')(require('../knexfile'));

const args = process.argv.slice(2);
const YES = args.includes('--yes');
const DB_GIVEN = (args.find((a) => a.startsWith('--db=')) || '').slice(5);

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refused: NODE_ENV is production.');
  const dbName = (await knex.raw('select current_database() as n')).rows[0].n;
  const fks = (await knex.raw(`
    SELECT c.conrelid::regclass::text AS child, a.attname AS col, c.confrelid::regclass::text AS parent, NOT a.attnotnull AS nullable
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1`)).rows;
  const total = Number((await knex('students').count('* as n').first()).n);
  console.log(`Database: ${dbName}. Students now: ${total}.`);
  if (!YES) { console.log('Nothing deleted. To delete, run again with:  --yes --db=' + dbName); return; }
  if (DB_GIVEN !== dbName) throw new Error(`Refused: write --db=${dbName} to confirm this is the database you mean.`);

  const touched = new Set(), report = {}, done = new Set();
  await knex.transaction(async (trx) => {
    const guard = async (table) => { if (!touched.has(table)) { touched.add(table); await trx.raw(`ALTER TABLE ${table} DISABLE TRIGGER USER`); } };
    const wipe = async (table, ids) => {
      ids = ids.filter((id) => !done.has(`${table}:${id}`));
      if (!ids.length) return;
      ids.forEach((id) => done.add(`${table}:${id}`));
      await guard(table);
      for (const fk of fks.filter((f) => f.parent === table)) {
        await guard(fk.child);
        const kids = (await trx.raw(`SELECT id FROM ${fk.child} WHERE ${fk.col} = ANY(?)`, [ids])).rows.map((r) => r.id);
        if (!kids.length) continue;
        if (fk.nullable) {
          try { await trx.transaction(async (sp) => { await sp.raw(`UPDATE ${fk.child} SET ${fk.col} = NULL WHERE ${fk.col} = ANY(?)`, [ids]); }); report[`${fk.child}.${fk.col} (link cleared)`] = (report[`${fk.child}.${fk.col} (link cleared)`] || 0) + kids.length; continue; } catch { /* a rule needs the student: delete those rows */ }
        }
        await wipe(fk.child, kids);
      }
      const r = await trx.raw(`DELETE FROM ${table} WHERE id = ANY(?)`, [ids]);
      report[table] = (report[table] || 0) + r.rowCount;
    };
    const ids = (await trx('students').select('id')).map((r) => r.id);
    await wipe('students', ids);
    await trx('student_imports').del().catch(() => {});
    for (const t of touched) await trx.raw(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
  });
  console.log('Done. Rows deleted or cleared:');
  Object.entries(report).sort().forEach(([t, n]) => console.log(`  ${t}: ${n}`));
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => knex.destroy());
