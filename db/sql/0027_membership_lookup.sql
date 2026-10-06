-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase B slice 4 (ADR-0009): a signed-in clinic user arrives with a session and no clinic.
-- The authorization guard resolves the user's clinic with this function, then continues inside
-- withTenant(clinic_id) where RLS applies as everywhere else. It is the third named pre-tenant
-- path (CLAUDE.architecture.md §3), shaped exactly like invitation_clinic_for_token (0014).

-- One account = one membership (PRD §4.6: one email = one membership across all clinics; the
-- email is already unique in memberships, 0017). The unique index makes the lookup a single row
-- and serves it; it does not start with clinic_id because it is the pre-tenant lookup key.
CREATE UNIQUE INDEX memberships_user_unique ON memberships (user_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_membership_lookup_owner') THEN
    CREATE ROLE eyadex_membership_lookup_owner NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO eyadex_membership_lookup_owner;
GRANT SELECT (clinic_id, user_id) ON memberships TO eyadex_membership_lookup_owner;
CREATE POLICY memberships_user_lookup ON memberships FOR SELECT TO eyadex_membership_lookup_owner
  USING (true);

-- Returns the clinic id only (active or deactivated: the caller checks the status inside the
-- tenant). Reveals nothing else about the membership or any other clinic.
CREATE FUNCTION membership_clinic_for_user(p_user_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT clinic_id FROM memberships WHERE user_id = p_user_id
$$;
ALTER FUNCTION membership_clinic_for_user(uuid) OWNER TO eyadex_membership_lookup_owner;
REVOKE ALL ON FUNCTION membership_clinic_for_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION membership_clinic_for_user(uuid) TO eyadex_app;
