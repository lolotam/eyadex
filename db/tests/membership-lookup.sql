-- Pre-tenant membership lookup (0027, ADR-0009). Rolls back; safe anywhere.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/membership-lookup.sql

BEGIN;

-- Two clinics, one member each, written by the owner inside each clinic's context.
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000027a1', 'lookup-a', 'أ', 'A', 'general', 'ar', 'Asia/Kuwait',
   'active', now() + interval '30 days', 5, 2, now(), now()),
  ('00000000-0000-7000-8000-0000000027b1', 'lookup-b', 'ب', 'B', 'general', 'ar', 'Asia/Kuwait',
   'active', now() + interval '30 days', 5, 2, now(), now());

SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000027a1';
INSERT INTO roles VALUES ('00000000-0000-7000-8000-0000000027a1', '00000000-0000-7000-8000-0000000027a2',
  null, 'دور', 'Role', false, true, now(), now());
DO $$ BEGIN
  PERFORM reserve_invitation_email('lookup-a@example.com', '00000000-0000-7000-8000-0000000027a3', now() + interval '1 day');
  PERFORM convert_invitation_email_to_membership('lookup-a@example.com', '00000000-0000-7000-8000-0000000027a3');
END $$;
INSERT INTO memberships VALUES ('00000000-0000-7000-8000-0000000027a1', '00000000-0000-7000-8000-0000000027a4',
  '00000000-0000-7000-8000-0000000027a5', 'A user', 'lookup-a@example.com',
  '00000000-0000-7000-8000-0000000027a2', true, 'deactivated', 'ar', null, now(), now());

SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000027b1';
INSERT INTO roles VALUES ('00000000-0000-7000-8000-0000000027b1', '00000000-0000-7000-8000-0000000027b2',
  null, 'دور', 'Role', false, true, now(), now());
DO $$ BEGIN
  PERFORM reserve_invitation_email('lookup-b@example.com', '00000000-0000-7000-8000-0000000027b3', now() + interval '1 day');
  PERFORM convert_invitation_email_to_membership('lookup-b@example.com', '00000000-0000-7000-8000-0000000027b3');
END $$;
INSERT INTO memberships VALUES ('00000000-0000-7000-8000-0000000027b1', '00000000-0000-7000-8000-0000000027b4',
  '00000000-0000-7000-8000-0000000027b5', 'B user', 'lookup-b@example.com',
  '00000000-0000-7000-8000-0000000027b2', true, 'active', 'ar', null, now(), now());

-- One account = one membership: the same user id in a second clinic is refused.
DO $$ BEGIN
  INSERT INTO memberships VALUES ('00000000-0000-7000-8000-0000000027b1', gen_random_uuid(),
    '00000000-0000-7000-8000-0000000027a5', 'Dup', 'lookup-dup@example.com',
    '00000000-0000-7000-8000-0000000027b2', true, 'active', 'ar', null, now(), now());
  RAISE EXCEPTION 'LOOKUP: one user id holds two memberships';
EXCEPTION WHEN unique_violation OR raise_exception THEN
  IF SQLERRM LIKE 'LOOKUP:%' THEN RAISE; END IF;
END $$;
RESET app.clinic_id;

-- The API role, with no clinic context, sees no membership but resolves each user's own clinic.
SET LOCAL ROLE eyadex_app;
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM memberships;
  IF n <> 0 THEN RAISE EXCEPTION 'LOOKUP: app sees % memberships without a clinic context', n; END IF;
  IF membership_clinic_for_user('00000000-0000-7000-8000-0000000027a5') IS DISTINCT FROM
     '00000000-0000-7000-8000-0000000027a1'::uuid THEN
    RAISE EXCEPTION 'LOOKUP: a deactivated member must still resolve (the guard rejects it)';
  END IF;
  IF membership_clinic_for_user('00000000-0000-7000-8000-0000000027b5') IS DISTINCT FROM
     '00000000-0000-7000-8000-0000000027b1'::uuid THEN
    RAISE EXCEPTION 'LOOKUP: member of B resolved to the wrong clinic';
  END IF;
  IF membership_clinic_for_user(gen_random_uuid()) IS NOT NULL THEN
    RAISE EXCEPTION 'LOOKUP: an unknown user resolved';
  END IF;
END $$;
RESET ROLE;

-- Only the API role may call it.
SET LOCAL ROLE eyadex_platform;
DO $$ BEGIN
  BEGIN PERFORM membership_clinic_for_user('00000000-0000-7000-8000-0000000027b5');
    RAISE EXCEPTION 'LOOKUP: platform can call the membership lookup';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE eyadex_auth;
DO $$ BEGIN
  BEGIN PERFORM membership_clinic_for_user('00000000-0000-7000-8000-0000000027b5');
    RAISE EXCEPTION 'LOOKUP: auth role can call the membership lookup';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

\echo 'Membership lookup tests: all passed'
ROLLBACK;
