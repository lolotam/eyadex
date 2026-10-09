-- Retention of the technical ledgers (0040, ADR-0022). Rolls back; safe anywhere: the assertions name
-- the rows this file seeds, so rows already in the database never change the result.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/retention.sql

BEGIN;

-- Who may run a purge: the dispatcher, and no other runtime role.
DO $$
DECLARE
  fn text;
  r  text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['purge_expired_outbox_events(integer)', 'purge_expired_idempotency_keys(integer)',
      'purge_expired_clinic_idempotency_keys(integer)'] LOOP
    IF NOT has_function_privilege('eyadex_dispatcher', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'RETENTION: the dispatcher cannot run %', fn;
    END IF;
    FOREACH r IN ARRAY ARRAY['eyadex_app', 'eyadex_platform', 'eyadex_auth'] LOOP
      IF has_function_privilege(r, fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'RETENTION: % can run %', r, fn;
      END IF;
    END LOOP;
    IF NOT (SELECT p.prosecdef AND p.proowner = 'eyadex_retention_owner'::regrole
              AND p.proconfig @> ARRAY['search_path=public, pg_temp']
            FROM pg_proc p WHERE p.oid = fn::regprocedure) THEN
      RAISE EXCEPTION 'RETENTION: % is not a pinned SECURITY DEFINER owned by eyadex_retention_owner', fn;
    END IF;
  END LOOP;
  IF (SELECT rolcanlogin OR rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = 'eyadex_retention_owner') THEN
    RAISE EXCEPTION 'RETENTION: eyadex_retention_owner can log in or bypass RLS';
  END IF;
END $$;

-- The owner reaches the three ledgers and nothing else: no audit log, no patient, no clinic table.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v', 'm')
             AND c.relname NOT IN ('outbox_events', 'idempotency_keys', 'clinic_idempotency_keys') LOOP
    IF has_table_privilege('eyadex_retention_owner', t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
       OR has_any_column_privilege('eyadex_retention_owner', t, 'SELECT, INSERT, UPDATE') THEN
      RAISE EXCEPTION 'RETENTION: eyadex_retention_owner has a privilege on %', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['outbox_events', 'idempotency_keys', 'clinic_idempotency_keys'] LOOP
    IF has_table_privilege('eyadex_retention_owner', t, 'INSERT, UPDATE, TRUNCATE')
       OR has_any_column_privilege('eyadex_retention_owner', t, 'INSERT, UPDATE') THEN
      RAISE EXCEPTION 'RETENTION: eyadex_retention_owner can write % beyond DELETE', t;
    END IF;
  END LOOP;
  IF has_column_privilege('eyadex_retention_owner', 'outbox_events', 'payload', 'SELECT')
     OR has_column_privilege('eyadex_retention_owner', 'idempotency_keys', 'response', 'SELECT')
     OR has_column_privilege('eyadex_retention_owner', 'clinic_idempotency_keys', 'response', 'SELECT') THEN
    RAISE EXCEPTION 'RETENTION: eyadex_retention_owner can read a payload or a stored response';
  END IF;
END $$;

-- Seed: two clinics, outbox rows in every state and age, keys on both sides of 30 days in both ledgers.
INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language, timezone, status,
  expires_at, max_users, max_branches, created_at, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000040a1','ret-a','أ','A','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000040a2','ret-b','ب','B','general','en','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());

-- Last hex digit names the case: 1 dispatched 29 d, 2 dispatched 31 d, 3 failed 89 d, 4 failed 91 d,
-- 5 failed 31 d, 6 pending 400 d, 7 retrying 400 d, 8 dispatched 100 d + failed 60 d, 9 unhandled type 400 d.
INSERT INTO outbox_events (id, clinic_id, event_type, payload, created_at, dispatched_at, attempts,
  next_attempt_at, last_error, failed_at) VALUES
  ('00000000-0000-7000-8000-0000000040e1','00000000-0000-7000-8000-0000000040a1','clinic.user_invited','{}', now()-interval '29 days', now()-interval '29 days', 0, NULL, NULL, NULL),
  ('00000000-0000-7000-8000-0000000040e2','00000000-0000-7000-8000-0000000040a2','clinic.user_invited','{}', now()-interval '31 days', now()-interval '31 days', 0, NULL, NULL, NULL),
  ('00000000-0000-7000-8000-0000000040e3','00000000-0000-7000-8000-0000000040a1','clinic.user_invited','{}', now()-interval '90 days', NULL, 5, NULL, 'resend_500', now()-interval '89 days'),
  ('00000000-0000-7000-8000-0000000040e4',NULL,'platform.team_invited','{}', now()-interval '92 days', NULL, 5, NULL, 'resend_500', now()-interval '91 days'),
  ('00000000-0000-7000-8000-0000000040e5','00000000-0000-7000-8000-0000000040a2','clinic.user_invited','{}', now()-interval '32 days', NULL, 1, NULL, 'invalid_payload', now()-interval '31 days'),
  ('00000000-0000-7000-8000-0000000040e6','00000000-0000-7000-8000-0000000040a1','clinic.user_invited','{}', now()-interval '400 days', NULL, 0, NULL, NULL, NULL),
  ('00000000-0000-7000-8000-0000000040e7','00000000-0000-7000-8000-0000000040a2','clinic.user_invited','{}', now()-interval '400 days', NULL, 3, now()-interval '399 days', 'resend_timeout', NULL),
  ('00000000-0000-7000-8000-0000000040e8','00000000-0000-7000-8000-0000000040a1','clinic.user_invited','{}', now()-interval '101 days', now()-interval '100 days', 5, NULL, 'resend_500', now()-interval '60 days'),
  ('00000000-0000-7000-8000-0000000040e9','00000000-0000-7000-8000-0000000040a1','clinic.not_handled_yet','{}', now()-interval '400 days', NULL, 0, NULL, NULL, NULL);

INSERT INTO idempotency_keys (scope, key, request_hash, response, created_at) VALUES
  ('retention-test', 'fresh', repeat('a', 64), '{}', now()-interval '29 days'),
  ('retention-test', 'old',   repeat('a', 64), '{}', now()-interval '31 days');

INSERT INTO clinic_idempotency_keys (clinic_id, id, scope, key, request_hash, response, created_at) VALUES
  ('00000000-0000-7000-8000-0000000040a1','00000000-0000-7000-8000-0000000040c1','branch:create','fresh', repeat('a', 64), '{}', now()-interval '29 days'),
  ('00000000-0000-7000-8000-0000000040a1','00000000-0000-7000-8000-0000000040c2','branch:create','old',   repeat('a', 64), '{}', now()-interval '31 days'),
  ('00000000-0000-7000-8000-0000000040a2','00000000-0000-7000-8000-0000000040c3','branch:create','fresh', repeat('a', 64), '{}', now()-interval '29 days'),
  ('00000000-0000-7000-8000-0000000040a2','00000000-0000-7000-8000-0000000040c4','branch:create','old',   repeat('a', 64), '{}', now()-interval '31 days');

-- The batch cap: 1005 dispatched events older than anything real, so they are the first batch.
INSERT INTO outbox_events (id, clinic_id, event_type, payload, created_at, dispatched_at)
SELECT gen_random_uuid(), NULL, 'retention.cap_probe', '{}', now()-interval '3651 days', now()-interval '3650 days'
FROM generate_series(1, 1005);

-- No other runtime role can call a purge, and a clinic session cannot reach one through its context.
SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000040a1';
DO $$
BEGIN
  BEGIN
    PERFORM purge_expired_clinic_idempotency_keys(10);
    RAISE EXCEPTION 'RETENTION: eyadex_app ran the clinic ledger purge';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE eyadex_platform;
DO $$
BEGIN
  BEGIN
    PERFORM purge_expired_idempotency_keys(10);
    RAISE EXCEPTION 'RETENTION: eyadex_platform ran the platform ledger purge';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE eyadex_dispatcher;
DO $$
DECLARE
  bad integer;
  n   integer;
BEGIN
  -- The cap is the function's: no call can delete more than 1000 rows, and a limit outside 1..1000 fails.
  FOREACH bad IN ARRAY ARRAY[0, 1001, -1, NULL] LOOP
    BEGIN
      PERFORM purge_expired_outbox_events(bad);
      RAISE EXCEPTION 'RETENTION: a limit of % was accepted', bad;
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;
  n := purge_expired_outbox_events(1000);
  IF n <> 1000 THEN RAISE EXCEPTION 'RETENTION: one batch deleted % rows, not 1000', n; END IF;
  -- The dispatcher's own SELECT on the outbox counts what the batch left.
  IF (SELECT count(*) FROM outbox_events WHERE event_type = 'retention.cap_probe') <> 5 THEN
    RAISE EXCEPTION 'RETENTION: the capped batch did not leave exactly 5 of 1005 rows';
  END IF;

  -- Drain everything due, in batches, then prove a second pass finds nothing (idempotent).
  LOOP EXIT WHEN purge_expired_outbox_events(1000) < 1000; END LOOP;
  LOOP EXIT WHEN purge_expired_idempotency_keys(1000) < 1000; END LOOP;
  LOOP EXIT WHEN purge_expired_clinic_idempotency_keys(1000) < 1000; END LOOP;
  IF purge_expired_outbox_events(1000) + purge_expired_idempotency_keys(1000)
     + purge_expired_clinic_idempotency_keys(1000) <> 0 THEN
    RAISE EXCEPTION 'RETENTION: a second pass deleted rows';
  END IF;

  -- Direct deletes stay refused: only the functions decide what goes.
  BEGIN
    DELETE FROM idempotency_keys WHERE scope = 'retention-test';
    RAISE EXCEPTION 'RETENTION: the dispatcher deleted from idempotency_keys directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM clinic_idempotency_keys LIMIT 1;
    RAISE EXCEPTION 'RETENTION: the dispatcher can read clinic_idempotency_keys';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- What survived, read as the migration owner.
DO $$
DECLARE
  kept text;
  gone text;
BEGIN
  SELECT string_agg(right(id::text, 1), '' ORDER BY id) INTO kept FROM outbox_events
  WHERE id::text LIKE '00000000-0000-7000-8000-0000000040e_';
  IF kept <> '1356789' THEN
    RAISE EXCEPTION 'RETENTION: outbox survivors are % (expected 1356789: fresh, failed under 90 d, pending, retrying)', kept;
  END IF;
  IF EXISTS (SELECT 1 FROM outbox_events WHERE event_type = 'retention.cap_probe') THEN
    RAISE EXCEPTION 'RETENTION: the drain left old dispatched events';
  END IF;
  SELECT string_agg(key, ',' ORDER BY key) INTO kept FROM idempotency_keys WHERE scope = 'retention-test';
  IF kept <> 'fresh' THEN RAISE EXCEPTION 'RETENTION: platform keys left: %', kept; END IF;
  SELECT string_agg(right(id::text, 1), '' ORDER BY id) INTO gone FROM clinic_idempotency_keys
  WHERE clinic_id IN ('00000000-0000-7000-8000-0000000040a1', '00000000-0000-7000-8000-0000000040a2');
  IF gone <> '13' THEN
    RAISE EXCEPTION 'RETENTION: clinic keys left are % (expected 13: each clinic''s fresh key only)', gone;
  END IF;
END $$;

\echo 'Retention tests: all passed'
ROLLBACK;
