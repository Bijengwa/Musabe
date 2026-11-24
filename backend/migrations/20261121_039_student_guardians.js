// Guardians of a student: full name, phone, relationship (any number per student).
// Migration 025 had a table with the same name for parents' app links (student_id, parent_id, relation).
// If that old table is still here, its links are kept as guardians and the table gets the new shape.
// Safe to run on a database where this migration already ran.
async function create(knex) {
  await knex.schema.createTable('student_guardians', (t) => {
    t.increments('id');
    t.integer('student_id').notNullable().references('id').inTable('students').onDelete('CASCADE');
    t.integer('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.string('full_name', 120).notNullable();
    t.string('phone', 10).notNullable();
    t.string('relationship', 20).notNullable();
    t.boolean('verified').notNullable().defaultTo(false);
    t.string('verification_method', 120);
    t.string('verification_note', 300);
    t.integer('verified_by').references('id').inTable('users');
    t.timestamp('verified_at', { useTz: true });
    t.integer('created_by').notNullable().references('id').inTable('users');
    t.integer('updated_by').references('id').inTable('users');
    t.timestamps(true, true);
    t.index(['student_id']);
  });
  await knex.raw(`ALTER TABLE student_guardians ADD CONSTRAINT student_guardians_phone_chk CHECK (phone ~ '^0[67][0-9]{8}$')`);
  await knex.raw(`ALTER TABLE student_guardians ADD CONSTRAINT student_guardians_relationship_chk CHECK (relationship IN ('mother','father','brother','sister','guardian','other'))`);
  await knex.raw(`ALTER TABLE student_guardians ADD CONSTRAINT student_guardians_verified_chk CHECK ((verified = false) OR (verified = true AND verified_by IS NOT NULL AND verified_at IS NOT NULL))`);
}

exports.up = async (knex) => {
  if (await knex.schema.hasTable('student_guardians')) {
    if (await knex.schema.hasColumn('student_guardians', 'full_name')) return; // already the new shape
    const old = await knex('student_guardians as g').join('parents as p', 'p.id', 'g.parent_id').join('students as s', 's.id', 'g.student_id')
      .where('g.active', true).select('g.student_id', 's.school_id', 'p.full_name', 'p.phone', 'g.relation', 'g.added_by', 'g.added_at');
    await knex.schema.dropTable('student_guardians');
    await create(knex);
    for (const o of old) {
      await knex('student_guardians').insert({ student_id: o.student_id, school_id: o.school_id, full_name: (o.full_name || 'NAME NOT GIVEN').slice(0, 120),
        phone: o.phone, relationship: ['mother', 'father', 'guardian'].includes(o.relation) ? o.relation : 'guardian', created_by: o.added_by, created_at: o.added_at });
    }
    return;
  }
  await create(knex);
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('student_guardians');
};
