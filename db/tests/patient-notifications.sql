-- Patient notifications (0053–0056, docs/specs/notifications-design.md §2): grants, the patient fields,
-- the ledger's one-message rule and its CHECKs. Cross-clinic isolation is in rls-isolation.sql.
-- Runs inside one transaction and ROLLS BACK, so it is safe on any database that has the db/sql baseline.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/patient-notifications.sql

BEGIN;

-- Grants: the clinic role reads, inserts and updates, never deletes; every other runtime role has
-- nothing, the platform included (the ledger names patients). RLS is enabled and forced on both.
DO $$
DECLARE t text; r text; priv text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clinic_notification_settings','patient_notifications'] LOOP
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname = t) THEN
      RAISE EXCEPTION 'NOTIFY-GRANTS: RLS is not enabled and forced on %', t;
    END IF;
    FOREACH r IN ARRAY ARRAY['eyadex_platform','eyadex_auth','eyadex_dispatcher'] LOOP
      FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(r, t, priv) THEN
          RAISE EXCEPTION 'NOTIFY-GRANTS: % has % on %', r, priv, t;
        END IF;
      END LOOP;
    END LOOP;
    FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
      IF NOT has_table_privilege('eyadex_app', t, priv) THEN
        RAISE EXCEPTION 'NOTIFY-GRANTS: eyadex_app lacks % on %', priv, t;
      END IF;
    END LOOP;
    FOREACH priv IN ARRAY ARRAY['DELETE','TRUNCATE'] LOOP
      IF has_table_privilege('eyadex_app', t, priv) THEN
        RAISE EXCEPTION 'NOTIFY-GRANTS: eyadex_app has % on %', priv, t;
      END IF;
    END LOOP;
  END LOOP;
  -- The patient's new fields: the clinic role writes them, the platform reads none of them.
  FOREACH t IN ARRAY ARRAY['email','message_language','notifications_opt_out'] LOOP
    IF has_column_privilege('eyadex_platform', 'patients', t, 'SELECT') THEN
      RAISE EXCEPTION 'NOTIFY-GRANTS: the platform can read patients.%', t;
    END IF;
    IF NOT has_column_privilege('eyadex_app', 'patients', t, 'UPDATE') THEN
      RAISE EXCEPTION 'NOTIFY-GRANTS: eyadex_app cannot update patients.%', t;
    END IF;
  END LOOP;
END $$;

-- One clinic with a branch, a patient and an appointment, written by the owner.
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-00000000056a','notify','ن','N','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
INSERT INTO branches VALUES ('00000000-0000-7000-8000-00000000056a', '00000000-0000-7000-8000-0000000561a1', 'ف', 'B', true, now(), now());
INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
    status, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-00000000056a', '00000000-0000-7000-8000-0000000561a2', '1', 'x', '+96500000561',
    '1990-01-01', 'female', '00000000-0000-7000-8000-0000000561a1', 'active', now(), now());

SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-00000000056a';

-- The patient's fields (0053): no email and the clinic's language by default, reminders on.
DO $$
DECLARE p uuid := '00000000-0000-7000-8000-0000000561a2'; bad text;
BEGIN
  IF (SELECT email IS NOT NULL OR message_language IS NOT NULL OR notifications_opt_out FROM patients WHERE id = p) THEN
    RAISE EXCEPTION 'NOTIFY-PATIENT: a new patient has an email, a language or an opt-out';
  END IF;
  UPDATE patients SET email = 'name.surname+tag@example.com', message_language = 'en', notifications_opt_out = true
    WHERE id = p;
  FOREACH bad IN ARRAY ARRAY['Name@example.com', ' name@example.com', 'no-at-sign', 'two words@example.com',
      repeat('a', 243) || '@example.com'] LOOP
    BEGIN
      UPDATE patients SET email = bad WHERE id = p;
      RAISE EXCEPTION 'NOTIFY-PATIENT: the email "%" was accepted', bad;
    EXCEPTION WHEN check_violation THEN NULL; END;
  END LOOP;
  BEGIN
    UPDATE patients SET message_language = 'fr' WHERE id = p;
    RAISE EXCEPTION 'NOTIFY-PATIENT: an unknown message language was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE patients SET notifications_opt_out = NULL WHERE id = p;
    RAISE EXCEPTION 'NOTIFY-PATIENT: a NULL opt-out was accepted';
  EXCEPTION WHEN not_null_violation THEN NULL; END;
