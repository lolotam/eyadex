-- Platform settings, the clinic's own settings write, the platform team and the reminder ledger
-- (0036–0038, ADR-0020): grants, CHECKs and isolation. Rolls back.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/settings-and-team.sql

BEGIN;
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000011a1','st-a','أ','A','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000011a2','st-b','ب','B','general','en','Asia/Kuwait','trial',now()+interval '30 days',10,3,now(),now());

-- Grants: exactly who may touch what.
DO $$
BEGIN
  IF (SELECT count(*) FROM platform_settings) <> 1 THEN
    RAISE EXCEPTION 'SETTINGS: platform_settings must hold exactly the seeded row';
  END IF;
  IF NOT has_table_privilege('eyadex_app', 'platform_settings', 'SELECT')
     OR has_table_privilege('eyadex_app', 'platform_settings', 'UPDATE')
     OR has_any_column_privilege('eyadex_app', 'platform_settings', 'UPDATE') THEN
    RAISE EXCEPTION 'SETTINGS: eyadex_app must read platform_settings and never change it';
  END IF;
  IF has_table_privilege('eyadex_platform', 'platform_settings', 'INSERT')
     OR has_table_privilege('eyadex_platform', 'platform_settings', 'DELETE')
     OR has_column_privilege('eyadex_platform', 'platform_settings', 'id', 'UPDATE')
     OR NOT has_column_privilege('eyadex_platform', 'platform_settings', 'alert_days_before_expiry', 'UPDATE') THEN
    RAISE EXCEPTION 'SETTINGS: eyadex_platform may update the values only';
  END IF;
  IF has_table_privilege('eyadex_auth', 'platform_settings', 'SELECT')
     OR has_table_privilege('eyadex_dispatcher', 'platform_settings', 'SELECT') THEN
    RAISE EXCEPTION 'SETTINGS: another runtime role reads platform_settings';
  END IF;
  IF NOT has_table_privilege('eyadex_platform', 'platform_accounts', 'SELECT, INSERT, UPDATE')
     OR has_table_privilege('eyadex_platform', 'platform_accounts', 'DELETE') THEN
    RAISE EXCEPTION 'TEAM: eyadex_platform needs SELECT, INSERT, UPDATE and no DELETE';
  END IF;
  IF has_table_privilege('eyadex_app', 'platform_accounts', 'SELECT')
     OR has_table_privilege('eyadex_auth', 'platform_accounts', 'SELECT')
     OR has_table_privilege('eyadex_dispatcher', 'platform_accounts', 'SELECT') THEN
    RAISE EXCEPTION 'TEAM: a role other than eyadex_platform reads platform_accounts';
  END IF;
  IF has_table_privilege('eyadex_app', 'clinic_expiry_reminders', 'UPDATE')
     OR has_table_privilege('eyadex_app', 'clinic_expiry_reminders', 'DELETE')
     OR has_table_privilege('eyadex_platform', 'clinic_expiry_reminders', 'SELECT')
     OR has_table_privilege('eyadex_dispatcher', 'clinic_expiry_reminders', 'SELECT') THEN
    RAISE EXCEPTION 'REMINDERS: the ledger is append-only for eyadex_app and closed to others';
  END IF;
  IF NOT has_function_privilege('eyadex_auth', 'link_first_platform_account(uuid, text, text, uuid)', 'EXECUTE')
     OR has_function_privilege('eyadex_app', 'link_first_platform_account(uuid, text, text, uuid)', 'EXECUTE')
     OR has_function_privilege('eyadex_platform', 'link_first_platform_account(uuid, text, text, uuid)', 'EXECUTE')
     OR has_function_privilege('eyadex_dispatcher', 'link_first_platform_account(uuid, text, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEAM: only the auth bootstrap may link the first platform account';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname = 'clinic_expiry_reminders') THEN
    RAISE EXCEPTION 'REMINDERS: RLS is not enabled and forced';
  END IF;
  IF has_column_privilege('eyadex_app', 'clinics', 'status', 'UPDATE')
     OR has_column_privilege('eyadex_app', 'clinics', 'expires_at', 'UPDATE')
     OR has_column_privilege('eyadex_app', 'clinics', 'max_users', 'UPDATE')
     OR has_column_privilege('eyadex_app', 'clinics', 'slug', 'UPDATE')
     OR has_column_privilege('eyadex_app', 'clinics', 'specialty', 'UPDATE')
     OR NOT has_column_privilege('eyadex_app', 'clinics', 'timezone', 'UPDATE') THEN
    RAISE EXCEPTION 'CLINIC-SETTINGS: eyadex_app may change names, language and time zone only';
  END IF;
