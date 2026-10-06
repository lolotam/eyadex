-- Branch contact columns and the clinic idempotency ledger (0028). Rolls back; safe anywhere.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/branch-contact.sql

BEGIN;
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000006a1','bc-a','أ','A','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000006a2','bc-b','ب','B','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());

DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_name = 'branches' AND column_name IN ('address','phone')
        AND is_nullable = 'YES' AND data_type = 'text') <> 2 THEN
    RAISE EXCEPTION 'BRANCH-CONTACT: address/phone missing or not nullable text';
  END IF;
  IF NOT has_table_privilege('eyadex_app', 'branches', 'INSERT')
     OR NOT has_table_privilege('eyadex_app', 'branches', 'UPDATE') THEN
    RAISE EXCEPTION 'BRANCH-CONTACT: eyadex_app cannot write branches';
  END IF;
  IF has_table_privilege('eyadex_app', 'branches', 'DELETE') THEN
    RAISE EXCEPTION 'BRANCH-CONTACT: branches are hard-deletable';
  END IF;
  -- Clinic ledger: app only, no delete, only `response` updatable; nobody else touches it.
  IF has_table_privilege('eyadex_app', 'clinic_idempotency_keys', 'DELETE')
     OR has_column_privilege('eyadex_app', 'clinic_idempotency_keys', 'request_hash', 'UPDATE')
     OR NOT has_column_privilege('eyadex_app', 'clinic_idempotency_keys', 'response', 'UPDATE') THEN
    RAISE EXCEPTION 'IDEMPOTENCY: wrong eyadex_app privileges on clinic_idempotency_keys';
  END IF;
  IF has_table_privilege('eyadex_platform', 'clinic_idempotency_keys', 'SELECT')
     OR has_table_privilege('eyadex_auth', 'clinic_idempotency_keys', 'SELECT')
     OR has_table_privilege('eyadex_dispatcher', 'clinic_idempotency_keys', 'SELECT') THEN
    RAISE EXCEPTION 'IDEMPOTENCY: another role can read clinic_idempotency_keys';
  END IF;
END $$;

SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000006a1';
INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at, address, phone)
  VALUES ('00000000-0000-7000-8000-0000000006a1', '00000000-0000-7000-8000-0000000006b1',
          'ف', 'B', true, now(), now(), 'Block 1', '+96500000000');
UPDATE branches SET address = NULL, phone = NULL WHERE id = '00000000-0000-7000-8000-0000000006b1';
INSERT INTO clinic_idempotency_keys VALUES ('00000000-0000-7000-8000-0000000006a1', gen_random_uuid(),
  'branch:create', 'k1', repeat('a', 64), NULL, now());
DO $$
BEGIN
  BEGIN
    INSERT INTO clinic_idempotency_keys VALUES ('00000000-0000-7000-8000-0000000006a1', gen_random_uuid(),
      'branch:create', 'k1', repeat('b', 64), NULL, now());
    RAISE EXCEPTION 'IDEMPOTENCY: the same scope + key was claimed twice';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO clinic_idempotency_keys VALUES ('00000000-0000-7000-8000-0000000006a2', gen_random_uuid(),
      'branch:create', 'k2', repeat('a', 64), NULL, now());
    RAISE EXCEPTION 'ISO-01 write leak: clinic_idempotency_keys';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM clinic_idempotency_keys; RAISE EXCEPTION 'clinic_idempotency_keys is deletable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- Clinic B sees none of clinic A's keys.
SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000006a2';
DO $$
BEGIN
  IF (SELECT count(*) FROM clinic_idempotency_keys) <> 0 THEN
    RAISE EXCEPTION 'ISO-01 read leak: clinic_idempotency_keys';
  END IF;
END $$;
RESET ROLE;
\echo 'Branch contact + clinic idempotency tests: all passed'
ROLLBACK;
