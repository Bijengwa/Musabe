-- Read-only check of the Musabe database accounts. Changes nothing.
--   psql -U postgres -d musabe_db -f backend/db/check-roles.sql
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin
FROM pg_roles WHERE rolname IN ('musabe_owner', 'musabe_app', current_user) ORDER BY rolname;

SELECT c.relname AS table_name, pg_get_userbyid(c.relowner) AS owner,
       array_to_string(ARRAY(
         SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
         WHERE has_table_privilege('musabe_app', c.oid, p)), ', ') AS musabe_app_rights
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1;
