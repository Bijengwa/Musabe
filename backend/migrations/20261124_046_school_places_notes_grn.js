// 046 (2026-11-24): school places (Library, School store), Issue Notes and GRNs.
// - schools.places_strict: when ON, the Librarian handles only library things and the School Store-keeper only the rest.
//   Off by default, so a school without a School Store-keeper keeps working as before.
// - issue_notes + issue_note_lines + issue_note_gives: the Second Master writes the note; the keeper of the place gives against it.
//   Numbers run per school and per place (BS/ST/ISN.0001). Nothing is deleted: a note not yet given can be cancelled with a reason.
// - grns + grn_lines: made by the system when a delivery is fully confirmed, one per place. Bursar checks, Head Master approves.
exports.up = async (knex) => {
  await knex.schema.alterTable('schools', (t) => { t.boolean('places_strict').notNullable().defaultTo(false); });

  await knex.schema.createTable('issue_notes', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.string('place', 12).notNullable();
    t.integer('seq').notNullable();
    t.string('number', 30).notNullable();
    t.string('kind', 8).notNullable();                       // receipt (uniform sold) | staff | place
    t.integer('receipt_id').references('id').inTable('receipts');
    t.string('recipient', 120);                               // staff member or place that receives
    t.string('note', 300);
    t.string('status', 10).notNullable().defaultTo('open');  // open | part | given | cancelled
    t.integer('written_by').notNullable().references('id').inTable('users');
    t.timestamp('written_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('cancelled_by').references('id').inTable('users');
    t.timestamp('cancelled_at', { useTz: true });
    t.string('cancel_reason', 200);
    t.index(['school_id', 'place', 'status']);
  });
  await knex.raw(`ALTER TABLE issue_notes ADD CONSTRAINT issue_notes_chk CHECK (place IN ('library','school_store')
    AND kind IN ('receipt','staff','place') AND status IN ('open','part','given','cancelled'))`);
  await knex.raw('CREATE UNIQUE INDEX issue_notes_seq_uq ON issue_notes (school_id, place, seq)');
  await knex.raw('CREATE UNIQUE INDEX issue_notes_number_uq ON issue_notes (number)');

  await knex.schema.createTable('issue_note_lines', (t) => {
    t.increments('id');
    t.integer('note_id').notNullable().references('id').inTable('issue_notes');
    t.integer('item_id').notNullable().references('id').inTable('items');
    t.string('item_name', 80).notNullable();
    t.integer('qty').notNullable();
    t.integer('given_qty').notNullable().defaultTo(0);
    t.integer('receipt_line_id').references('id').inTable('receipt_lines');
    t.index(['note_id']);
  });
  await knex.raw('ALTER TABLE issue_note_lines ADD CONSTRAINT issue_note_lines_chk CHECK (qty > 0 AND given_qty >= 0 AND given_qty <= qty)');

  await knex.schema.createTable('issue_note_gives', (t) => {
    t.increments('id');
    t.integer('note_id').notNullable().references('id').inTable('issue_notes');
    t.integer('line_id').notNullable().references('id').inTable('issue_note_lines');
    t.integer('qty').notNullable();
    t.string('collected_by', 120);
    t.integer('given_by').notNullable().references('id').inTable('users');
    t.timestamp('at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['note_id']);
  });
  await knex.raw('ALTER TABLE issue_note_gives ADD CONSTRAINT issue_note_gives_chk CHECK (qty > 0)');

  await knex.schema.createTable('grns', (t) => {
    t.increments('id');
    t.integer('school_id').notNullable().references('id').inTable('schools');
    t.string('place', 12).notNullable();
    t.integer('seq').notNullable();
    t.string('number', 30).notNullable();
    t.integer('delivery_id').notNullable().references('id').inTable('deliveries');
    t.string('delivery_number', 20);
    t.string('status', 10).notNullable().defaultTo('waiting');   // waiting (Bursar) | checked (Head Master) | approved | sent_back
    t.integer('prepared_by').references('id').inTable('users');
    t.timestamp('prepared_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('checked_by').references('id').inTable('users');
    t.timestamp('checked_at', { useTz: true });
    t.integer('approved_by').references('id').inTable('users');
    t.timestamp('approved_at', { useTz: true });
    t.string('back_reason', 200);
    t.index(['school_id', 'status']);
  });
  await knex.raw(`ALTER TABLE grns ADD CONSTRAINT grns_chk CHECK (place IN ('library','school_store') AND status IN ('waiting','checked','approved','sent_back'))`);
  await knex.raw('CREATE UNIQUE INDEX grns_seq_uq ON grns (school_id, place, seq)');
  await knex.raw('CREATE UNIQUE INDEX grns_delivery_place_uq ON grns (delivery_id, place)');

  await knex.schema.createTable('grn_lines', (t) => {
    t.increments('id');
    t.integer('grn_id').notNullable().references('id').inTable('grns');
    t.integer('item_id').notNullable().references('id').inTable('items');
    t.string('item_name', 80).notNullable();
    t.string('unit', 12);
    t.integer('sent_qty').notNullable();
    t.integer('received_qty').notNullable();
    t.string('note', 200);
    t.index(['grn_id']);
  });
};

exports.down = async (knex) => {
  for (const t of ['grn_lines', 'grns', 'issue_note_gives', 'issue_note_lines', 'issue_notes']) await knex.schema.dropTableIfExists(t);
  await knex.schema.alterTable('schools', (t) => t.dropColumn('places_strict'));
};
