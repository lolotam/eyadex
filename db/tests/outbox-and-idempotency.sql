-- Outbox + idempotency ledger (0025) and the permission catalogue (0026). Rolls back; safe anywhere.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/outbox-and-idempotency.sql

BEGIN;

INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language, timezone, status,
  expires_at, max_users, max_branches, created_at, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000005a1','obx-a','أ','A','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000005a2','obx-b','ب','B','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());

-- Catalogue: grants on both tables are exactly what ADR-0006 lists.
DO $$
DECLARE
  r text;
  priv text;
BEGIN
  FOREACH r IN ARRAY ARRAY['eyadex_app','eyadex_platform'] LOOP
    IF NOT has_table_privilege(r, 'outbox_events', 'INSERT') THEN
      RAISE EXCEPTION 'OUTBOX: % cannot insert', r;
    END IF;
    FOREACH priv IN ARRAY ARRAY['SELECT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(r, 'outbox_events', priv) THEN
        RAISE EXCEPTION 'OUTBOX: writer % has %', r, priv;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_table_privilege('eyadex_dispatcher', 'outbox_events', 'SELECT')
     OR NOT has_column_privilege('eyadex_dispatcher', 'outbox_events', 'dispatched_at', 'UPDATE') THEN
    RAISE EXCEPTION 'OUTBOX: dispatcher cannot read or mark events';
  END IF;
  FOREACH priv IN ARRAY ARRAY['INSERT','DELETE','TRUNCATE'] LOOP
    IF has_table_privilege('eyadex_dispatcher', 'outbox_events', priv) THEN
      RAISE EXCEPTION 'OUTBOX: dispatcher has %', priv;
    END IF;
  END LOOP;
  IF has_column_privilege('eyadex_dispatcher', 'outbox_events', 'event_type', 'UPDATE')
     OR has_column_privilege('eyadex_dispatcher', 'outbox_events', 'clinic_id', 'UPDATE') THEN
    RAISE EXCEPTION 'OUTBOX: dispatcher can rewrite an event';
  END IF;
  -- The dispatcher touches the outbox and nothing else (PRD §4.5).
  FOR r IN SELECT c.relname FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','v') AND c.relname <> 'outbox_events' LOOP
    FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      IF has_table_privilege('eyadex_dispatcher', r, priv) THEN
        RAISE EXCEPTION 'OUTBOX: dispatcher has % on %', priv, r;
      END IF;
    END LOOP;
  END LOOP;
  -- Idempotency ledger: platform only, no delete, response the only updatable column.
  FOREACH r IN ARRAY ARRAY['eyadex_app','eyadex_auth','eyadex_dispatcher'] LOOP
    FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      IF has_table_privilege(r, 'idempotency_keys', priv) THEN
        RAISE EXCEPTION 'IDEMPOTENCY: % has %', r, priv;
      END IF;
    END LOOP;
  END LOOP;
  IF has_table_privilege('eyadex_platform', 'idempotency_keys', 'DELETE')
     OR has_column_privilege('eyadex_platform', 'idempotency_keys', 'request_hash', 'UPDATE') THEN
    RAISE EXCEPTION 'IDEMPOTENCY: platform can rewrite a key';
  END IF;
  -- 23 MVP keys (0026) + 17 of the appointments module (0042) + view:patients:own (0044)
  -- + 10 of the medical module (0046) + 13 of the finance module (0060) + 10 of finance F2 (0064)
  -- + 7 report keys of finance F3 (0068).
  IF (SELECT count(*) FROM permissions) <> 81 THEN
    RAISE EXCEPTION 'CATALOGUE: expected 81 permissions, found %', (SELECT count(*) FROM permissions);
  END IF;
END $$;

-- Negative isolation: a clinic session cannot enqueue for another clinic, nor read the outbox.
SET LOCAL ROLE eyadex_app;
SELECT set_config('app.clinic_id', '00000000-0000-7000-8000-0000000005a1', true);
INSERT INTO outbox_events VALUES (gen_random_uuid(), '00000000-0000-7000-8000-0000000005a1', 'clinic.test', '{}', now(), NULL);
DO $$ BEGIN
  BEGIN
    INSERT INTO outbox_events VALUES (gen_random_uuid(), '00000000-0000-7000-8000-0000000005a2', 'clinic.test', '{}', now(), NULL);
    RAISE EXCEPTION 'OUTBOX write leak: another clinic';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO outbox_events VALUES (gen_random_uuid(), NULL, 'clinic.test', '{}', now(), NULL);
    RAISE EXCEPTION 'OUTBOX write leak: clinic-less event from a clinic context';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM outbox_events;
    RAISE EXCEPTION 'OUTBOX read leak: eyadex_app';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- The dispatcher sees every clinic's events and marks them.
SET LOCAL ROLE eyadex_dispatcher;
DO $$ DECLARE n integer; BEGIN
  UPDATE outbox_events SET dispatched_at = now() WHERE dispatched_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n < 1 THEN RAISE EXCEPTION 'OUTBOX: dispatcher marked nothing'; END IF;
  BEGIN
    PERFORM 1 FROM clinics;
    RAISE EXCEPTION 'OUTBOX: dispatcher read clinics';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

\echo 'Outbox, idempotency and catalogue tests: all passed'
ROLLBACK;
