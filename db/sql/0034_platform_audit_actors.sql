-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase B slice 10 (ADR-0019): the platform audit list names who acted.

-- Audit rows store only actor_user_id. The platform list (story 22) must show and filter by a name,
-- but eyadex_platform has no grant on auth_users (0023) and sees memberships one clinic at a time
-- (forced RLS, 0005). This view is the one window it gets: a user id and a display name, for
-- platform accounts and clinic members only. No email, no session, no clinic-area account that is
-- not a member, nothing from audit_log. Same shape as 0013 / 0027: a NOLOGIN owner nobody can log in
-- as, column grants only, and a policy that applies to that owner alone.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_audit_actor_owner') THEN
    CREATE ROLE eyadex_audit_actor_owner NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO eyadex_audit_actor_owner;
GRANT SELECT (id, name, area) ON auth_users TO eyadex_audit_actor_owner;
GRANT SELECT (user_id, full_name) ON memberships TO eyadex_audit_actor_owner;
-- Crosses clinics on purpose: the platform already reads every clinic's members (PRD §4.5); this
-- only spares it one transaction per clinic for a page of names.
CREATE POLICY memberships_audit_actor_names ON memberships FOR SELECT TO eyadex_audit_actor_owner
  USING (true);

-- One row per user: an email is a platform account or one clinic membership, never both (PRD §4.6,
-- 0015, 0027 memberships_user_unique), so the two halves never share a user_id.
CREATE VIEW platform_audit_actors WITH (security_barrier = true) AS
  SELECT id AS user_id, name AS full_name FROM auth_users WHERE area = 'platform'
  UNION ALL
  SELECT user_id, full_name FROM memberships;
ALTER VIEW platform_audit_actors OWNER TO eyadex_audit_actor_owner;
REVOKE ALL ON platform_audit_actors FROM PUBLIC;
GRANT SELECT ON platform_audit_actors TO eyadex_platform;
