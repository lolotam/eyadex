-- Onboarding (ONB-01) and pre-tenant invitation lookup tests. Rolls back; safe anywhere.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/onboarding-and-invite-lookup.sql

BEGIN;

-- ONB-01: the platform creates a clinic + system role + first-admin invitation atomically,
-- inside a new-tenant context (app.clinic_id = the new clinic).
SET LOCAL ROLE eyadex_platform;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000000c1';
INSERT INTO clinics VALUES ('00000000-0000-7000-8000-0000000000c1', 'gamma', 'ج', 'C', 'general', 'ar',
  'Asia/Kuwait', 'trial', now() + interval '14 days', 5, 2, now(), now());
INSERT INTO roles VALUES ('00000000-0000-7000-8000-0000000000c1', '00000000-0000-7000-8000-0000000000c2',
  'clinic_admin', 'مدير العيادة', 'Clinic admin', true, true, now(), now());
INSERT INTO invitations VALUES ('00000000-0000-7000-8000-0000000000c1', '00000000-0000-7000-8000-0000000000c3',
  'admin@example.com', 'Admin', '00000000-0000-7000-8000-0000000000c2', true, 'pending',
  now() + interval '7 days', '00000000-0000-7000-8000-0000000000c4', 'tokenhash-c', now(), null);

DO $$
BEGIN
  -- The platform cannot slip rows into a different clinic while onboarding this one.
  BEGIN
    INSERT INTO roles VALUES ('00000000-0000-7000-8000-0000000000d1', gen_random_uuid(), null, 'x', 'x',
      false, true, now(), now());
    RAISE EXCEPTION 'ONB: platform wrote a role outside the new tenant';
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN NULL; END;
  -- And onboarding never needs patients.
  BEGIN PERFORM 1 FROM patients LIMIT 1; RAISE EXCEPTION 'ONB: platform can read patients';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
RESET app.clinic_id;

-- Expired and cancelled invitations in the same clinic, written by the owner.
INSERT INTO invitations VALUES
  ('00000000-0000-7000-8000-0000000000c1', gen_random_uuid(), 'old@example.com', 'Old',
   '00000000-0000-7000-8000-0000000000c2', true, 'pending', now() - interval '1 day',
   '00000000-0000-7000-8000-0000000000c4', 'tokenhash-expired', now(), null),
  ('00000000-0000-7000-8000-0000000000c1', gen_random_uuid(), 'gone@example.com', 'Gone',
   '00000000-0000-7000-8000-0000000000c2', true, 'cancelled', now() + interval '7 days',
   '00000000-0000-7000-8000-0000000000c4', 'tokenhash-cancelled', now(), null);

-- Pre-tenant lookup as the API role with NO clinic context.
SET LOCAL ROLE eyadex_app;
DO $$
DECLARE c uuid; n bigint;
BEGIN
  SELECT count(*) INTO n FROM invitations;
  IF n <> 0 THEN RAISE EXCEPTION 'LOOKUP: app sees % invitations without a clinic context', n; END IF;
  c := invitation_clinic_for_token('tokenhash-c');
  IF c IS DISTINCT FROM '00000000-0000-7000-8000-0000000000c1'::uuid THEN
    RAISE EXCEPTION 'LOOKUP: valid token resolved to %', c;
  END IF;
  IF invitation_clinic_for_token('tokenhash-expired') IS NOT NULL THEN
    RAISE EXCEPTION 'LOOKUP: expired token resolved';
  END IF;
  IF invitation_clinic_for_token('tokenhash-cancelled') IS NOT NULL THEN
    RAISE EXCEPTION 'LOOKUP: cancelled token resolved';
  END IF;
  IF invitation_clinic_for_token('no-such-token') IS NOT NULL THEN
    RAISE EXCEPTION 'LOOKUP: unknown token resolved';
  END IF;
END $$;
RESET ROLE;

-- Only the API role may call the lookup.
SET LOCAL ROLE eyadex_platform;
DO $$
BEGIN
  BEGIN PERFORM invitation_clinic_for_token('tokenhash-c');
    RAISE EXCEPTION 'LOOKUP: platform can call the token lookup';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

\echo 'Onboarding and invite lookup tests: all passed'
ROLLBACK;
