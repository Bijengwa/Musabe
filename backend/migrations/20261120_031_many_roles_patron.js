// 2026-11-20: one person, many roles. A person keeps ONE account (users.role is the main role) and may hold extra roles
// (user_roles), e.g. the school librarian who is also the School Store-keeper. The top bar switches "Working as";
// the session remembers the role in use (sessions.active_role) and every action records it (audit_log.role).
// Also the Patron / Matron role (school), who writes in the Order Book.
const { ROLES, ADMIN_ROLES, SCHOOL_ROLES } = require('../src/auth/roles');
const list = (a) => a.map((x) => `'${x}'`).join(',');

exports.up = async (knex) => {
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_chk');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_school_chk');
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN (${list(Object.keys(ROLES))}))`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_school_chk CHECK (
    (role IN (${list(ADMIN_ROLES)}) AND school_id IS NULL) OR (role IN (${list(SCHOOL_ROLES)}) AND school_id IS NOT NULL))`);

  await knex.schema.createTable('user_roles', (t) => {
    t.increments('id');
    t.integer('user_id').notNullable().references('id').inTable('users');
    t.string('role', 20).notNullable();
    t.integer('school_id').references('id').inTable('schools');
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('added_by').references('id').inTable('users');
    t.timestamp('added_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('removed_by').references('id').inTable('users');
    t.timestamp('removed_at', { useTz: true });
    t.index(['user_id']);
  });
  await knex.raw(`ALTER TABLE user_roles ADD CONSTRAINT user_roles_chk CHECK (role IN (${list(Object.keys(ROLES))}) AND (
    (role IN (${list(ADMIN_ROLES)}) AND school_id IS NULL) OR (role IN (${list(SCHOOL_ROLES)}) AND school_id IS NOT NULL)))`);
  await knex.raw('CREATE UNIQUE INDEX user_roles_one_active ON user_roles (user_id, role) WHERE active');
  await knex.raw('CREATE TRIGGER user_roles_no_delete BEFORE DELETE ON user_roles FOR EACH ROW EXECUTE FUNCTION musabe_no_delete()');

  await knex.schema.alterTable('sessions', (t) => { t.string('active_role', 20); });
  // Order Book: the Patron orders for the dormitory.
  await knex.raw('ALTER TABLE orders DROP CONSTRAINT orders_chk');
  await knex.raw(`ALTER TABLE orders ADD CONSTRAINT orders_chk CHECK (
    status IN ('acad','head','manager','keeper','given','requisition','rejected','withdrawn')
    AND place IN ('library','store','academic','kitchen','dormitory','office','other'))`);
  await knex.schema.alterTable('audit_log', (t) => { t.string('role', 20); });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('audit_log', (t) => { t.dropColumn('role'); });
  await knex.schema.alterTable('sessions', (t) => { t.dropColumn('active_role'); });
  await knex.schema.dropTableIfExists('user_roles');
  await knex('users').where('role', 'patron').update({ active: false, role: 'teacher' });
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_chk');
  await knex.raw('ALTER TABLE users DROP CONSTRAINT users_role_school_chk');
  const R = Object.keys(ROLES).filter((r) => r !== 'patron');
  const S = SCHOOL_ROLES.filter((r) => r !== 'patron');
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_chk CHECK (role IN (${list(R)}))`);
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_school_chk CHECK (
    (role IN (${list(ADMIN_ROLES)}) AND school_id IS NULL) OR (role IN (${list(S)}) AND school_id IS NOT NULL))`);
};
