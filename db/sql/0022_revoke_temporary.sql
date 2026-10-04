-- SQL baseline (pending; not yet applied to production).
-- Runtime roles must not be able to create temporary objects. PostgreSQL grants TEMPORARY
-- on every database to PUBLIC by default, and 0013 only revoked CREATE on schema public, so
-- eyadex_app, eyadex_auth, eyadex_platform and eyadex_dispatcher could still run
-- CREATE TEMP TABLE or CREATE FUNCTION pg_temp.f() — and a temporary function can hide
-- set_config('app.clinic_id', ...) behind string concatenation, re-pointing the clinic
-- context where no review can see it. No runtime role needs temporary objects. CONNECT and
-- every other database privilege are left untouched, and the database owner keeps TEMPORARY
-- (it runs migrations only). Idempotent: re-running it revokes what is already revoked.
--
-- The database name differs per environment, so the statement is built with
-- current_database() instead of a hard-coded name.
DO $$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format(
    'REVOKE TEMPORARY ON DATABASE %I FROM eyadex_app, eyadex_auth, eyadex_platform, eyadex_dispatcher',
    current_database());
END $$;

-- A REVOKE run by a role that is not the database owner (or a superuser) only emits a WARNING
-- and changes nothing, so the privilege would survive while the file was recorded as applied.
-- Assert instead, so the migration fails loudly in that case.
DO $$
DECLARE
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['eyadex_app','eyadex_auth','eyadex_platform','eyadex_dispatcher'] LOOP
    IF has_database_privilege(runtime_role, current_database(), 'TEMPORARY') THEN
      RAISE EXCEPTION 'REVOKE TEMPORARY: % still has TEMPORARY on database % — run this migration as the database owner',
        runtime_role, current_database();
    END IF;
  END LOOP;
END $$;
