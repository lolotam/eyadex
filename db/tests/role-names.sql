-- Role name uniqueness (0018). Rolls back; safe anywhere.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/role-names.sql

BEGIN;
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000004a1','rn-a','أ','A','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000004a2','rn-b','ب','B','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());

SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000004a1';
INSERT INTO roles VALUES ('00000000-0000-7000-8000-0000000004a1', gen_random_uuid(), null,
  'ممرضة', 'Nurse', false, true, now(), now());
DO $$
BEGIN
  BEGIN
    INSERT INTO roles VALUES ('00000000-0000-7000-8000-0000000004a1', gen_random_uuid(), null,
      'أخرى', '  nURSE ', false, true, now(), now());
    RAISE EXCEPTION 'ROLE-NAME: duplicate English name accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO roles VALUES ('00000000-0000-7000-8000-0000000004a1', gen_random_uuid(), null,
      ' ممرضة', 'Other', false, false, now(), now());
    RAISE EXCEPTION 'ROLE-NAME: duplicate Arabic name accepted (deactivated roles keep their name)';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;

-- The same names are free in another clinic.
SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000004a2';
INSERT INTO roles VALUES ('00000000-0000-7000-8000-0000000004a2', gen_random_uuid(), null,
  'ممرضة', 'Nurse', false, true, now(), now());
RESET ROLE;

\echo 'Role name uniqueness tests: all passed'
ROLLBACK;
