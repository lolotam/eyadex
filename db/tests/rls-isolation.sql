-- Negative isolation tests for every clinic-owned table (PRD 6.3 ISO-01, PLAT-01).
-- Runs inside one transaction and ROLLS BACK, so it is safe on any database that has the
-- db/sql baseline. Any failed expectation raises an exception (psql exits non-zero).
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/rls-isolation.sql

BEGIN;

-- Two clinics (A, B) with one row in every clinic-owned table, written by the owner role.
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-00000000000a','alpha','أ','A','dermatology','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-00000000000b','beta','ب','B','obgyn','en','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
INSERT INTO permissions VALUES
  ('00000000-0000-7000-8000-0000000000f1','view:patients:branch','view','patients','branch','patients');

DO $$
DECLARE c uuid; s text;
BEGIN
  FOREACH c IN ARRAY ARRAY['00000000-0000-7000-8000-00000000000a','00000000-0000-7000-8000-00000000000b']::uuid[] LOOP
    s := right(c::text, 1);
    INSERT INTO clinic_features VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'1')::uuid, 'patients', true, now());
    INSERT INTO branches VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid, 'ف', 'B', true, now(), now());
    INSERT INTO roles VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'3')::uuid, 'doctor', 'طبيب', 'Doctor', false, true, now(), now());
    INSERT INTO role_permissions VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'4')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'3')::uuid, '00000000-0000-7000-8000-0000000000f1', now());
    INSERT INTO memberships VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid, ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, 'n', s||'@example.com', ('00000000-0000-7000-8000-0000000001'||s||'3')::uuid, false, 'active', 'ar', null, now(), now());
    INSERT INTO membership_branches VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'6')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid, now());
    INSERT INTO invitations VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'7')::uuid, 'i'||s||'@example.com', 'n', ('00000000-0000-7000-8000-0000000001'||s||'3')::uuid, false, 'pending', now()+interval '7 days', ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, 'hash-'||s, now(), null);
    INSERT INTO invitation_branches VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'8')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'7')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid);
    INSERT INTO patients VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'9')::uuid, '1', 'x', '+9650000000'||s, '1990-01-01', 'female', ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid, null, 'active', now(), now());
    INSERT INTO clinic_counters VALUES (c, 'patient_file_number', 1, now());
    INSERT INTO audit_log VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'a')::uuid, ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, 'user.invited', 'administrative', 'user', null, null, '{}', now());
    INSERT INTO audit_log VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'b')::uuid, ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, 'patient.opened', 'patient_access', 'patient', null, null, '{}', now());
  END LOOP;
END $$;

-- A patient event can never be filed as administrative (keeps the platform view patient-free).
DO $$
BEGIN
  BEGIN
    INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-00000000000a', gen_random_uuid(),
      '00000000-0000-7000-8000-0000000002a5', 'patient.updated', 'administrative', 'patient',
      null, null, '{}', now());
    RAISE EXCEPTION 'PLAT-01: a patient event was accepted as administrative';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- ISO-01 as the runtime role scoped to clinic A.
SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-00000000000a';

