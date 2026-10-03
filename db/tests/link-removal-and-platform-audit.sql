-- Link-row removal (0016 §1) and the platform's onboarding audit writer (0016 §2). Rolls back.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/link-removal-and-platform-audit.sql

BEGIN;
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000000a1','lnk-a','أ','A','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000000a2','lnk-b','ب','B','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
INSERT INTO permissions VALUES
  ('00000000-0000-7000-8000-0000000003f1','view:patients:clinic','view','patients','clinic','patients');
DO $$
DECLARE c uuid; s text;
BEGIN
  FOREACH c IN ARRAY ARRAY['00000000-0000-7000-8000-0000000000a1','00000000-0000-7000-8000-0000000000a2']::uuid[] LOOP
    s := right(c::text, 1);
    INSERT INTO branches VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'1')::uuid, 'ف', 'B', true, now(), now());
    INSERT INTO roles VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'2')::uuid, null, 'د', 'R', false, true, now(), now());
    INSERT INTO role_permissions VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'3')::uuid, ('00000000-0000-7000-8000-0000000003'||s||'2')::uuid, '00000000-0000-7000-8000-0000000003f1', now());
    INSERT INTO memberships VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'4')::uuid, gen_random_uuid(), 'n', 'l'||s||'@example.com', ('00000000-0000-7000-8000-0000000003'||s||'2')::uuid, false, 'active', 'ar', null, now(), now());
    INSERT INTO membership_branches VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'5')::uuid, ('00000000-0000-7000-8000-0000000003'||s||'4')::uuid, ('00000000-0000-7000-8000-0000000003'||s||'1')::uuid, now());
  END LOOP;
END $$;

SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000000a1';
DO $$
DECLARE n bigint;
BEGIN
  -- Own clinic's links can be removed.
  DELETE FROM membership_branches; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'LINK: removed % own membership_branches rows, expected 1', n; END IF;
  DELETE FROM role_permissions; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'LINK: removed % own role_permissions rows, expected 1', n; END IF;
  -- Entities stay undeletable.
  BEGIN DELETE FROM branches; RAISE EXCEPTION 'LINK: branches are deletable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM roles; RAISE EXCEPTION 'LINK: roles are deletable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM memberships; RAISE EXCEPTION 'LINK: memberships are deletable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- The other clinic's links were untouched.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM membership_branches WHERE clinic_id = '00000000-0000-7000-8000-0000000000a2';
  IF n <> 1 THEN RAISE EXCEPTION 'LINK: another clinic lost membership_branches rows'; END IF;
  SELECT count(*) INTO n FROM role_permissions WHERE clinic_id = '00000000-0000-7000-8000-0000000000a2';
  IF n <> 1 THEN RAISE EXCEPTION 'LINK: another clinic lost role_permissions rows'; END IF;
END $$;

-- The platform records the onboarding audit entry for the clinic it is working on.
SET LOCAL ROLE eyadex_platform;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000000a1';
INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-0000000000a1', gen_random_uuid(), gen_random_uuid(),
  'invitation.sent', 'administrative', 'invitation', null, null, '{}', now());
DO $$
BEGIN
  BEGIN
    INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-0000000000a2', gen_random_uuid(), gen_random_uuid(),
      'invitation.sent', 'administrative', 'invitation', null, null, '{}', now());
    RAISE EXCEPTION 'PAUDIT: platform wrote audit for another clinic';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-0000000000a1', gen_random_uuid(), gen_random_uuid(),
      'patient.opened', 'patient_access', 'patient', null, null, '{}', now());
    RAISE EXCEPTION 'PAUDIT: platform wrote a patient-access entry';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM audit_log LIMIT 1; RAISE EXCEPTION 'PAUDIT: platform can read audit_log';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

\echo 'Link removal and platform audit writer tests: all passed'
ROLLBACK;
