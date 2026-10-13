-- WhatsApp notifications (0057–0059, docs/specs/notifications-design.md §7.1, §7.2): the channel table's
-- grants and CHECKs, the settings switch's default, the ledger's widened route and skip reasons, the
-- delivery times, one Meta number per clinic and the pre-tenant routing function.
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
-- Ledger acceptance metadata survives only a delivery rejection, and provider ids are bounded/indexed.
SET LOCAL ROLE eyadex_app;
SELECT set_config('app.clinic_id', '00000000-0000-7000-8000-00000000057a', true);
DO $$
DECLARE c uuid := '00000000-0000-7000-8000-00000000057a'; p uuid := '00000000-0000-7000-8000-0000000571a2'; n uuid := gen_random_uuid();
BEGIN
  INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id,
    subject_at, status, route, sent_at, provider_message_id, created_at, updated_at)
    VALUES (c, n, p, 'booked', 'whatsapp', 'appointment', gen_random_uuid(), now(), 'sent',
      'evolution', now(), 'evo.fake', now(), now());
  UPDATE patient_notifications SET status = 'failed', last_error = 'evolution:evo_delivery_rejected' WHERE id = n;
  IF NOT EXISTS (SELECT 1 FROM patient_notifications WHERE id = n AND route = 'evolution'
    AND sent_at IS NOT NULL AND provider_message_id = 'evo.fake') THEN
    RAISE EXCEPTION 'WA-LEDGER: delivery rejection lost acceptance metadata';
  END IF;
  BEGIN
    UPDATE patient_notifications SET provider_message_id = repeat('x', 201) WHERE id = n;
    RAISE EXCEPTION 'WA-LEDGER: oversized provider id accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE patient_notifications SET last_error = NULL WHERE id = n;
    RAISE EXCEPTION 'WA-LEDGER: failed acceptance metadata allowed without a rejection';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE patient_notifications SET last_error = 'evolution:evo_timeout' WHERE id = n;
    RAISE EXCEPTION 'WA-LEDGER: another failed code retained acceptance metadata';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE patient_notifications SET route = 'coexistence' WHERE id = n;
    RAISE EXCEPTION 'WA-LEDGER: another transport retained rejection metadata';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE patient_notifications SET sent_at = NULL WHERE id = n;
    RAISE EXCEPTION 'WA-LEDGER: only one acceptance field allowed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'patient_notifications'
      AND indexname = 'patient_notifications_clinic_provider_message_idx'
      AND indexdef LIKE '%(clinic_id, provider_message_id)%'
      AND indexdef LIKE '%WHERE (provider_message_id IS NOT NULL)%') THEN
    RAISE EXCEPTION 'WA-LEDGER: missing tenant-prefixed partial provider-id index';
  END IF;
END $$;
RESET ROLE;

-- 0059: the routing function is SECURITY DEFINER, owned by its own NOLOGIN role without BYPASSRLS (never
-- the migration owner, which FORCE RLS would leave blind), pins its search_path, and only eyadex_app runs it.
DO $$
DECLARE f oid := 'whatsapp_clinic_for_phone_number(text)'::regprocedure; r text;
BEGIN
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f) THEN
    RAISE EXCEPTION 'WA-ROUTE: the routing function is not SECURITY DEFINER';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = f) <> 's' THEN
    RAISE EXCEPTION 'WA-ROUTE: the routing function is not STABLE';
  END IF;
  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = f) <> 'eyadex_whatsapp_routing_owner' THEN
    RAISE EXCEPTION 'WA-ROUTE: the routing function has another owner';
  END IF;
  IF (SELECT rolcanlogin OR rolbypassrls OR rolsuper FROM pg_roles
      WHERE rolname = 'eyadex_whatsapp_routing_owner') THEN
    RAISE EXCEPTION 'WA-ROUTE: the routing owner can log in or bypass RLS';
  END IF;
  IF NOT (SELECT 'search_path=pg_catalog, public' = ANY (proconfig) FROM pg_proc WHERE oid = f) THEN
    RAISE EXCEPTION 'WA-ROUTE: the routing function does not pin its search_path';
  END IF;
  IF NOT has_function_privilege('eyadex_app', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'WA-ROUTE: eyadex_app cannot run the routing function';
  END IF;
  FOREACH r IN ARRAY ARRAY['eyadex_platform','eyadex_auth','eyadex_dispatcher'] LOOP
    IF has_function_privilege(r, f, 'EXECUTE') THEN
      RAISE EXCEPTION 'WA-ROUTE: % can run the routing function', r;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc, aclexplode(proacl) a WHERE oid = f AND a.grantee = 0) THEN
    RAISE EXCEPTION 'WA-ROUTE: PUBLIC can run the routing function';
  END IF;
  -- The owner reads the three routing columns and nothing else.
  IF has_column_privilege('eyadex_whatsapp_routing_owner', 'clinic_whatsapp_channels',
      'sealed_credentials', 'SELECT')
     OR has_table_privilege('eyadex_whatsapp_routing_owner', 'clinic_whatsapp_channels', 'UPDATE') THEN
    RAISE EXCEPTION 'WA-ROUTE: the routing owner reads more than the routing columns';
  END IF;
