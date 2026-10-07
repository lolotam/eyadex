-- Clinic mail providers (0030, ADR-0014): grants, CHECKs, one per clinic, isolation. Rolls back.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/clinic-mail-providers.sql

BEGIN;
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000007a1','mp-a','أ','A','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000007a2','mp-b','ب','B','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
INSERT INTO clinic_mail_providers (clinic_id, id, kind, from_name, from_email, sealed_credentials, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-0000000007a2', '00000000-0000-7000-8000-0000000007b2', 'resend',
          'B', 'b@example.test', 'v1.x.y.z', now(), now());

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname = 'clinic_mail_providers') THEN
    RAISE EXCEPTION 'MAIL-PROVIDER: RLS is not enabled and forced';
  END IF;
  IF NOT has_table_privilege('eyadex_app', 'clinic_mail_providers', 'SELECT')
     OR NOT has_table_privilege('eyadex_app', 'clinic_mail_providers', 'INSERT')
     OR NOT has_table_privilege('eyadex_app', 'clinic_mail_providers', 'UPDATE')
     OR NOT has_table_privilege('eyadex_app', 'clinic_mail_providers', 'DELETE') THEN
    RAISE EXCEPTION 'MAIL-PROVIDER: eyadex_app lacks a privilege';
  END IF;
  IF has_table_privilege('eyadex_platform', 'clinic_mail_providers', 'SELECT')
     OR has_table_privilege('eyadex_auth', 'clinic_mail_providers', 'SELECT')
     OR has_table_privilege('eyadex_dispatcher', 'clinic_mail_providers', 'SELECT') THEN
    RAISE EXCEPTION 'MAIL-PROVIDER: another runtime role can read clinic mail credentials';
  END IF;
END $$;

-- The platform role is refused outright, not just shown zero rows.
SET LOCAL ROLE eyadex_platform;
DO $$
BEGIN
  BEGIN PERFORM 1 FROM clinic_mail_providers LIMIT 1;
    RAISE EXCEPTION 'MAIL-PROVIDER: eyadex_platform can SELECT';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000007a1';
INSERT INTO clinic_mail_providers (clinic_id, id, kind, from_name, from_email, smtp_host, smtp_port, smtp_user,
    sealed_credentials, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-0000000007a1', '00000000-0000-7000-8000-0000000007b1', 'smtp',
          'A', 'a@example.test', 'smtp.example.test', 587, 'mailer', 'v1.x.y.z', now(), now());
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM clinic_mail_providers;
  IF n <> 1 THEN RAISE EXCEPTION 'ISO-01: clinic A sees % provider rows', n; END IF;
  UPDATE clinic_mail_providers SET last_error = 'x' WHERE clinic_id = '00000000-0000-7000-8000-0000000007a2';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01: clinic A updated another clinic''s provider'; END IF;
  DELETE FROM clinic_mail_providers WHERE clinic_id = '00000000-0000-7000-8000-0000000007a2';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01: clinic A deleted another clinic''s provider'; END IF;
  BEGIN
    INSERT INTO clinic_mail_providers (clinic_id, id, kind, from_name, from_email, sealed_credentials, created_at, updated_at)
      VALUES ('00000000-0000-7000-8000-0000000007a2', gen_random_uuid(), 'resend', 'x', 'x@example.test', 'v1', now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: clinic_mail_providers';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- One provider per clinic.
  BEGIN
    INSERT INTO clinic_mail_providers (clinic_id, id, kind, from_name, from_email, sealed_credentials, created_at, updated_at)
      VALUES ('00000000-0000-7000-8000-0000000007a1', gen_random_uuid(), 'resend', 'x', 'x@example.test', 'v1', now(), now());
    RAISE EXCEPTION 'MAIL-PROVIDER: a second provider row was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- CHECKs: smtp needs host/port/user; resend has none; unknown kind; long last_error.
  BEGIN
    UPDATE clinic_mail_providers SET smtp_user = NULL;
    RAISE EXCEPTION 'MAIL-PROVIDER: an smtp row without a user was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE clinic_mail_providers SET kind = 'resend';
    RAISE EXCEPTION 'MAIL-PROVIDER: a resend row with smtp fields was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE clinic_mail_providers SET kind = 'sendgrid';
    RAISE EXCEPTION 'MAIL-PROVIDER: an unknown kind was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE clinic_mail_providers SET last_error = repeat('e', 121);
    RAISE EXCEPTION 'MAIL-PROVIDER: a 121-character last_error was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE clinic_mail_providers SET kind = 'resend', smtp_host = NULL, smtp_port = NULL, smtp_user = NULL;
  DELETE FROM clinic_mail_providers;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'MAIL-PROVIDER: the clinic cannot remove its own provider'; END IF;
END $$;
RESET ROLE;

\echo 'clinic mail provider tests: all passed'
ROLLBACK;
