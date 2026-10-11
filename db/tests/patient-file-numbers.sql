-- Patient file-number counter (0019). Rolls back; safe anywhere.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/patient-file-numbers.sql

BEGIN;
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000005a1','fn-a','أ','A','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000005a2','fn-b','ب','B','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());

CREATE FUNCTION pg_temp.next_file_number(c uuid) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO clinic_counters (clinic_id, name, value, updated_at)
  VALUES (c, 'patient_file_number', 1, now())
  ON CONFLICT (clinic_id, name)
  DO UPDATE SET value = clinic_counters.value + 1, updated_at = now()
  RETURNING value
$$;

SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000005a1';
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.next_file_number('00000000-0000-7000-8000-0000000005a1');
  IF n <> 1 THEN RAISE EXCEPTION 'FILENO: first number is %, expected 1', n; END IF;
  n := pg_temp.next_file_number('00000000-0000-7000-8000-0000000005a1');
  IF n <> 2 THEN RAISE EXCEPTION 'FILENO: second number is %, expected 2', n; END IF;
  -- Never backwards, never reused.
  BEGIN
    UPDATE clinic_counters SET value = 1;
    RAISE EXCEPTION 'FILENO: counter moved backwards';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- Another clinic's counter can't be created or advanced from here.
  BEGIN
    PERFORM pg_temp.next_file_number('00000000-0000-7000-8000-0000000005a2');
    RAISE EXCEPTION 'FILENO: advanced another clinic''s counter';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Stored file numbers are plain positive integers.
  BEGIN
    INSERT INTO branches VALUES ('00000000-0000-7000-8000-0000000005a1', '00000000-0000-7000-8000-0000000005b1',
      'ف', 'B', true, now(), now());
    INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
        status, created_at, updated_at)
      VALUES ('00000000-0000-7000-8000-0000000005a1', gen_random_uuid(), '000123', 'x', '+96550000001', '1990-01-01',
        'male', '00000000-0000-7000-8000-0000000005b1', 'active', now(), now());
    RAISE EXCEPTION 'FILENO: padded file number stored';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;

-- Each clinic counts on its own.
SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000005a2';
DO $$
BEGIN
  IF pg_temp.next_file_number('00000000-0000-7000-8000-0000000005a2') <> 1 THEN
    RAISE EXCEPTION 'FILENO: clinic B did not start at 1';
  END IF;
  IF (SELECT count(*) FROM clinic_counters) <> 1 THEN
    RAISE EXCEPTION 'FILENO: clinic B sees another clinic''s counter';
  END IF;
END $$;
RESET ROLE;

-- The platform can't read the counter (it is a patient count).
SET LOCAL ROLE eyadex_platform;
DO $$
BEGIN
  BEGIN PERFORM 1 FROM clinic_counters LIMIT 1; RAISE EXCEPTION 'FILENO: platform can read counters';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

\echo 'Patient file-number tests: all passed'
ROLLBACK;
