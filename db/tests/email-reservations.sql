-- One email = one account across clinics and the platform team (PRD 4.6). Rolls back.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/email-reservations.sql

BEGIN;
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000000e1','eps-a','أ','A','dental','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000000e2','eps-b','ب','B','dental','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());

SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000000e1';
DO $$
DECLARE week timestamptz := now() + interval '7 days';
BEGIN
  IF NOT reserve_invitation_email('Person@Example.com ', week) THEN RAISE EXCEPTION 'EMAIL: first hold failed'; END IF;
  IF reserve_invitation_email('person@example.com', week) THEN RAISE EXCEPTION 'EMAIL: same email held twice'; END IF;
  IF NOT renew_invitation_email('person@example.com', week + interval '1 day') THEN RAISE EXCEPTION 'EMAIL: resend renew failed'; END IF;
  IF convert_invitation_email_to_membership('never-invited@example.com') THEN
    RAISE EXCEPTION 'EMAIL: membership hold created without an invitation';
  END IF;
  BEGIN PERFORM 1 FROM email_reservations; RAISE EXCEPTION 'EMAIL: app can read the registry directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- Clinic B cannot take, renew, convert or release clinic A's hold.
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000000e2';
DO $$
BEGIN
  IF reserve_invitation_email('person@example.com', now() + interval '7 days') THEN RAISE EXCEPTION 'EMAIL: another clinic took a held email'; END IF;
  IF renew_invitation_email('person@example.com', now() + interval '7 days') THEN RAISE EXCEPTION 'EMAIL: another clinic renewed a hold'; END IF;
  IF convert_invitation_email_to_membership('person@example.com') THEN RAISE EXCEPTION 'EMAIL: another clinic converted a hold'; END IF;
  IF release_invitation_email('person@example.com') THEN RAISE EXCEPTION 'EMAIL: another clinic released a hold'; END IF;
END $$;

-- Clinic A accepts: the hold becomes a membership, which is never released.
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000000e1';
DO $$
BEGIN
  IF NOT convert_invitation_email_to_membership('person@example.com') THEN RAISE EXCEPTION 'EMAIL: accept failed'; END IF;
  IF release_invitation_email('person@example.com') THEN RAISE EXCEPTION 'EMAIL: a membership was released'; END IF;
  IF NOT reserve_invitation_email('temp@example.com', now() + interval '7 days') THEN RAISE EXCEPTION 'EMAIL: temp hold failed'; END IF;
  IF NOT release_invitation_email('temp@example.com') THEN RAISE EXCEPTION 'EMAIL: cancel release failed'; END IF;
END $$;
RESET ROLE;

-- An invitation hold that has expired is free for any clinic (simulated by the owner).
INSERT INTO email_reservations VALUES ('stale@example.com', 'invitation',
  '00000000-0000-7000-8000-0000000000e1', now() - interval '1 day', now() - interval '8 days');

SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000000e2';
DO $$
BEGIN
  IF NOT reserve_invitation_email('temp@example.com', now() + interval '7 days') THEN RAISE EXCEPTION 'EMAIL: released email not reusable'; END IF;
  IF NOT reserve_invitation_email('stale@example.com', now() + interval '7 days') THEN RAISE EXCEPTION 'EMAIL: expired hold still blocks'; END IF;
END $$;
RESET ROLE;

-- Platform-team accounts: held globally with no clinic; clinics can never take them.
SET LOCAL ROLE eyadex_auth;
DO $$
BEGIN
  IF NOT reserve_platform_email('ops@eyadex.com') THEN RAISE EXCEPTION 'EMAIL: platform hold failed'; END IF;
  IF reserve_platform_email('person@example.com') THEN RAISE EXCEPTION 'EMAIL: platform took a clinic member'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE eyadex_app;
DO $$
BEGIN
  IF reserve_invitation_email('ops@eyadex.com', now() + interval '7 days') THEN RAISE EXCEPTION 'EMAIL: clinic invited a platform account'; END IF;
  BEGIN PERFORM reserve_platform_email('x@eyadex.com'); RAISE EXCEPTION 'EMAIL: app can create platform holds';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- No clinic context, no clinic hold.
RESET app.clinic_id;
DO $$
BEGIN
  BEGIN PERFORM reserve_invitation_email('x@example.com', now() + interval '7 days');
    RAISE EXCEPTION 'EMAIL: held without a clinic context';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%requires a clinic context%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

\echo 'Email reservation tests: all passed'
ROLLBACK;
