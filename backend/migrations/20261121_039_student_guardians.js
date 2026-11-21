// Additional student guardians, alongside the legacy primary parent fields.
exports.up = async (knex) => {
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
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('student_guardians');
};
