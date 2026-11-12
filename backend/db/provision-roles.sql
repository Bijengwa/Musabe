-- Musabe: separate PostgreSQL accounts for migrations and for the running app.
-- See docs/database-roles.md for when and how to run this.
--
-- Run as a PostgreSQL superuser, connected to the Musabe database, e.g.:
--   psql -U postgres -d musabe_db -v ON_ERROR_STOP=1 -f backend/db/provision-roles.sql
--
-- Safe to run more than once. Run it again after every deployment that adds migrations,
-- so new tables get the right rights.
--
-- It does NOT: set or print passwords, change or delete any row, drop anything, or change who owns the database.
-- It DOES: create two roles if missing, make musabe_owner the owner of the existing Musabe tables
-- (takes a short lock on each table: run it in a quiet moment), and set the app's rights table by table.
--
-- Passwords: set them afterwards in psql with  \password musabe_owner  and  \password musabe_app
-- (psql asks for the password and does not show it or keep it in history).

\set ON_ERROR_STOP on
BEGIN;

-- 1. The two roles. No superuser, no create database, no create role, no replication, no row-security bypass.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musabe_owner') THEN
    CREATE ROLE musabe_owner LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'musabe_app') THEN
    CREATE ROLE musabe_app LOGIN;
  END IF;
END $$;
ALTER ROLE musabe_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE musabe_app   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- The app must never get the owner's rights through membership.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles a ON a.oid = m.member JOIN pg_roles o ON o.oid = m.roleid
             WHERE a.rolname = 'musabe_app' AND o.rolname = 'musabe_owner') THEN
    REVOKE musabe_owner FROM musabe_app;
  END IF;
END $$;

-- 2. Database and schema access.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO musabe_owner', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO musabe_app', current_database());
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;          -- nobody else may create tables here (default since PostgreSQL 15)
GRANT USAGE, CREATE ON SCHEMA public TO musabe_owner; -- migrations create and change tables
GRANT USAGE ON SCHEMA public TO musabe_app;           -- the app may use tables, not create them

-- 3. musabe_owner owns the existing Musabe tables (so migrations can change them). Rows are not touched.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
      AND pg_get_userbyid(c.relowner) <> 'musabe_owner'
  LOOP
    EXECUTE format('ALTER %s public.%I OWNER TO musabe_owner',
      CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END, r.relname);
    RAISE NOTICE 'Owner of % is now musabe_owner', r.relname;
  END LOOP;
  -- Sequences not tied to a table column (tied ones moved with their table above).
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S' AND pg_get_userbyid(c.relowner) <> 'musabe_owner'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                      AND d.deptype IN ('a', 'i') AND d.refobjsubid > 0)
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO musabe_owner', r.relname);
  END LOOP;
END $$;

-- 4. What the running app may do, table by table (only what the code needs, checked on commit f44a4f9).
--    Audit and price history: add and read only, never change or delete.
--    Migration bookkeeping: no access.
DO $$
DECLARE
  r record;
  spec jsonb := '{
    "schools":              "SELECT, INSERT, UPDATE",
    "users":                "SELECT, INSERT, UPDATE",
    "sessions":             "SELECT, INSERT, UPDATE, DELETE",
    "audit_log":            "SELECT, INSERT",
    "items":                "SELECT, INSERT, UPDATE",
    "item_prices":          "SELECT, INSERT, UPDATE, DELETE",
    "item_price_changes":   "SELECT, INSERT",
    "knex_migrations":      "",
    "knex_migrations_lock": ""
  }';
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM musabe_app', r.relname);
    IF spec ? r.relname THEN
      IF spec ->> r.relname <> '' THEN
        EXECUTE format('GRANT %s ON TABLE public.%I TO musabe_app', spec ->> r.relname, r.relname);
      END IF;
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO musabe_app', r.relname);
      RAISE WARNING 'Table % is not in the list in provision-roles.sql. It got normal read/write rights. Add it to the list.', r.relname;
    END IF;
  END LOOP;
END $$;

-- Sequences (for auto-numbered ids).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO musabe_app;
DO $$
BEGIN
  IF to_regclass('public.knex_migrations_id_seq') IS NOT NULL THEN REVOKE ALL ON SEQUENCE public.knex_migrations_id_seq FROM musabe_app; END IF;
  IF to_regclass('public.knex_migrations_lock_index_seq') IS NOT NULL THEN REVOKE ALL ON SEQUENCE public.knex_migrations_lock_index_seq FROM musabe_app; END IF;
END $$;

-- 5. Tables that future migrations create (as musabe_owner) get normal read/write rights for the app
--    until this script is run again and applies the list above. A new append-only table must be added to the list.
ALTER DEFAULT PRIVILEGES FOR ROLE musabe_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO musabe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE musabe_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO musabe_app;

COMMIT;
