-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase B slice 12 follow-up (ADR-0021, owner decision 2026-10-09): the first platform account's
-- bootstrap writes a platform audit row, in the same transaction as the link.

-- The link function is the bootstrap's one way into the team table (0037). It now also writes the
-- audit row, so a first account can never be linked without it. The row's id comes from the app
-- (UUID v7, CLAUDE.md §5: no database defaults). The details hold the account id and its status only:
-- the email and the name are text a person typed, and this function cannot run the app's strict audit
-- scrub, so neither reaches an append-only row (the account id leads to both for anyone allowed).
GRANT INSERT ON platform_audit_log TO eyadex_platform_team_owner;

DROP FUNCTION link_first_platform_account(uuid, text, text);

CREATE FUNCTION link_first_platform_account(p_user_id uuid, p_email text, p_name text, p_audit_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE v_email text := lower(btrim(p_email));
BEGIN
  IF p_user_id IS NULL OR p_audit_id IS NULL THEN RAISE EXCEPTION 'user id and audit id are required'; END IF;
  -- One linker at a time: two bootstraps cannot both see an empty team.
  PERFORM pg_advisory_xact_lock(hashtextextended('platform_team', 0));
  IF EXISTS (SELECT 1 FROM platform_accounts WHERE status = 'active') THEN RETURN false; END IF;
  INSERT INTO platform_accounts (id, user_id, email, full_name, status, token_hash, token_expires_at,
      invited_by, joined_at, created_at, updated_at)
    VALUES (p_user_id, p_user_id, v_email,
      COALESCE(NULLIF(left(btrim(p_name), 100), ''), 'Eyadex'), 'active', NULL, NULL, NULL,
      now(), now(), now());
  INSERT INTO platform_audit_log (id, actor_user_id, action, clinic_id, details, created_at)
    VALUES (p_audit_id, p_user_id, 'platform_account.bootstrapped', NULL,
      jsonb_build_object('accountId', p_user_id, 'after', jsonb_build_object('status', 'active')),
      now());
  RETURN true;
END
$$;
ALTER FUNCTION link_first_platform_account(uuid, text, text, uuid) OWNER TO eyadex_platform_team_owner;
REVOKE ALL ON FUNCTION link_first_platform_account(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION link_first_platform_account(uuid, text, text, uuid) TO eyadex_auth;

-- Databases bootstrapped before this file (staging and production, 2026-10-08/09) already have their
-- first account, and the bootstrap can never run again there, so the row is backfilled once here: every
-- active member nobody invited (the bootstrap's own, or 0037's hand-made backfill) without one. The id
-- is PostgreSQL 18's uuidv7(), as the app would make it; the time is when the account joined, and
-- `backfilled` says the row was written after the fact.
INSERT INTO platform_audit_log (id, actor_user_id, action, clinic_id, details, created_at)
  SELECT uuidv7(), a.user_id, 'platform_account.bootstrapped', NULL,
         jsonb_build_object('accountId', a.user_id, 'after', jsonb_build_object('status', 'active'),
                            'backfilled', true),
         a.joined_at
  FROM platform_accounts a
  WHERE a.invited_by IS NULL AND a.user_id IS NOT NULL AND a.joined_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM platform_audit_log l
                    WHERE l.action = 'platform_account.bootstrapped' AND l.actor_user_id = a.user_id);
