-- The encrypted civil ID columns of 0045 (ADR-0028): set together or not at all, a 64-hex index unique per
-- clinic (archived files included), four digits for lists, and the platform still reads none of it.
-- Rolls back; safe anywhere. Usage: psql -v ON_ERROR_STOP=1 -f db/tests/patient-civil-id-encrypted.sql
-- The envelopes and indexes below are shaped placeholders, never a real number's.

BEGIN;
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000008a1','ce-a','أ','A','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000008a2','ce-b','ب','B','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());

SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000008a1';
INSERT INTO branches VALUES ('00000000-0000-7000-8000-0000000008a1','00000000-0000-7000-8000-0000000008b1','ف','F',true,now(),now());
DO $$
DECLARE
  clinic uuid := '00000000-0000-7000-8000-0000000008a1';
  branch uuid := '00000000-0000-7000-8000-0000000008b1';
  idx    text := repeat('ab', 32);
  bad    record;
BEGIN
  INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
      civil_id_enc, civil_id_hmac, civil_id_last4, status, created_at, updated_at)
    VALUES (clinic, gen_random_uuid(), '1', 'أ', '+96550000001', '1990-04-01', 'male', branch,
      'f1.1.iv.body.tag', idx, '2347', 'archived', now(), now());

  -- One index per clinic, an archived file's included.
  BEGIN
    INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
        civil_id_enc, civil_id_hmac, civil_id_last4, status, created_at, updated_at)
      VALUES (clinic, gen_random_uuid(), '2', 'ب', '+96550000002', '1990-04-01', 'female', branch,
        'f1.1.iv.other.tag', idx, '2347', 'active', now(), now());
    RAISE EXCEPTION 'CIVIL-ENC: the same index was filed twice';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- Files without a number never collide.
  INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
      status, created_at, updated_at)
    VALUES (clinic, gen_random_uuid(), '3', 'ج', '+96550000003', '1990-04-01', 'male', branch, 'active', now(), now()),
           (clinic, gen_random_uuid(), '4', 'د', '+96550000004', '1990-04-01', 'male', branch, 'active', now(), now());

  -- The three columns together or not at all, a lowercase 64-hex index, four ASCII digits.
  FOR bad IN SELECT * FROM (VALUES
    ('f1.1.iv.body.tag', NULL,                  '2347'),
    ('f1.1.iv.body.tag', repeat('cd', 32),      NULL),
    (NULL,               repeat('cd', 32),      '2347'),
    ('f1.1.iv.body.tag', repeat('CD', 32),      '2347'),
    ('f1.1.iv.body.tag', repeat('cd', 31),      '2347'),
    ('f1.1.iv.body.tag', repeat('cd', 31)||'zz', '2347'),
    ('f1.1.iv.body.tag', repeat('cd', 32),      '234'),
    ('f1.1.iv.body.tag', repeat('cd', 32),      '23470'),
    ('f1.1.iv.body.tag', repeat('cd', 32),      '٢٣٤٧')
  ) AS shapes(enc, hmac, last4) LOOP
    BEGIN
      INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
          civil_id_enc, civil_id_hmac, civil_id_last4, status, created_at, updated_at)
        VALUES (clinic, gen_random_uuid(), '5', 'هـ', '+96550000005', '1990-04-01', 'male', branch,
          bad.enc, bad.hmac, bad.last4, 'active', now(), now());
      RAISE EXCEPTION 'CIVIL-ENC: stored % / % / %', bad.enc IS NULL, bad.hmac, bad.last4;
    EXCEPTION WHEN check_violation THEN NULL; END;
  END LOOP;
END $$;
RESET ROLE;

-- Another clinic may hold the same index (its own key gives it another one in practice), and RLS hides A's.
SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000008a2';
INSERT INTO branches VALUES ('00000000-0000-7000-8000-0000000008a2','00000000-0000-7000-8000-0000000008b2','ق','Q',true,now(),now());
INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
    civil_id_enc, civil_id_hmac, civil_id_last4, status, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-0000000008a2', gen_random_uuid(), '1', 'أ', '+96550000001', '1990-04-01', 'male',
    '00000000-0000-7000-8000-0000000008b2', 'f1.1.iv.body.tag', repeat('ab', 32), '2347', 'active', now(), now());
DO $$
BEGIN
  IF (SELECT count(*) FROM patients WHERE civil_id_hmac = repeat('ab', 32)) <> 1 THEN
    RAISE EXCEPTION 'CIVIL-ENC: clinic B does not see exactly its own file';
  END IF;
END $$;
RESET ROLE;

-- PLAT-01: the platform role still has no privilege on patients, the new columns included.
DO $$
BEGIN
  IF has_table_privilege('eyadex_platform', 'patients', 'SELECT')
     OR has_column_privilege('eyadex_platform', 'patients', 'civil_id_enc', 'SELECT')
     OR has_column_privilege('eyadex_platform', 'patients', 'civil_id_hmac', 'SELECT') THEN
    RAISE EXCEPTION 'CIVIL-ENC: eyadex_platform can read patients';
  END IF;
END $$;

\echo 'Patient encrypted civil-ID tests: all passed'
ROLLBACK;
