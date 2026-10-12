-- WhatsApp notifications (0057–0058, docs/specs/notifications-design.md §7.1): the channel table's grants
-- and CHECKs, the settings switch's default, and the ledger's widened route and skip reasons.
-- Cross-clinic isolation is in rls-isolation.sql.
-- Runs inside one transaction and ROLLS BACK, so it is safe on any database that has the db/sql baseline.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/whatsapp-channels.sql

BEGIN;

-- Grants: the clinic role reads, inserts and updates, never deletes; every other runtime role has
-- nothing (the sealed token and the number are the clinic's). RLS is enabled and forced.
DO $$
DECLARE r text; priv text;
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
          WHERE relname = 'clinic_whatsapp_channels') THEN
    RAISE EXCEPTION 'WA-GRANTS: RLS is not enabled and forced on clinic_whatsapp_channels';
  END IF;
  FOREACH r IN ARRAY ARRAY['eyadex_platform','eyadex_auth','eyadex_dispatcher'] LOOP
    FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(r, 'clinic_whatsapp_channels', priv) THEN
        RAISE EXCEPTION 'WA-GRANTS: % has % on clinic_whatsapp_channels', r, priv;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
    IF NOT has_table_privilege('eyadex_app', 'clinic_whatsapp_channels', priv) THEN
      RAISE EXCEPTION 'WA-GRANTS: eyadex_app lacks % on clinic_whatsapp_channels', priv;
    END IF;
  END LOOP;
  FOREACH priv IN ARRAY ARRAY['DELETE','TRUNCATE'] LOOP
    IF has_table_privilege('eyadex_app', 'clinic_whatsapp_channels', priv) THEN
      RAISE EXCEPTION 'WA-GRANTS: eyadex_app has % on clinic_whatsapp_channels', priv;
    END IF;
  END LOOP;
END $$;

-- One clinic with a branch, a patient and saved settings from before 0058, written by the owner.
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-00000000057a','whatsapp','و','W','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
INSERT INTO branches VALUES ('00000000-0000-7000-8000-00000000057a', '00000000-0000-7000-8000-0000000571a1', 'ف', 'B', true, now(), now());
INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
    status, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-00000000057a', '00000000-0000-7000-8000-0000000571a2', '1', 'x', '+96500000571',
    '1990-01-01', 'female', '00000000-0000-7000-8000-0000000571a1', 'active', now(), now());
INSERT INTO clinic_notification_settings (clinic_id, id, email_enabled, booked, rescheduled, cancelled,
    reminder_day, reminder_2h, prescription, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-00000000057a', '00000000-0000-7000-8000-0000000571a3', true, true, true,
    true, true, true, true, now(), now());

SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-00000000057a';

-- 0058: a clinic's saved settings gain WhatsApp switched off.
DO $$
BEGIN
  IF (SELECT whatsapp_enabled FROM clinic_notification_settings) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'WA-SETTINGS: whatsapp_enabled is not false on an existing row';
  END IF;
END $$;

-- 0057: the channel row's shape.
DO $$
DECLARE c uuid := '00000000-0000-7000-8000-00000000057a'; bad text;
BEGIN
  -- A linked Evolution number, then the same row unlinked: both accepted.
  INSERT INTO clinic_whatsapp_channels (clinic_id, id, transport, status, instance_name, phone_last4,
      risk_accepted_at, risk_accepted_by, risk_version, connected_at, created_at, updated_at)
    VALUES (c, '00000000-0000-7000-8000-0000000571b1', 'evolution', 'connected', 'eyadex-'||c, '1234',
      now(), gen_random_uuid(), 1, now(), now(), now());
  UPDATE clinic_whatsapp_channels SET status = 'disconnected', connected_at = NULL, phone_last4 = NULL;
  -- Coexistence ids and templates.
  UPDATE clinic_whatsapp_channels SET transport = 'coexistence', status = 'connected', connected_at = now(),
    phone_number_id = '123456789', business_account_id = '987654321',
    templates = '{"booked": {"name": "booking_ok", "language": "ar"}}';
  -- One per clinic.
  BEGIN
    INSERT INTO clinic_whatsapp_channels (clinic_id, id, status, created_at, updated_at)
      VALUES (c, gen_random_uuid(), 'disconnected', now(), now());
    RAISE EXCEPTION 'WA-CHECK: a second channel row was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- Each refused shape.
  FOREACH bad IN ARRAY ARRAY[
    'status = ''linked''',
    'transport = ''cloud''',
    'phone_last4 = ''123''',
    'phone_last4 = ''12a4''',
    'phone_number_id = ''12ab5''',
    'business_account_id = ''1234''',
    'templates = ''[]''',
    'last_error = repeat(''x'', 121)',
    'instance_name = repeat(''x'', 101)',
    'risk_version = 0',
    'risk_version = NULL',
    'risk_accepted_by = NULL',
    'connected_at = NULL',
    'status = ''pending'', transport = NULL',
    'status = ''pending'''
  ] LOOP
    BEGIN
      EXECUTE format('UPDATE clinic_whatsapp_channels SET %s', bad);
      RAISE EXCEPTION 'WA-CHECK: accepted %', bad;
    EXCEPTION WHEN check_violation THEN NULL; END;
  END LOOP;
END $$;

-- 0058: the ledger names a WhatsApp transport and the two new skip reasons; anything else is refused.
DO $$
DECLARE c uuid := '00000000-0000-7000-8000-00000000057a'; p uuid := '00000000-0000-7000-8000-0000000571a2';
BEGIN
  INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id,
      subject_at, status, route, sent_at, created_at, updated_at)
    VALUES (c, gen_random_uuid(), p, 'booked', 'whatsapp', 'appointment', gen_random_uuid(), now(), 'sent',
      'evolution', now(), now(), now()),
      (c, gen_random_uuid(), p, 'booked', 'whatsapp', 'appointment', gen_random_uuid(), now(), 'sent',
      'coexistence', now(), now(), now());
  INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id,
      subject_at, status, skip_reason, created_at, updated_at)
    VALUES (c, gen_random_uuid(), p, 'reminder_day', 'whatsapp', 'appointment', gen_random_uuid(), now(),
      'skipped', 'whatsapp_disconnected', now(), now()),
      (c, gen_random_uuid(), p, 'reminder_2h', 'whatsapp', 'appointment', gen_random_uuid(), now(),
      'skipped', 'template_missing', now(), now());
  -- The N1 values still pass.
  INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id,
      subject_at, status, route, sent_at, created_at, updated_at)
    VALUES (c, gen_random_uuid(), p, 'booked', 'email', 'appointment', gen_random_uuid(), now(), 'sent',
      'platform', now(), now(), now());
  BEGIN
    INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id,
        subject_at, status, route, sent_at, created_at, updated_at)
      VALUES (c, gen_random_uuid(), p, 'booked', 'whatsapp', 'appointment', gen_random_uuid(), now(), 'sent',
        'cloud_api', now(), now(), now());
    RAISE EXCEPTION 'WA-LEDGER: an unknown route was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id,
        subject_at, status, skip_reason, created_at, updated_at)
      VALUES (c, gen_random_uuid(), p, 'booked', 'whatsapp', 'appointment', gen_random_uuid(), now(),
        'skipped', 'banned', now(), now());
    RAISE EXCEPTION 'WA-LEDGER: an unknown skip reason was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

RESET ROLE;
\echo 'WhatsApp channel tests: all passed'
ROLLBACK;