END $$;

-- The settings (0054): one row per clinic.
DO $$
BEGIN
  INSERT INTO clinic_notification_settings VALUES ('00000000-0000-7000-8000-00000000056a', gen_random_uuid(),
    true, true, true, true, false, true, true, now(), now());
  BEGIN
    INSERT INTO clinic_notification_settings VALUES ('00000000-0000-7000-8000-00000000056a', gen_random_uuid(),
      true, true, true, true, true, true, true, now(), now());
    RAISE EXCEPTION 'NOTIFY-SETTINGS: a second settings row was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

-- The ledger (0056): one message per subject, kind, channel and appointment start.
DO $$
DECLARE
  c uuid := '00000000-0000-7000-8000-00000000056a';
  p uuid := '00000000-0000-7000-8000-0000000561a2';
  appt uuid := '00000000-0000-7000-8000-0000000561b1';
  visit uuid := '00000000-0000-7000-8000-0000000561b2';
  at1 timestamptz := '2026-11-01 09:00+03';
  at2 timestamptz := '2026-11-02 09:00+03';
  n bigint;
BEGIN
  INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id, subject_at, status, created_at, updated_at)
    VALUES (c, gen_random_uuid(), p, 'reminder_day', 'email', 'appointment', appt, at1, 'queued', now(), now());
  -- A retry or a second scan for the same start conflicts …
  BEGIN
    INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id, subject_at, status, created_at, updated_at)
      VALUES (c, gen_random_uuid(), p, 'reminder_day', 'email', 'appointment', appt, at1, 'queued', now(), now());
    RAISE EXCEPTION 'NOTIFY-ONCE: a second identical reminder was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- … and the scanner's ON CONFLICT DO NOTHING inserts nothing.
  INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id, subject_at, status, created_at, updated_at)
    VALUES (c, gen_random_uuid(), p, 'reminder_day', 'email', 'appointment', appt, at1, 'queued', now(), now())
    ON CONFLICT ON CONSTRAINT patient_notifications_once DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'NOTIFY-ONCE: ON CONFLICT DO NOTHING inserted a duplicate'; END IF;
  -- A reschedule (new start) gets a fresh reminder; another kind or channel is another message.
  INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id, subject_at, status, created_at, updated_at)
    VALUES (c, gen_random_uuid(), p, 'reminder_day', 'email', 'appointment', appt, at2, 'queued', now(), now());
  INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id, subject_at, status, created_at, updated_at)
    VALUES (c, gen_random_uuid(), p, 'reminder_2h', 'email', 'appointment', appt, at1, 'queued', now(), now());
  INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id, subject_at, status, created_at, updated_at)
    VALUES (c, gen_random_uuid(), p, 'reminder_day', 'whatsapp', 'appointment', appt, at1, 'queued', now(), now());
  -- The prescription has no start: NULLS NOT DISTINCT still allows only one per visit.
  INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id, subject_at, status, requested_by, created_at, updated_at)
    VALUES (c, gen_random_uuid(), p, 'prescription', 'email', 'visit', visit, NULL, 'queued', gen_random_uuid(), now(), now());
  BEGIN
    INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id, subject_at, status, created_at, updated_at)
      VALUES (c, gen_random_uuid(), p, 'prescription', 'email', 'visit', visit, NULL, 'queued', now(), now());
    RAISE EXCEPTION 'NOTIFY-ONCE: a second prescription email for one visit was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  SELECT count(*) INTO n FROM patient_notifications;
  IF n <> 5 THEN RAISE EXCEPTION 'NOTIFY-ONCE: % ledger rows, expected 5', n; END IF;
