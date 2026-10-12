-- The civil ID after 0052: the plain column, 0021's digits check and its unique index are gone, and the
-- 0045 index alone keeps one number per clinic file, on edits too. The 12-digit shape is the API
-- contract's job now (the database only sees envelopes); patient-civil-id-encrypted.sql covers the
-- index on inserts, the column shapes and the platform. Rolls back; safe anywhere.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/patient-civil-ids.sql
-- The envelopes and indexes below are shaped placeholders, never a real number's.

BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'patients' AND column_name = 'civil_id')
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patients_civil_id_digits')
     OR to_regclass('public.patients_clinic_civil_id_unique') IS NOT NULL THEN
    RAISE EXCEPTION 'CIVIL-ID: the plain civil_id column or its 0021 check/index is still there';
  END IF;
END $$;

INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000007a1','ci-a','أ','A','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());

SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000007a1';
INSERT INTO branches VALUES ('00000000-0000-7000-8000-0000000007a1','00000000-0000-7000-8000-0000000007b1','ف','F',true,now(),now());
DO $$
DECLARE
  clinic uuid := '00000000-0000-7000-8000-0000000007a1';
  branch uuid := '00000000-0000-7000-8000-0000000007b1';
  first  uuid := '00000000-0000-7000-8000-0000000007c1';
  idx    text := repeat('ab', 32);
BEGIN
  INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
      civil_id_enc, civil_id_hmac, civil_id_last4, status, created_at, updated_at)
    VALUES (clinic, first, '1', 'أ', '+96550000001', '1990-04-01', 'male', branch,
      'f1.1.iv.body.tag', idx, '2347', 'active', now(), now());
  INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
      status, created_at, updated_at)
    VALUES (clinic, gen_random_uuid(), '2', 'ب', '+96550000002', '1990-04-01', 'female', branch,
      'active', now(), now());

  -- An edit cannot take another file's number.
  BEGIN
    UPDATE patients SET civil_id_enc = 'f1.1.iv.other.tag', civil_id_hmac = idx, civil_id_last4 = '2347'
      WHERE clinic_id = clinic AND file_number = '2';
    RAISE EXCEPTION 'CIVIL-ID: the number was taken on update';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- Archiving keeps the number reserved, and an unrelated edit keeps the file's own number.
  UPDATE patients SET status = 'archived', full_name = 'أأ' WHERE clinic_id = clinic AND id = first;
  IF (SELECT civil_id_hmac FROM patients WHERE clinic_id = clinic AND id = first) IS DISTINCT FROM idx THEN
    RAISE EXCEPTION 'CIVIL-ID: an edit lost the file''s own number';
  END IF;
  BEGIN
    UPDATE patients SET civil_id_enc = 'f1.1.iv.other.tag', civil_id_hmac = idx, civil_id_last4 = '2347'
      WHERE clinic_id = clinic AND file_number = '2';
    RAISE EXCEPTION 'CIVIL-ID: an archived file''s number was reused';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;

\echo 'Patient civil-ID tests: all passed'
ROLLBACK;
