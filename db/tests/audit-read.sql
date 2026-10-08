-- Reading the audit log (0034, ADR-0019; PLAT-01 at the slice's read surface). Rolls back.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/audit-read.sql

BEGIN;

INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000034a1','aud-a','أ','A','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000034b1','aud-b','ب','B','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());

-- One platform account, one clinic member per clinic, and one clinic-area account with no membership.
INSERT INTO auth_users (id, name, email, email_verified, image, two_factor_enabled, created_at, updated_at, area) VALUES
  ('00000000-0000-7000-8000-0000000034f1', 'Platform Person', 'staff-34@example.com', true, null, true, now(), now(), 'platform'),
  ('00000000-0000-7000-8000-0000000034f2', 'Loose Clinic Account', 'loose-34@example.com', true, null, false, now(), now(), 'clinic');

DO $$
DECLARE c uuid; s text;
BEGIN
  FOREACH c IN ARRAY ARRAY['00000000-0000-7000-8000-0000000034a1','00000000-0000-7000-8000-0000000034b1']::uuid[] LOOP
    s := substr(right(c::text, 2), 1, 1);
    INSERT INTO roles VALUES (c, ('00000000-0000-7000-8000-0000000034'||s||'2')::uuid, null, 'د', 'R', false, true, now(), now());
    INSERT INTO memberships VALUES (c, ('00000000-0000-7000-8000-0000000034'||s||'3')::uuid,
      ('00000000-0000-7000-8000-0000000034'||s||'4')::uuid, 'Member '||s, 'm34'||s||'@example.com',
      ('00000000-0000-7000-8000-0000000034'||s||'2')::uuid, true, 'active', 'ar', null, now(), now());
    INSERT INTO audit_log VALUES (c, ('00000000-0000-7000-8000-0000000034'||s||'5')::uuid,
      ('00000000-0000-7000-8000-0000000034'||s||'4')::uuid, 'branch.created', 'administrative', 'branch', null, null, '{}', now());
    INSERT INTO audit_log VALUES (c, ('00000000-0000-7000-8000-0000000034'||s||'6')::uuid,
      ('00000000-0000-7000-8000-0000000034'||s||'4')::uuid, 'patient.opened', 'patient_access', 'patient', null, null, '{}', now());
  END LOOP;
END $$;
INSERT INTO platform_audit_log VALUES ('00000000-0000-7000-8000-0000000034f3',
  '00000000-0000-7000-8000-0000000034f1', 'clinic.created', '00000000-0000-7000-8000-0000000034a1', '{}', now());

SET LOCAL ROLE eyadex_platform;
SET LOCAL app.clinic_id = '';
DO $$
DECLARE n bigint; names text;
BEGIN
  -- Names of the platform account and of members of every clinic, nothing else.
  SELECT string_agg(full_name, ',' ORDER BY full_name) INTO names FROM platform_audit_actors
    WHERE user_id::text LIKE '00000000-0000-7000-8000-0000000034%';
  IF names IS DISTINCT FROM 'Member a,Member b,Platform Person' THEN
    RAISE EXCEPTION 'AREAD: platform_audit_actors shows %', names;
  END IF;
  SELECT count(*) INTO n FROM platform_audit_actors WHERE user_id = '00000000-0000-7000-8000-0000000034f2';
  IF n <> 0 THEN RAISE EXCEPTION 'AREAD: a clinic-area account outside any membership is named'; END IF;
  -- The view is the only window: the identity tables and the clinic audit table stay closed.
  BEGIN PERFORM 1 FROM auth_users LIMIT 1; RAISE EXCEPTION 'AREAD: platform can read auth_users';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM audit_log LIMIT 1; RAISE EXCEPTION 'AREAD: platform can read audit_log';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- The slice's platform list reads the admin view with no category condition: patient rows are absent.
  SELECT count(*) INTO n FROM platform_clinic_admin_audit
    WHERE clinic_id IN ('00000000-0000-7000-8000-0000000034a1', '00000000-0000-7000-8000-0000000034b1');
  IF n <> 2 THEN RAISE EXCEPTION 'AREAD: admin view shows % rows, expected the 2 administrative ones', n; END IF;
  SELECT count(*) INTO n FROM platform_clinic_admin_audit WHERE entity_type = 'patient';
  IF n <> 0 THEN RAISE EXCEPTION 'AREAD: admin view exposes patient access'; END IF;
END $$;
RESET ROLE;

-- No other runtime role reads the actor names.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['eyadex_app', 'eyadex_auth', 'eyadex_dispatcher'] LOOP
    IF has_table_privilege(r, 'platform_audit_actors', 'SELECT') THEN
      RAISE EXCEPTION 'AREAD: % can read platform_audit_actors', r;
    END IF;
  END LOOP;
  IF has_column_privilege('eyadex_audit_actor_owner', 'auth_users', 'email', 'SELECT') THEN
    RAISE EXCEPTION 'AREAD: the actor view owner can read account emails';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_audit_actor_owner' AND (rolcanlogin OR rolbypassrls)) THEN
    RAISE EXCEPTION 'AREAD: the actor view owner can log in or bypass RLS';
  END IF;
END $$;
SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000034a1';
DO $$
BEGIN
  BEGIN PERFORM 1 FROM platform_audit_actors LIMIT 1; RAISE EXCEPTION 'AREAD: app can read platform_audit_actors';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

\echo 'Audit read surface tests: all passed'
ROLLBACK;
