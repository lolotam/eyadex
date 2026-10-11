-- The medical tables and audit rows never reach the platform (0046–0049, 0051; spec §4, §5; P2 R1-1, P2-K3).
-- Runs inside one transaction and ROLLS BACK, so it is safe on any database that has the db/sql baseline.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/medical-platform-grants.sql

BEGIN;

-- Grants: the platform (and every role but the clinic one) has no privilege at all; the clinic role
-- reads, inserts and updates, never deletes; an addendum is append-only.
DO $$
DECLARE t text; r text; priv text;
BEGIN
  FOREACH t IN ARRAY ARRAY['visits','visit_notes','visit_addenda','patient_medical_profiles',
      'visit_diagnoses','visit_prescription_items','clinic_medicines','icd10_codes',
      'patient_attachments'] LOOP
    FOREACH r IN ARRAY ARRAY['eyadex_platform','eyadex_auth','eyadex_dispatcher'] LOOP
      FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(r, t, priv) THEN
          RAISE EXCEPTION 'MEDICAL-GRANTS: % has % on %', r, priv, t;
        END IF;
      END LOOP;
    END LOOP;
    IF NOT has_table_privilege('eyadex_app', t, 'SELECT') THEN
      RAISE EXCEPTION 'MEDICAL-GRANTS: eyadex_app lacks SELECT on %', t;
    END IF;
    IF has_table_privilege('eyadex_app', t, 'INSERT') <> (t <> 'icd10_codes') THEN
      RAISE EXCEPTION 'MEDICAL-GRANTS: eyadex_app INSERT on % is wrong', t;
    END IF;
    -- An addendum is append-only; the ICD-10-CM reference table is loaded by the owner only.
    IF has_table_privilege('eyadex_app', t, 'UPDATE') <> (t NOT IN ('visit_addenda', 'icd10_codes')) THEN
      RAISE EXCEPTION 'MEDICAL-GRANTS: eyadex_app UPDATE on % is wrong', t;
    END IF;
    FOREACH priv IN ARRAY ARRAY['DELETE','TRUNCATE'] LOOP
      IF has_table_privilege('eyadex_app', t, priv) THEN
        RAISE EXCEPTION 'MEDICAL-GRANTS: eyadex_app has % on %', priv, t;
      END IF;
    END LOOP;
  END LOOP;
  -- R2-3: the settings save writes every column in one UPDATE, the new-clinic default included.
  IF NOT has_column_privilege('eyadex_platform', 'platform_settings', 'default_module_medical', 'UPDATE') THEN
    RAISE EXCEPTION 'MEDICAL-GRANTS: the platform cannot save default_module_medical';
  END IF;
END $$;

-- One clinic with a member, a patient and one audit row of every medical entity, written by the owner.
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-00000000046a','medical-grants','م','M','dermatology','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
DO $$
DECLARE c uuid := '00000000-0000-7000-8000-00000000046a'; e text; n int := 0;
BEGIN
  INSERT INTO clinic_features VALUES (c, '00000000-0000-7000-8000-0000000461a1', 'medical', false, now());
  INSERT INTO audit_log VALUES (c, '00000000-0000-7000-8000-0000000461a2', gen_random_uuid(), 'user.invited', 'administrative', 'user', null, null, '{}', now());
  FOREACH e IN ARRAY ARRAY['visit','visit_addendum','diagnosis','prescription','medical_profile','attachment'] LOOP
    n := n + 1;
    INSERT INTO audit_log VALUES (c, ('00000000-0000-7000-8000-0000000461b' || n)::uuid, gen_random_uuid(), e || '.opened', 'patient_access', e, gen_random_uuid(), null, '{}', now());
    -- R1-1: the database refuses any of them filed as administrative (0011's rule, extended).
    BEGIN
      INSERT INTO audit_log VALUES (c, gen_random_uuid(), gen_random_uuid(), e || '.opened', 'administrative', e, null, null, '{}', now());
      RAISE EXCEPTION 'MEDICAL-AUDIT: a % event was accepted as administrative', e;
    EXCEPTION WHEN check_violation THEN NULL; END;
  END LOOP;
  -- The clinic's medicines list is not patient data: administrative, yet still never the platform's.
  INSERT INTO audit_log VALUES (c, '00000000-0000-7000-8000-0000000461c1', gen_random_uuid(), 'medicine.created', 'administrative', 'medicine', gen_random_uuid(), null, '{}', now());
END $$;

-- As the platform: no medical table is readable, and its only window on clinic audit shows none of the
-- medical rows, only the administrative `user` row.
SET LOCAL ROLE eyadex_platform;
DO $$
DECLARE t text; n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['visits','visit_notes','visit_addenda','patient_medical_profiles',
      'visit_diagnoses','visit_prescription_items','clinic_medicines','icd10_codes',
      'patient_attachments'] LOOP
    BEGIN
      EXECUTE format('SELECT 1 FROM %I LIMIT 1', t);
      RAISE EXCEPTION 'PLAT-01: platform can read %', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  SELECT count(*) INTO n FROM platform_clinic_admin_audit
    WHERE clinic_id = '00000000-0000-7000-8000-00000000046a'
      AND entity_type IN ('visit','visit_addendum','diagnosis','prescription','medical_profile','attachment','medicine');
  IF n <> 0 THEN RAISE EXCEPTION 'PLAT-01: the admin audit view shows % medical rows', n; END IF;
  SELECT count(*) INTO n FROM platform_clinic_admin_audit WHERE clinic_id = '00000000-0000-7000-8000-00000000046a';
  IF n <> 1 THEN RAISE EXCEPTION 'PLAT: the admin audit view shows % rows of the clinic, expected 1', n; END IF;
END $$;
-- Onboarding writes administrative rows as the platform (0016); never an appointment (0043, 0051) or a
-- medical one (0046): the INSERT policy refuses each entity its read policy and view leave out.
DO $$
DECLARE e text;
BEGIN
  PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-00000000046a', true);
  INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-00000000046a', gen_random_uuid(), gen_random_uuid(), 'invitation.sent', 'administrative', 'invitation', null, null, '{}', now());
  FOREACH e IN ARRAY ARRAY['patient','appointment','visit','visit_addendum','diagnosis','prescription',
      'medical_profile','attachment','medicine'] LOOP
    BEGIN
      INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-00000000046a', gen_random_uuid(), gen_random_uuid(), e || '.created', 'administrative', e, null, null, '{}', now());
      RAISE EXCEPTION 'PLAT-01: the platform wrote an administrative % audit row', e;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END $$;

RESET ROLE;
\echo 'Medical platform grant tests: all passed'
ROLLBACK;