DO $$
DECLARE t text; n bigint; other uuid := '00000000-0000-7000-8000-00000000000b';
BEGIN
  -- Every clinic table: clinic A sees zero rows of clinic B.
  FOREACH t IN ARRAY ARRAY['clinic_features','branches','roles','role_permissions','memberships',
      'membership_branches','invitations','invitation_branches','patients','audit_log','clinic_counters'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE clinic_id = $1', t) INTO n USING other;
    IF n <> 0 THEN RAISE EXCEPTION 'ISO-01 read leak: % shows % rows of another clinic', t, n; END IF;
    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
    IF n = 0 THEN RAISE EXCEPTION 'ISO-01 setup: % shows no rows of its own clinic', t; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM clinics;
  IF n <> 1 THEN RAISE EXCEPTION 'ISO-01: clinics shows % rows, expected only its own', n; END IF;
END $$;

-- Writes into another clinic must fail (RLS WITH CHECK), one probe per writable table.
DO $$
DECLARE b uuid := '00000000-0000-7000-8000-00000000000b'; n bigint;
BEGIN
  BEGIN
    INSERT INTO branches VALUES (b, gen_random_uuid(), 'x', 'x', true, now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: branches';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO invitation_branches VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b7', '00000000-0000-7000-8000-0000000001b2');
    RAISE EXCEPTION 'ISO-01 write leak: invitation_branches';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO patients VALUES (b, gen_random_uuid(), '9', 'z', '+96500000099', '1990-01-01', 'male', '00000000-0000-7000-8000-0000000001b2', null, 'active', now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: patients';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO clinic_counters VALUES (b, 'patient_file_number', 99, now())
      ON CONFLICT (clinic_id, name) DO UPDATE SET value = clinic_counters.value + 1;
    RAISE EXCEPTION 'ISO-01 write leak: clinic_counters';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO roles VALUES (b, gen_random_uuid(), null, 'x', 'x', false, true, now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: roles';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO role_permissions VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b3', '00000000-0000-7000-8000-0000000000f1', now());
    RAISE EXCEPTION 'ISO-01 write leak: role_permissions';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO memberships VALUES (b, gen_random_uuid(), gen_random_uuid(), 'x', 'x@example.com', '00000000-0000-7000-8000-0000000001b3', true, 'active', 'ar', null, now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: memberships';
  -- RLS or the email-hold trigger (0017) rejects it; either way the write is refused.
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
  BEGIN
    INSERT INTO membership_branches VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b5', '00000000-0000-7000-8000-0000000001b2', now());
    RAISE EXCEPTION 'ISO-01 write leak: membership_branches';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO invitations VALUES (b, gen_random_uuid(), 'x@example.com', 'x', '00000000-0000-7000-8000-0000000001b3', true, 'pending', now() + interval '7 days', gen_random_uuid(), 'hash-probe', now(), null);
    RAISE EXCEPTION 'ISO-01 write leak: invitations';
  -- RLS or the email-hold trigger (0017) rejects it; either way the write is refused.
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
  BEGIN
    INSERT INTO audit_log VALUES (b, gen_random_uuid(), gen_random_uuid(), 'user.invited', 'administrative', 'user', null, null, '{}', now());
    RAISE EXCEPTION 'ISO-01 write leak: audit_log';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Moving an own row into another clinic must fail on WITH CHECK, for every writable table.
  DECLARE t text;
  BEGIN
    FOREACH t IN ARRAY ARRAY['branches','roles','role_permissions','memberships','membership_branches',
        'invitations','invitation_branches','patients','clinic_counters'] LOOP
      BEGIN
        EXECUTE format('UPDATE %I SET clinic_id = $1', t) USING b;
        RAISE EXCEPTION 'ISO-01 write leak: % rows can be moved to another clinic', t;
      EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
    END LOOP;
  END;
  -- Updating another clinic's rows silently affects nothing (rows are invisible).
  UPDATE patients SET full_name = 'hacked' WHERE clinic_id = b;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01 write leak: updated % patients of another clinic', n; END IF;
  -- Append-only audit and no deletes anywhere.
  BEGIN DELETE FROM audit_log; RAISE EXCEPTION 'audit_log is deletable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE audit_log SET action = 'x'; RAISE EXCEPTION 'audit_log is updatable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM patients; RAISE EXCEPTION 'patients are hard-deletable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Feature flags are platform-controlled (PRD 4.8): the clinic can read but not write them.
  BEGIN UPDATE clinic_features SET enabled = false; RAISE EXCEPTION 'clinic_features writable by eyadex_app';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

RESET ROLE;

-- PLAT-01: the platform role sees every clinic, never patients or patient-access audit rows.
-- The view must cross clinics without relying on a clinic context or a superuser owner.
RESET app.clinic_id;
SET LOCAL ROLE eyadex_platform;
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM clinics;
  IF n < 2 THEN RAISE EXCEPTION 'PLAT: platform sees % clinics', n; END IF;
  BEGIN PERFORM 1 FROM patients LIMIT 1; RAISE EXCEPTION 'PLAT-01: platform can read patients';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM clinic_counters LIMIT 1; RAISE EXCEPTION 'PLAT-01: platform can read clinic_counters';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM audit_log LIMIT 1; RAISE EXCEPTION 'PLAT-01: platform can read audit_log';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT count(*) INTO n FROM platform_clinic_admin_audit WHERE action = 'patient.opened';
  IF n <> 0 THEN RAISE EXCEPTION 'PLAT-01: admin audit view exposes patient access'; END IF;
  SELECT count(*) INTO n FROM platform_clinic_admin_audit
    WHERE clinic_id IN ('00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-00000000000b');
  IF n <> 2 THEN RAISE EXCEPTION 'PLAT: admin audit view shows %, expected 2', n; END IF;
END $$;

RESET ROLE;
\echo 'RLS isolation tests: all passed'
ROLLBACK;
