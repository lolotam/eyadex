-- One email = one account across clinics and the platform team (PRD 4.6). Rolls back.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/email-reservations.sql

BEGIN;
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000000e1','eps-a','أ','A','dental','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000000e2','eps-b','ب','B','dental','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());

-- Invitation ids used below.
-- i1 person (clinic A)  i2 temp (clinic A)  i3 temp (clinic B)  i4 stale replacement (clinic A)
-- i5 stale (clinic A, expired)  i9 an unrelated id

SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000000e1';
DO $$
DECLARE
  week timestamptz := now() + interval '7 days';
  i1 uuid := '00000000-0000-7000-8000-0000000001f1';
  i9 uuid := '00000000-0000-7000-8000-0000000001f9';
BEGIN
  IF NOT reserve_invitation_email('Person@Example.com ', i1, week) THEN RAISE EXCEPTION 'EMAIL: first hold failed'; END IF;
  IF reserve_invitation_email('person@example.com', i9, week) THEN RAISE EXCEPTION 'EMAIL: same email held twice'; END IF;
  IF renew_invitation_email('person@example.com', i9, week) THEN RAISE EXCEPTION 'EMAIL: another invitation renewed the hold'; END IF;
  IF NOT renew_invitation_email('person@example.com', i1, week + interval '1 day') THEN RAISE EXCEPTION 'EMAIL: resend renew failed'; END IF;
  IF convert_invitation_email_to_membership('never-invited@example.com', i9) THEN
    RAISE EXCEPTION 'EMAIL: membership hold created without an invitation';
  END IF;
  BEGIN PERFORM 1 FROM email_reservations; RAISE EXCEPTION 'EMAIL: app can read the registry directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- Clinic B cannot take, renew, convert or release clinic A's hold, even with the right id.
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000000e2';
DO $$
DECLARE i1 uuid := '00000000-0000-7000-8000-0000000001f1';
BEGIN
  IF reserve_invitation_email('person@example.com', gen_random_uuid(), now() + interval '7 days') THEN RAISE EXCEPTION 'EMAIL: another clinic took a held email'; END IF;
  IF renew_invitation_email('person@example.com', i1, now() + interval '7 days') THEN RAISE EXCEPTION 'EMAIL: another clinic renewed a hold'; END IF;
  IF convert_invitation_email_to_membership('person@example.com', i1) THEN RAISE EXCEPTION 'EMAIL: another clinic converted a hold'; END IF;
  IF release_invitation_email('person@example.com', i1) THEN RAISE EXCEPTION 'EMAIL: another clinic released a hold'; END IF;
END $$;

-- Clinic A accepts: the hold becomes a membership, which is never released.
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000000e1';
DO $$
DECLARE
  i1 uuid := '00000000-0000-7000-8000-0000000001f1';
  i2 uuid := '00000000-0000-7000-8000-0000000001f2';
BEGIN
  IF NOT convert_invitation_email_to_membership('person@example.com', i1) THEN RAISE EXCEPTION 'EMAIL: accept failed'; END IF;
  IF release_invitation_email('person@example.com', i1) THEN RAISE EXCEPTION 'EMAIL: a membership was released'; END IF;
  IF NOT reserve_invitation_email('temp@example.com', i2, now() + interval '7 days') THEN RAISE EXCEPTION 'EMAIL: temp hold failed'; END IF;
  IF NOT release_invitation_email('temp@example.com', i2) THEN RAISE EXCEPTION 'EMAIL: cancel release failed'; END IF;
END $$;
RESET ROLE;

-- An expired hold (invitation i5 of clinic A), written by the owner.
INSERT INTO email_reservations VALUES ('stale@example.com', 'invitation',
  '00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000001f5',
  now() - interval '1 day', now() - interval '8 days');

-- Clinic A replaces the expired invitation (i4); cancelling the OLD one must not free the new hold.
SET LOCAL ROLE eyadex_app;
DO $$
DECLARE
  i4 uuid := '00000000-0000-7000-8000-0000000001f4';
  i5 uuid := '00000000-0000-7000-8000-0000000001f5';
BEGIN
  IF NOT reserve_invitation_email('stale@example.com', i4, now() + interval '7 days') THEN RAISE EXCEPTION 'EMAIL: expired hold still blocks'; END IF;
  IF release_invitation_email('stale@example.com', i5) THEN RAISE EXCEPTION 'EMAIL: cancelling an old invitation freed the replacement hold'; END IF;
END $$;

SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000000e2';
DO $$
DECLARE i3 uuid := '00000000-0000-7000-8000-0000000001f3';
BEGIN
  IF reserve_invitation_email('stale@example.com', gen_random_uuid(), now() + interval '7 days') THEN RAISE EXCEPTION 'EMAIL: another clinic took the replacement hold'; END IF;
  IF NOT reserve_invitation_email('temp@example.com', i3, now() + interval '7 days') THEN RAISE EXCEPTION 'EMAIL: released email not reusable'; END IF;
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
  IF reserve_invitation_email('ops@eyadex.com', gen_random_uuid(), now() + interval '7 days') THEN RAISE EXCEPTION 'EMAIL: clinic invited a platform account'; END IF;
  BEGIN PERFORM reserve_platform_email('x@eyadex.com'); RAISE EXCEPTION 'EMAIL: app can create platform holds';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- No clinic context, no clinic hold.
RESET app.clinic_id;
DO $$
BEGIN
  BEGIN PERFORM reserve_invitation_email('x@example.com', gen_random_uuid(), now() + interval '7 days');
    RAISE EXCEPTION 'EMAIL: held without a clinic context';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%requires a clinic context%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

-- The database refuses memberships and invitations whose email the registry does not hold.
INSERT INTO roles VALUES ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000001e3',
  null, 'د', 'R', false, true, now(), now());
SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000000e1';
DO $$
DECLARE r uuid := '00000000-0000-7000-8000-0000000001e3'; inv uuid := '00000000-0000-7000-8000-0000000001e4';
BEGIN
  BEGIN
    INSERT INTO memberships VALUES ('00000000-0000-7000-8000-0000000000e1', gen_random_uuid(), gen_random_uuid(),
      'n', 'bypass@example.com', r, true, 'active', 'ar', null, now(), now());
    RAISE EXCEPTION 'EMAIL: membership inserted without a membership hold';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO invitations VALUES ('00000000-0000-7000-8000-0000000000e1', inv, 'bypass@example.com', 'n', r, true,
      'pending', now() + interval '7 days', gen_random_uuid(), 'hash-bypass', now(), null);
    RAISE EXCEPTION 'EMAIL: invitation inserted without a hold';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- The intended path: hold, invite, accept (convert), then the membership.
  IF NOT reserve_invitation_email('proper@example.com', inv, now() + interval '7 days') THEN RAISE EXCEPTION 'EMAIL: proper hold failed'; END IF;
  INSERT INTO invitations VALUES ('00000000-0000-7000-8000-0000000000e1', inv, 'proper@example.com', 'n', r, true,
    'pending', now() + interval '7 days', gen_random_uuid(), 'hash-proper', now(), null);
  IF NOT convert_invitation_email_to_membership('proper@example.com', inv) THEN RAISE EXCEPTION 'EMAIL: proper accept failed'; END IF;
  INSERT INTO memberships VALUES ('00000000-0000-7000-8000-0000000000e1', gen_random_uuid(), gen_random_uuid(),
    'n', 'proper@example.com', r, true, 'active', 'ar', null, now(), now());
  -- A converted hold admits exactly one membership: a second row with the same email is refused.
  BEGIN
    INSERT INTO memberships VALUES ('00000000-0000-7000-8000-0000000000e1', gen_random_uuid(), gen_random_uuid(),
      'n', 'Proper@Example.com', r, true, 'active', 'ar', null, now(), now());
    RAISE EXCEPTION 'EMAIL: a second membership reused a converted hold';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- An invitation may not outlive its hold, on insert or when its expiry is pushed later.
  IF NOT reserve_invitation_email('short@example.com', '00000000-0000-7000-8000-0000000001e5', now() + interval '1 day') THEN
    RAISE EXCEPTION 'EMAIL: short hold failed';
  END IF;
  BEGIN
    INSERT INTO invitations VALUES ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000001e5',
      'short@example.com', 'n', r, true, 'pending', now() + interval '7 days', gen_random_uuid(), 'hash-short', now(), null);
    RAISE EXCEPTION 'EMAIL: invitation outlives its hold';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO invitations VALUES ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000001e5',
    'short@example.com', 'n', r, true, 'pending', now() + interval '1 day', gen_random_uuid(), 'hash-short', now(), null);
  BEGIN
    UPDATE invitations SET expires_at = now() + interval '7 days' WHERE id = '00000000-0000-7000-8000-0000000001e5';
    RAISE EXCEPTION 'EMAIL: invitation expiry pushed past its hold';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- The hold check answers for the caller's clinic only: clinic B's membership is invisible.
  IF email_hold_matches('person@example.com', 'membership', NULL, NULL) THEN
    NULL; -- person@example.com is clinic A's own membership; visible to A, as expected
  ELSE
    RAISE EXCEPTION 'EMAIL: own membership hold not visible';
  END IF;
  IF email_hold_matches('temp@example.com', 'invitation', '00000000-0000-7000-8000-0000000001f3', now()) THEN
    RAISE EXCEPTION 'EMAIL: hold check leaked another clinic''s invitation';
  END IF;
END $$;
RESET ROLE;

\echo 'Email reservation tests: all passed'
ROLLBACK;