END $$;

-- A second clinic, its channel written inside its own context.
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-00000000059b','whatsapp-b','ب','WB','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
SET LOCAL ROLE eyadex_app;
SELECT set_config('app.clinic_id', '00000000-0000-7000-8000-00000000059b', true);
INSERT INTO clinic_whatsapp_channels (clinic_id, id, transport, status, instance_name, phone_number_id,
    connected_at, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-00000000059b', '00000000-0000-7000-8000-0000000591b1', 'evolution',
    'connected', 'eyadex-00000000-0000-7000-8000-00000000059b', '555555555', now(), now(), now());

-- Routing: only a coexistence channel answers, from any clinic context or none, and only with its id.
DO $$
DECLARE a uuid := '00000000-0000-7000-8000-00000000057a';
BEGIN
  IF whatsapp_clinic_for_phone_number('123456789') IS DISTINCT FROM a THEN
    RAISE EXCEPTION 'WA-ROUTE: the coexistence number of A did not route to A from the context of B';
  END IF;
  IF whatsapp_clinic_for_phone_number('555555555') IS NOT NULL THEN
    RAISE EXCEPTION 'WA-ROUTE: the number of an Evolution channel routed';
  END IF;
  IF whatsapp_clinic_for_phone_number('99999999') IS NOT NULL THEN
    RAISE EXCEPTION 'WA-ROUTE: an unknown number routed';
  END IF;
  -- The function opens nothing else: B still cannot read the channel of A.
  IF EXISTS (SELECT 1 FROM clinic_whatsapp_channels WHERE clinic_id = a) THEN
    RAISE EXCEPTION 'WA-ROUTE: B reads the channel of A';
  END IF;
  -- One Meta number belongs to one clinic, whatever the transport or status of the other row.
  BEGIN
    UPDATE clinic_whatsapp_channels SET phone_number_id = '123456789';
    RAISE EXCEPTION 'WA-UNIQUE: B took the Meta number of A';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
SELECT set_config('app.clinic_id', '', true);
DO $$
BEGIN
  IF whatsapp_clinic_for_phone_number('123456789') IS DISTINCT FROM
      '00000000-0000-7000-8000-00000000057a'::uuid THEN
    RAISE EXCEPTION 'WA-ROUTE: the number did not route without a clinic context';
  END IF;
END $$;
SELECT set_config('app.clinic_id', '00000000-0000-7000-8000-00000000057a', true);
UPDATE clinic_whatsapp_channels SET status = 'disconnected', connected_at = NULL;
SELECT set_config('app.clinic_id', '00000000-0000-7000-8000-00000000059b', true);
DO $$
BEGIN
  BEGIN
    UPDATE clinic_whatsapp_channels SET phone_number_id = '123456789';
    RAISE EXCEPTION 'WA-UNIQUE: the number of a disconnected clinic was taken';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'clinic_whatsapp_channels'
      AND indexname = 'clinic_whatsapp_channels_phone_number_unique'
      AND indexdef LIKE 'CREATE UNIQUE INDEX%(phone_number_id)%'
      AND indexdef LIKE '%WHERE (phone_number_id IS NOT NULL)%') THEN
    RAISE EXCEPTION 'WA-UNIQUE: missing the partial unique index on phone_number_id';
  END IF;
