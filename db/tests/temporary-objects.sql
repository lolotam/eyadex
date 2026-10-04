-- Runtime roles cannot create temporary objects (0022). Rolls back; safe anywhere.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/temporary-objects.sql

BEGIN;

-- PostgreSQL grants TEMPORARY on every database to PUBLIC by default, so revoking it from
-- PUBLIC is not enough on its own: a role that was granted TEMPORARY explicitly keeps it.
DO $$
DECLARE
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['eyadex_app','eyadex_auth','eyadex_platform','eyadex_dispatcher'] LOOP
    IF has_database_privilege(runtime_role, current_database(), 'TEMPORARY') THEN
      RAISE EXCEPTION 'TEMP: % still has TEMPORARY on database %', runtime_role, current_database();
    END IF;
  END LOOP;
END $$;

-- eyadex_app is refused a temp table and a temporary function. The body re-points the clinic
-- context through set_config, which is what a temporary function must not be able to do.
SET LOCAL ROLE eyadex_app;
DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE TEMP TABLE temp_objects_probe (id integer)';
    RAISE EXCEPTION 'TEMP: eyadex_app created a temporary table';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'CREATE FUNCTION pg_temp.eyadex_clinic_probe() RETURNS text LANGUAGE plpgsql
      AS $fn$ BEGIN RETURN set_config(''app.clinic_id'', ''somewhere-else'', true) || ''/probe''; END $fn$';
    RAISE EXCEPTION 'TEMP: eyadex_app created a temporary function';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- eyadex_platform is refused the same two objects: it runs with no clinic context at all.
SET LOCAL ROLE eyadex_platform;
DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE TEMP TABLE temp_objects_probe (id integer)';
    RAISE EXCEPTION 'TEMP: eyadex_platform created a temporary table';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'CREATE FUNCTION pg_temp.eyadex_clinic_probe() RETURNS text LANGUAGE plpgsql
      AS $fn$ BEGIN RETURN set_config(''app.clinic_id'', ''somewhere-else'', true) || ''/probe''; END $fn$';
    RAISE EXCEPTION 'TEMP: eyadex_platform created a temporary function';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

\echo 'Temporary-object tests: all passed'
ROLLBACK;