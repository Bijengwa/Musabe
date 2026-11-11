// Core tables: schools, users (staff accounts), sessions, audit_log.
const { ROLES, ADMIN_ROLES, SCHOOL_ROLES } = require('../src/auth/roles');

exports.up = async (knex) => {
  await knex.schema.createTable('schools', (t) => {
    t.increments('id');
    t.string('code', 20).notNullable().unique();          // e.g. pre, boys, girls
    t.string('name', 150).notNullable().unique();
    t.string('short_name', 60).notNullable();
    t.string('levels', 60);                                // e.g. Form I–IV
    t.string('receipt_prefix', 4).notNullable().unique(); // e.g. EM, BS, GS
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('users', (t) => {
    t.increments('id');
    t.string('full_name', 120).notNullable();
    t.string('username', 60).notNullable();
    t.string('phone', 20);
    t.string('password_hash', 100).notNullable();
    t.string('role', 20).notNullable();
    t.integer('school_id').references('id').inTable('schools').onDelete('RESTRICT');
    t.boolean('active').notNullable().defaultTo(true);
    t.boolean('must_change_password').notNullable().defaultTo(true);
    t.timestamp('reset_requested_at', { useTz: true });
    t.timestamp('last_login_at', { useTz: true });
    t.integer('failed_logins').notNullable().defaultTo(0);
    t.timestamp('locked_until', { useTz: true });
    t.integer('created_by').references('id').inTable('users');
    t.timestamps(true, true);
    t.index(['school_id', 'role']);
  });
  await knex.raw('CREATE UNIQUE INDEX users_username_lower_uq ON users (lower(username))');
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN (${Object.keys(ROLES).map((r) => `'${r}'`).join(',')}))`);
  // Administration roles have no school; school roles must have one.
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_school_chk CHECK (
    (role IN (${ADMIN_ROLES.map((r) => `'${r}'`).join(',')}) AND school_id IS NULL) OR
    (role IN (${SCHOOL_ROLES.map((r) => `'${r}'`).join(',')}) AND school_id IS NOT NULL))`);

  await knex.schema.createTable('sessions', (t) => {
    t.string('id', 64).primary();                          // sha256 of the cookie token
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.string('ip', 64);
    t.string('user_agent', 255);
    t.index(['user_id']);
  });

  await knex.schema.createTable('audit_log', (t) => {
    t.bigIncrements('id');
    t.timestamp('at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('user_id').references('id').inTable('users');
    t.integer('school_id').references('id').inTable('schools');
    t.string('action', 60).notNullable();                  // e.g. user.create
    t.text('summary').notNullable();                       // plain sentence for people
    t.jsonb('detail');
    t.string('ip', 64);
    t.index(['at']);
    t.index(['school_id', 'at']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('audit_log');
  await knex.schema.dropTableIfExists('sessions');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('schools');
};
