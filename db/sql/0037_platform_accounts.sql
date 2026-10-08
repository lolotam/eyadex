-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase B slice 11 (ADR-0020): the platform team (stories 24–25, ADM-02).

-- One row per platform-team member, invited or joined. A global table (the platform team belongs to
-- no clinic), so no clinic_id and no RLS; only eyadex_platform may touch it. `user_id` links the
-- Better Auth account once the invitation is accepted; the API's platform gate requires a linked,
-- active row on every platform request. The pending link is stored as a SHA-256 hash only, and is
-- cleared once used. No deletes: an account is deactivated (CLAUDE.md §5).
CREATE TABLE platform_accounts (
  id               uuid PRIMARY KEY,
  user_id          uuid NULL UNIQUE,
  email            text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND email <> ''),
  full_name        text NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 100),
  status           text NOT NULL CHECK (status IN ('invited', 'active', 'deactivated')),
  token_hash       text NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  token_expires_at timestamptz NULL,
  invited_by       uuid NULL,
  joined_at        timestamptz NULL,
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  CONSTRAINT platform_accounts_token_pair CHECK ((token_hash IS NULL) = (token_expires_at IS NULL)),
  -- A joined account is linked to its auth user; an account that never joined has none.
  CONSTRAINT platform_accounts_joined_link CHECK ((joined_at IS NULL) = (user_id IS NULL)),
  CONSTRAINT platform_accounts_active_joined CHECK (status <> 'active' OR joined_at IS NOT NULL)
);
CREATE INDEX platform_accounts_created_idx ON platform_accounts (created_at, id);

GRANT SELECT, INSERT, UPDATE ON platform_accounts TO eyadex_platform;

-- The accounts that exist today were made by hand in auth_users (area 'platform'). Without a row the
-- new gate would lock them out, so each becomes an active, joined member. The owner runs this file
-- and can read auth_users; the runtime roles never could.
INSERT INTO platform_accounts (id, user_id, email, full_name, status, token_hash, token_expires_at,
    invited_by, joined_at, created_at, updated_at)
  SELECT u.id, u.id, lower(btrim(u.email)), COALESCE(NULLIF(left(btrim(u.name), 100), ''), 'Eyadex'), 'active', NULL, NULL, NULL,
         u.created_at, u.created_at, now()
  FROM auth_users u
  WHERE u.area = 'platform'
  ON CONFLICT DO NOTHING;
