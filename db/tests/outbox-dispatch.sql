-- Outbox dispatch (0029, ADR-0013). Rolls back; safe anywhere.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/outbox-dispatch.sql

BEGIN;

INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language, timezone, status,
  expires_at, max_users, max_branches, created_at, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000006a1','obd-a','أ','A','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
INSERT INTO outbox_events (id, clinic_id, event_type, payload, created_at) VALUES
  ('00000000-0000-7000-8000-0000000006e1','00000000-0000-7000-8000-0000000006a1','clinic.user_invited',
   '{"sealedToken":"v1.x.y.z","invitationId":"i"}', now());

-- New columns: defaults and checks.
DO $$
BEGIN
  IF (SELECT attempts FROM outbox_events WHERE id = '00000000-0000-7000-8000-0000000006e1') <> 0 THEN
    RAISE EXCEPTION 'DISPATCH: attempts does not default to 0';
  END IF;
  BEGIN
    UPDATE outbox_events SET last_error = repeat('x', 501) WHERE id = '00000000-0000-7000-8000-0000000006e1';
    RAISE EXCEPTION 'DISPATCH: last_error over 500 characters was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE outbox_events SET attempts = -1 WHERE id = '00000000-0000-7000-8000-0000000006e1';
    RAISE EXCEPTION 'DISPATCH: negative attempts was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'outbox_events_pending_idx'
                 AND indexdef LIKE '%failed_at IS NULL%') THEN
    RAISE EXCEPTION 'DISPATCH: the pending index does not exclude given-up events';
  END IF;
END $$;

-- Column grants: exactly the outcome columns, nothing that rewrites what an event is.
DO $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY ARRAY['dispatched_at','payload','attempts','next_attempt_at','last_error','failed_at'] LOOP
    IF NOT has_column_privilege('eyadex_dispatcher', 'outbox_events', col, 'UPDATE') THEN
      RAISE EXCEPTION 'DISPATCH: dispatcher cannot update %', col;
    END IF;
  END LOOP;
  FOREACH col IN ARRAY ARRAY['id','clinic_id','event_type','created_at'] LOOP
    IF has_column_privilege('eyadex_dispatcher', 'outbox_events', col, 'UPDATE') THEN
      RAISE EXCEPTION 'DISPATCH: dispatcher can update %', col;
    END IF;
  END LOOP;
  FOREACH col IN ARRAY ARRAY['eyadex_app','eyadex_platform','eyadex_auth'] LOOP
    IF has_table_privilege(col, 'outbox_events', 'UPDATE') THEN
      RAISE EXCEPTION 'DISPATCH: % can update the outbox', col;
    END IF;
  END LOOP;
END $$;

-- As the dispatcher itself: the outbox works, every clinic table refuses.
SET LOCAL ROLE eyadex_dispatcher;
UPDATE outbox_events SET attempts = attempts + 1, last_error = 'resend_500',
  next_attempt_at = now() + interval '1 minute' WHERE id = '00000000-0000-7000-8000-0000000006e1';
UPDATE outbox_events SET dispatched_at = now(), payload = payload - 'sealedToken'
  WHERE id = '00000000-0000-7000-8000-0000000006e1';
DO $$
DECLARE
  t text;
BEGIN
  IF (SELECT payload ? 'sealedToken' FROM outbox_events WHERE id = '00000000-0000-7000-8000-0000000006e1') THEN
    RAISE EXCEPTION 'DISPATCH: the scrub kept the sealed token';
  END IF;
  FOREACH t IN ARRAY ARRAY['invitations','clinics','memberships','audit_log','patients'] LOOP
    BEGIN
      EXECUTE format('SELECT 1 FROM %I LIMIT 1', t);
      RAISE EXCEPTION 'DISPATCH: dispatcher can read %', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  BEGIN
    UPDATE outbox_events SET event_type = 'clinic.other' WHERE id = '00000000-0000-7000-8000-0000000006e1';
    RAISE EXCEPTION 'DISPATCH: dispatcher rewrote event_type';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM outbox_events WHERE id = '00000000-0000-7000-8000-0000000006e1';
    RAISE EXCEPTION 'DISPATCH: dispatcher deleted an event';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

ROLLBACK;
