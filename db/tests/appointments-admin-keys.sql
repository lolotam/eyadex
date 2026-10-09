-- Invariant (ADR-0026 §6, D-16): every locked clinic_admin role holds every clinic-scope key of the
-- appointments module. Read-only; safe anywhere. Run it on a live database after the code that ships
-- with 0042 is deployed: a clinic created by the old code between applying 0042 and the deploy misses
-- the keys (Codex, PR #63), and this check names it. The fix is to re-run 0042's final
-- `INSERT INTO role_permissions … ON CONFLICT DO NOTHING`, which is idempotent.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/appointments-admin-keys.sql   (as the migration owner)

DO $$
DECLARE
  missing integer;
  sample text;
BEGIN
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'ADMIN-KEYS: run as the migration owner, which sees every clinic';
  END IF;
  SELECT count(*), min(r.clinic_id::text)
    INTO missing, sample
    FROM roles r
    CROSS JOIN permissions p
   WHERE r.system_key = 'clinic_admin' AND r.is_locked
     AND p.module = 'appointments' AND p.scope = 'clinic'
     AND NOT EXISTS (
       SELECT 1 FROM role_permissions rp
        WHERE rp.clinic_id = r.clinic_id AND rp.role_id = r.id AND rp.permission_id = p.id);
  IF missing > 0 THEN
    RAISE EXCEPTION 'ADMIN-KEYS: % admin key(s) missing (e.g. clinic %); re-run 0042''s backfill INSERT',
      missing, sample;
  END IF;
  RAISE NOTICE 'Appointments admin keys tests: all passed';
END $$;