END $$;

-- The ledger's CHECKs: a skip says why, a send says by which route and when, nothing else carries either.
DO $$
DECLARE
  c uuid := '00000000-0000-7000-8000-00000000056a';
  p uuid := '00000000-0000-7000-8000-0000000561a2';
  row_id uuid := '00000000-0000-7000-8000-0000000561c1';
  probe text;
BEGIN
  INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id, subject_at, status, created_at, updated_at)
    VALUES (c, row_id, p, 'booked', 'email', 'appointment', gen_random_uuid(), now(), 'queued', now(), now());
  -- Each probe must be refused by a CHECK.
  FOREACH probe IN ARRAY ARRAY[
      $q$UPDATE patient_notifications SET status = 'skipped' WHERE id = $1$q$,
      $q$UPDATE patient_notifications SET skip_reason = 'no_email' WHERE id = $1$q$,
      $q$UPDATE patient_notifications SET status = 'failed', skip_reason = 'no_email' WHERE id = $1$q$,
      $q$UPDATE patient_notifications SET status = 'skipped', skip_reason = 'bounced' WHERE id = $1$q$,
      $q$UPDATE patient_notifications SET status = 'sent', sent_at = now() WHERE id = $1$q$,
      $q$UPDATE patient_notifications SET status = 'sent', route = 'primary' WHERE id = $1$q$,
      $q$UPDATE patient_notifications SET route = 'primary' WHERE id = $1$q$,
      $q$UPDATE patient_notifications SET status = 'failed', route = 'fallback' WHERE id = $1$q$,
      $q$UPDATE patient_notifications SET status = 'sent', route = 'smtp', sent_at = now() WHERE id = $1$q$,
      $q$UPDATE patient_notifications SET status = 'delivered' WHERE id = $1$q$,
      $q$UPDATE patient_notifications SET kind = 'promotion' WHERE id = $1$q$,
      $q$UPDATE patient_notifications SET channel = 'sms' WHERE id = $1$q$,
      $q$UPDATE patient_notifications SET subject_at = NULL WHERE id = $1$q$,
      $q$UPDATE patient_notifications SET subject_type = 'visit' WHERE id = $1$q$,
      $q$UPDATE patient_notifications SET kind = 'prescription' WHERE id = $1$q$,
      $q$UPDATE patient_notifications SET attempts = -1 WHERE id = $1$q$,
      $q$UPDATE patient_notifications SET last_error = repeat('e', 121) WHERE id = $1$q$] LOOP
    BEGIN
      EXECUTE probe USING row_id;
      RAISE EXCEPTION 'NOTIFY-CHECK: accepted: %', probe;
    EXCEPTION WHEN check_violation THEN NULL; END;
  END LOOP;
  -- The legal moves: retried, then sent; and a skip with its reason.
  UPDATE patient_notifications SET attempts = attempts + 1, last_error = 'smtp_timeout' WHERE id = row_id;
  UPDATE patient_notifications SET status = 'sent', route = 'fallback', sent_at = now() WHERE id = row_id;
  INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id, subject_at, status, skip_reason, created_at, updated_at)
    VALUES (c, gen_random_uuid(), p, 'cancelled', 'email', 'appointment', gen_random_uuid(), now(), 'skipped', 'opted_out', now(), now());
  -- The ledger needs a patient of the clinic.
  BEGIN
    INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id, subject_at, status, created_at, updated_at)
      VALUES (c, gen_random_uuid(), gen_random_uuid(), 'booked', 'email', 'appointment', gen_random_uuid(), now(), 'queued', now(), now());
    RAISE EXCEPTION 'NOTIFY-CHECK: a row for an unknown patient was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
RESET ROLE;

\echo 'patient notification tests: all passed'
ROLLBACK;