END $$;

-- The singleton and its bounds.
DO $$
BEGIN
  BEGIN INSERT INTO platform_settings VALUES (2, 14, 7, 'Eyadex', now());
    RAISE EXCEPTION 'SETTINGS: a second row was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE platform_settings SET email_sender_name = E'Eyadex\r\nBcc: x';
    RAISE EXCEPTION 'SETTINGS: a control character reached the sender name';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE platform_settings SET alert_days_before_expiry = 61;
    RAISE EXCEPTION 'SETTINGS: alert days above 60 were accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- Platform accounts: an active account must have joined; a link is a hash and its expiry together.
DO $$
BEGIN
  BEGIN
    INSERT INTO platform_accounts VALUES (gen_random_uuid(), NULL, 'a@example.test', 'A', 'active',
      NULL, NULL, NULL, NULL, now(), now());
    RAISE EXCEPTION 'TEAM: an active account without joining was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO platform_accounts VALUES (gen_random_uuid(), NULL, 'b@example.test', 'B', 'invited',
      repeat('a', 64), NULL, NULL, NULL, now(), now());
    RAISE EXCEPTION 'TEAM: a link without an expiry was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO platform_accounts VALUES (gen_random_uuid(), NULL, 'C@Example.test', 'C', 'invited',
      NULL, NULL, NULL, NULL, now(), now());
    RAISE EXCEPTION 'TEAM: a mixed-case email was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- The bootstrap link (eyadex_auth) adds the first active member once, never a second one. On a live
-- database (production, staging) the team already has members: the link must refuse, then the team
-- is emptied inside this transaction (rolled back) so the empty-team case is tested too.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM platform_accounts WHERE status = 'active') THEN
    PERFORM set_config('eyadex.test_team_populated', 'yes', true);
  END IF;
END $$;
SET LOCAL ROLE eyadex_auth;
DO $$
BEGIN
  -- Nested on purpose: SQL does not promise to skip the right side of AND, so a single condition
  -- would call the link on an empty team too.
  IF current_setting('eyadex.test_team_populated', true) = 'yes' THEN
    IF link_first_platform_account('00000000-0000-7000-8000-0000000011d0', 'probe@example.test', 'Probe', '00000000-0000-7000-8000-0000000011e0') THEN
      RAISE EXCEPTION 'TEAM: a member was linked while the team already had one';
    END IF;
  END IF;
