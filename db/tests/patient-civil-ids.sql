-- Kuwaiti civil ID: 12 ASCII digits and one file per clinic (0021). Rolls back; safe anywhere.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/patient-civil-ids.sql

BEGIN;
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000007a1','ci-a','أ','A','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000007a2','ci-b','ب','B','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());

-- Ids below: one branch per clinic and clinic A's first file. '290040112347' is the only
-- well-formed number used and it encodes 1990-04-01; it is fictional, not a real person's.
SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000007a1';
INSERT INTO branches VALUES ('00000000-0000-7000-8000-0000000007a1','00000000-0000-7000-8000-0000000007b1','ف','F',true,now(),now());
INSERT INTO patients VALUES ('00000000-0000-7000-8000-0000000007a1','00000000-0000-7000-8000-0000000007c1','1','أ',
  '+96550000001','1990-04-01','male','00000000-0000-7000-8000-0000000007b1','290040112347','active',now(),now());
DO $$
DECLARE
  clinic  uuid := '00000000-0000-7000-8000-0000000007a1';
  branch  uuid := '00000000-0000-7000-8000-0000000007b1';
  first   uuid := '00000000-0000-7000-8000-0000000007c1';
  shape   record;
BEGIN
  -- One number per clinic file, and archiving a file keeps its number reserved.
  BEGIN
    INSERT INTO patients VALUES (clinic, gen_random_uuid(), '2', 'ب', '+96550000002', '1990-04-01', 'female', branch,
      '290040112347', 'active', now(), now());
    RAISE EXCEPTION 'CIVIL-ID: the same number was filed twice';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  UPDATE patients SET status = 'archived' WHERE clinic_id = clinic AND id = first;
  BEGIN
    INSERT INTO patients VALUES (clinic, gen_random_uuid(), '3', 'ج', '+96550000003', '1990-04-01', 'male', branch,
      '290040112347', 'active', now(), now());
    RAISE EXCEPTION 'CIVIL-ID: an archived file''s number was reused';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- An edit cannot take a number either.
  INSERT INTO patients VALUES (clinic, gen_random_uuid(), '4', 'د', '+96550000004', '1990-04-01', 'female', branch,
    NULL, 'active', now(), now());
  BEGIN
    UPDATE patients SET civil_id = '290040112347' WHERE clinic_id = clinic AND file_number = '4';
    RAISE EXCEPTION 'CIVIL-ID: the number was taken on update';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- A file keeps its own number, and files without one never collide.
  UPDATE patients SET full_name = 'أ' WHERE clinic_id = clinic AND id = first;
  INSERT INTO patients VALUES (clinic, gen_random_uuid(), '5', 'هـ', '+96550000005', '1990-04-01', 'male', branch,
    NULL, 'active', now(), now());
  INSERT INTO patients VALUES (clinic, gen_random_uuid(), '6', 'و', '+96550000006', '1990-04-01', 'female', branch,
    NULL, 'archived', now(), now());
  UPDATE patients SET civil_id = NULL WHERE clinic_id = clinic AND file_number = '5';
  INSERT INTO patients VALUES (clinic, gen_random_uuid(), '7', 'ز', '+96550000007', '1990-04-01', 'male', branch,
    NULL, 'active', now(), now());

  -- Anything that is not 12 ASCII digits is refused.
  FOR shape IN SELECT * FROM (VALUES
    ('29004011234'),      -- 11 digits
    ('2900401123477'),    -- 13 digits
    ('29004011234 '),     -- a trailing space
    ('290-040-112-347'),  -- dashes
    ('29004011234X'),     -- a letter
    ('٢٩٠٠٤٠١١٢٣٤٧') -- Arabic-Indic digits
  ) AS shapes(civil_id) LOOP
    BEGIN
      INSERT INTO patients VALUES (clinic, gen_random_uuid(), '8', 'ح', '+96550000008', '1990-04-01', 'male', branch,
        shape.civil_id, 'active', now(), now());
      RAISE EXCEPTION 'CIVIL-ID: stored %', shape.civil_id;
    EXCEPTION WHEN check_violation THEN NULL; END;
  END LOOP;
END $$;
RESET ROLE;

-- Another clinic may hold the same person: the unique key is per clinic, and RLS hides A's files.
SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000007a2';
INSERT INTO branches VALUES ('00000000-0000-7000-8000-0000000007a2','00000000-0000-7000-8000-0000000007b2','ق','Q',true,now(),now());
INSERT INTO patients VALUES ('00000000-0000-7000-8000-0000000007a2','00000000-0000-7000-8000-0000000007d1','1','أ',
  '+96550000001','1990-04-01','male','00000000-0000-7000-8000-0000000007b2','290040112347','active',now(),now());
DO $$
BEGIN
  IF (SELECT count(*) FROM patients WHERE civil_id = '290040112347') <> 1 THEN
    RAISE EXCEPTION 'CIVIL-ID: clinic B does not see exactly its own file';
  END IF;
END $$;
RESET ROLE;

\echo 'Patient civil-ID tests: all passed'
ROLLBACK;