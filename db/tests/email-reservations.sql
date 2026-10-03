-- One email = one clinic, across tenants (PRD 4.6). Rolls back; safe anywhere.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/email-reservations.sql

BEGIN;
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000000e1','eps-a','أ','A','dental','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000000e2','eps-b','ب','B','dental','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());

SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000000e1';
DO $$
BEGIN
  IF NOT reserve_email('Person@Example.com ', 'invitation') THEN RAISE EXCEPTION 'EMAIL: first reservation failed'; END IF;
  IF reserve_email('person@example.com', 'invitation') THEN RAISE EXCEPTION 'EMAIL: same clinic reserved twice'; END IF;
  BEGIN PERFORM 1 FROM email_reservations; RAISE EXCEPTION 'EMAIL: app can read the registry directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- Clinic B cannot take an email clinic A holds, and cannot release A's reservation.
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000000e2';
DO $$
BEGIN
  IF reserve_email('person@example.com', 'invitation') THEN RAISE EXCEPTION 'EMAIL: another clinic took a held email'; END IF;
  IF reserve_email('person@example.com', 'membership') THEN RAISE EXCEPTION 'EMAIL: another clinic upgraded a held email'; END IF;
  IF release_invitation_email('person@example.com') THEN RAISE EXCEPTION 'EMAIL: another clinic released a held email'; END IF;
END $$;

-- Clinic A accepts (invitation -> membership); memberships are never released.
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000000e1';
DO $$
BEGIN
  IF NOT reserve_email('person@example.com', 'membership') THEN RAISE EXCEPTION 'EMAIL: accept upgrade failed'; END IF;
  IF release_invitation_email('person@example.com') THEN RAISE EXCEPTION 'EMAIL: a membership email was released'; END IF;
  -- A cancelled invitation frees its email for any clinic.
  IF NOT reserve_email('temp@example.com', 'invitation') THEN RAISE EXCEPTION 'EMAIL: temp reservation failed'; END IF;
  IF NOT release_invitation_email('temp@example.com') THEN RAISE EXCEPTION 'EMAIL: release failed'; END IF;
END $$;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000000e2';
DO $$
BEGIN
  IF NOT reserve_email('temp@example.com', 'invitation') THEN RAISE EXCEPTION 'EMAIL: released email not reusable'; END IF;
END $$;

-- No clinic context, no reservation.
RESET app.clinic_id;
DO $$
BEGIN
  BEGIN PERFORM reserve_email('x@example.com', 'invitation'); RAISE EXCEPTION 'EMAIL: reserved without a clinic context';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%requires a clinic context%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

\echo 'Email reservation tests: all passed'
ROLLBACK;