END $$;
RESET ROLE;
UPDATE platform_accounts SET status = 'deactivated', updated_at = now() WHERE status = 'active';
SET LOCAL ROLE eyadex_auth;
DO $$
BEGIN
  IF NOT link_first_platform_account('00000000-0000-7000-8000-0000000011d1', 'First@Example.test', 'First', '00000000-0000-7000-8000-0000000011e1') THEN
    RAISE EXCEPTION 'TEAM: the first member was not linked';
  END IF;
  IF link_first_platform_account('00000000-0000-7000-8000-0000000011d2', 'second@example.test', 'Second', '00000000-0000-7000-8000-0000000011e2') THEN
    RAISE EXCEPTION 'TEAM: a second active member was linked behind the team';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM platform_accounts WHERE email = 'first@example.test' AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'TEAM: the linked first member is not active';
  END IF;
  -- ADR-0021 (0039): the bootstrap link writes its platform audit row, once, with no name as typed.
  IF (SELECT count(*) FROM platform_audit_log WHERE id = '00000000-0000-7000-8000-0000000011e1'
        AND action = 'platform_account.bootstrapped'
        AND actor_user_id = '00000000-0000-7000-8000-0000000011d1'
        AND details -> 'after' ->> 'email' = 'first@example.test'
        AND NOT (details -> 'after') ? 'fullName') <> 1 THEN
    RAISE EXCEPTION 'TEAM: the bootstrap link wrote no platform_account.bootstrapped audit row';
  END IF;
  IF EXISTS (SELECT 1 FROM platform_audit_log
             WHERE id IN ('00000000-0000-7000-8000-0000000011e0', '00000000-0000-7000-8000-0000000011e2')) THEN
    RAISE EXCEPTION 'TEAM: a refused link wrote an audit row';
  END IF;
  IF to_regprocedure('link_first_platform_account(uuid, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'TEAM: the link without an audit row (0037) still exists';
  END IF;
END $$;

-- The platform role works the team table and cannot delete.
SET LOCAL ROLE eyadex_platform;
INSERT INTO platform_accounts VALUES ('00000000-0000-7000-8000-0000000011c1', NULL, 'invited@example.test',
  'Invited', 'invited', repeat('b', 64), now() + interval '7 days', NULL, NULL, now(), now());
DO $$
BEGIN
  UPDATE platform_settings SET alert_days_before_expiry = 9, updated_at = now();
  BEGIN DELETE FROM platform_accounts; RAISE EXCEPTION 'TEAM: platform accounts are deletable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM patients LIMIT 1; RAISE EXCEPTION 'PLAT-01: platform can read patients';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- A clinic changes its own settings only, and only those columns.
SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000011a1';
DO $$
DECLARE n bigint;
BEGIN
  IF (SELECT alert_days_before_expiry FROM platform_settings) <> 9 THEN
    RAISE EXCEPTION 'SETTINGS: eyadex_app does not read the current alert window';
  END IF;
  UPDATE clinics SET name_ar = 'جديد', timezone = 'Asia/Riyadh', updated_at = now()
    WHERE id = '00000000-0000-7000-8000-0000000011a1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'CLINIC-SETTINGS: own clinic not updated (% rows)', n; END IF;
  UPDATE clinics SET name_ar = 'hacked' WHERE id = '00000000-0000-7000-8000-0000000011a2';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01: clinic A renamed another clinic'; END IF;
  BEGIN UPDATE clinics SET status = 'active'; RAISE EXCEPTION 'CLINIC-SETTINGS: status writable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE clinics SET expires_at = now() + interval '9 years';
    RAISE EXCEPTION 'CLINIC-SETTINGS: expiry writable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE platform_settings SET default_trial_days = 90;
    RAISE EXCEPTION 'SETTINGS: eyadex_app changed platform settings';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM platform_accounts LIMIT 1; RAISE EXCEPTION 'TEAM: eyadex_app reads the team';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- The reminder ledger: once per clinic per expiry date.
  INSERT INTO clinic_expiry_reminders VALUES ('00000000-0000-7000-8000-0000000011a1', gen_random_uuid(),
    '2030-01-01T00:00:00Z', now());
  INSERT INTO clinic_expiry_reminders VALUES ('00000000-0000-7000-8000-0000000011a1', gen_random_uuid(),
    '2030-01-01T00:00:00Z', now()) ON CONFLICT (clinic_id, expires_at) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'REMINDERS: a second reminder for the same expiry was inserted'; END IF;
END $$;
-- No clinic context: the update reaches nothing.
RESET app.clinic_id;
DO $$
DECLARE n bigint;
BEGIN
  UPDATE clinics SET name_en = 'x';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'CLINIC-SETTINGS: an update without clinic context changed % rows', n; END IF;
END $$;
RESET ROLE;

\echo 'Settings and team tests: all passed'
ROLLBACK;