END $$;

-- Delivery times: accepted WhatsApp rows only, read after delivered; a delivery failure keeps the
-- acceptance metadata for the delivery codes of its own transport only.
SELECT set_config('app.clinic_id', '00000000-0000-7000-8000-00000000057a', true);
DO $$
DECLARE c uuid := '00000000-0000-7000-8000-00000000057a'; p uuid := '00000000-0000-7000-8000-0000000571a2';
  n uuid := gen_random_uuid(); e uuid := gen_random_uuid(); q uuid := gen_random_uuid(); code text;
BEGIN
  INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id,
      subject_at, status, route, sent_at, provider_message_id, created_at, updated_at)
    VALUES (c, n, p, 'booked', 'whatsapp', 'appointment', gen_random_uuid(), now(), 'sent', 'coexistence',
      now(), 'wamid.fake', now(), now()),
      (c, e, p, 'booked', 'email', 'appointment', gen_random_uuid(), now(), 'sent', 'primary', now(), NULL,
      now(), now());
  INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id,
      subject_at, status, created_at, updated_at)
    VALUES (c, q, p, 'reminder_day', 'whatsapp', 'appointment', gen_random_uuid(), now(), 'queued', now(), now());
  BEGIN
    UPDATE patient_notifications SET read_at = now() WHERE id = n;
    RAISE EXCEPTION 'WA-DELIVERY: read without delivered was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE patient_notifications SET delivered_at = now() WHERE id = e;
    RAISE EXCEPTION 'WA-DELIVERY: an email row took a delivery time';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE patient_notifications SET delivered_at = now() WHERE id = q;
    RAISE EXCEPTION 'WA-DELIVERY: an unsent row took a delivery time';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE patient_notifications SET delivered_at = now(), read_at = now() WHERE id = n;
  FOREACH code IN ARRAY ARRAY['meta_not_on_whatsapp', 'meta_rejected', 'meta_rate_limited', 'meta_template'] LOOP
    UPDATE patient_notifications SET status = 'failed', last_error = 'coexistence:' || code WHERE id = n;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM patient_notifications WHERE id = n AND route = 'coexistence'
      AND sent_at IS NOT NULL AND delivered_at IS NOT NULL AND read_at IS NOT NULL) THEN
    RAISE EXCEPTION 'WA-DELIVERY: a coexistence delivery failure lost its acceptance metadata';
  END IF;
  FOREACH code IN ARRAY ARRAY['coexistence:meta_timeout', 'coexistence:meta_two_step',
      'evolution:evo_delivery_rejected', 'coexistence:other', 'meta_rejected'] LOOP
    BEGIN
      UPDATE patient_notifications SET last_error = code WHERE id = n;
      RAISE EXCEPTION 'WA-DELIVERY: % kept the acceptance metadata', code;
    EXCEPTION WHEN check_violation THEN NULL; END;
  END LOOP;
  -- An Evolution row cannot keep its acceptance metadata on a Meta delivery code.
  UPDATE patient_notifications SET status = 'sent', last_error = NULL, route = 'evolution' WHERE id = n;
  BEGIN
    UPDATE patient_notifications SET status = 'failed', last_error = 'coexistence:meta_rejected' WHERE id = n;
    RAISE EXCEPTION 'WA-DELIVERY: an Evolution row kept a Meta delivery code';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- A failure before acceptance names any code, without a route.
  UPDATE patient_notifications SET status = 'failed', last_error = 'coexistence:meta_two_step' WHERE id = q;
END $$;
RESET ROLE;
\echo 'WhatsApp channel tests: all passed'
ROLLBACK;
