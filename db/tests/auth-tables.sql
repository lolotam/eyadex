-- Only eyadex_auth reaches the Better Auth tables (0023). Rolls back; safe anywhere.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/auth-tables.sql

BEGIN;

-- Catalogue check: no other runtime role holds any privilege on any auth table, and eyadex_auth
-- holds exactly what Better Auth needs (no DELETE on users: no hard deletes).
DO $$
DECLARE
  other text;
  tbl text;
  priv text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['auth_users','auth_sessions','auth_accounts','auth_verifications','auth_two_factors'] LOOP
    FOREACH other IN ARRAY ARRAY['eyadex_app','eyadex_platform','eyadex_dispatcher'] LOOP
      FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(other, tbl, priv) THEN
          RAISE EXCEPTION 'AUTH: % has % on %', other, priv, tbl;
        END IF;
      END LOOP;
    END LOOP;
    FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
      IF NOT has_table_privilege('eyadex_auth', tbl, priv) THEN
        RAISE EXCEPTION 'AUTH: eyadex_auth lacks % on %', priv, tbl;
      END IF;
    END LOOP;
    -- Nothing beyond the four DML privileges, on any table.
    FOREACH priv IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('eyadex_auth', tbl, priv) THEN
        RAISE EXCEPTION 'AUTH: eyadex_auth has % on %', priv, tbl;
      END IF;
    END LOOP;
    -- DELETE everywhere except users (sign-out, revocation, expiry, disabling 2FA).
    IF tbl <> 'auth_users' AND NOT has_table_privilege('eyadex_auth', tbl, 'DELETE') THEN
      RAISE EXCEPTION 'AUTH: eyadex_auth lacks DELETE on %', tbl;
    END IF;
  END LOOP;
  IF has_table_privilege('eyadex_auth', 'auth_users', 'DELETE') THEN
    RAISE EXCEPTION 'AUTH: eyadex_auth can hard-delete users';
  END IF;
END $$;

-- A user and a session written by eyadex_auth itself.
SET LOCAL ROLE eyadex_auth;
INSERT INTO auth_users (id, name, email, email_verified, image, two_factor_enabled, created_at, updated_at, area)
  VALUES ('00000000-0000-7000-8000-0000000023a1', 'Auth probe', 'auth-probe@example.com', false,
    NULL, false, now(), now(), 'clinic');
-- An account belongs to exactly one known area (0024).
DO $$
BEGIN
  BEGIN
    INSERT INTO auth_users (id, name, email, email_verified, image, two_factor_enabled, created_at, updated_at)
      VALUES ('00000000-0000-7000-8000-0000000024a1', 'No area', 'no-area@example.com', false, NULL,
        false, now(), now());
    RAISE EXCEPTION 'AUTH: a user without an area was accepted';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO auth_users (id, name, email, email_verified, image, two_factor_enabled, created_at, updated_at, area)
      VALUES ('00000000-0000-7000-8000-0000000024a2', 'Bad area', 'bad-area@example.com', false, NULL,
        false, now(), now(), 'admin');
    RAISE EXCEPTION 'AUTH: a user with an unknown area was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
INSERT INTO auth_sessions (id, user_id, token, expires_at, ip_address, user_agent, area, two_factor_verified, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-0000000023a2', '00000000-0000-7000-8000-0000000023a1',
    'auth-probe-not-a-real-token', now() + interval '1 day', NULL, NULL, 'clinic', false, now(), now());
DELETE FROM auth_sessions WHERE id = '00000000-0000-7000-8000-0000000023a2';
-- One two-factor row per user: a second enrollment row is refused.
INSERT INTO auth_two_factors (id, user_id, secret, backup_codes, verified, failed_verification_count, locked_until)
  VALUES ('00000000-0000-7000-8000-0000000023a3', '00000000-0000-7000-8000-0000000023a1', 'enc', 'enc',
    false, 0, NULL);
DO $$
BEGIN
  BEGIN
    INSERT INTO auth_two_factors (id, user_id, secret, backup_codes, verified, failed_verification_count, locked_until)
      VALUES ('00000000-0000-7000-8000-0000000023a4', '00000000-0000-7000-8000-0000000023a1', 'enc2',
        'enc2', false, 0, NULL);
    RAISE EXCEPTION 'AUTH: a user got two two-factor rows';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
DO $$
BEGIN
  BEGIN
    DELETE FROM auth_users WHERE id = '00000000-0000-7000-8000-0000000023a1';
    RAISE EXCEPTION 'AUTH: eyadex_auth deleted a user';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Every other runtime role is refused a real read and a real write.
DO $$
DECLARE
  other text;
BEGIN
  FOREACH other IN ARRAY ARRAY['eyadex_app','eyadex_platform','eyadex_dispatcher'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', other);
    BEGIN
      PERFORM 1 FROM auth_users LIMIT 1;
      RAISE EXCEPTION 'AUTH: % read auth_users', other;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM 1 FROM auth_sessions LIMIT 1;
      RAISE EXCEPTION 'AUTH: % read auth_sessions', other;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      INSERT INTO auth_sessions (id, user_id, token, expires_at, ip_address, user_agent, area, two_factor_verified, created_at, updated_at)
        VALUES (gen_random_uuid(), '00000000-0000-7000-8000-0000000023a1', 'x', now(), NULL, NULL, 'clinic', false, now(), now());
      RAISE EXCEPTION 'AUTH: % wrote auth_sessions', other;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
END $$;

ROLLBACK;
