-- SQL baseline (applied to production 2026-10-03, PostgreSQL 18; compatible with 16).
-- Two narrowly scoped paths the runtime roles need before or while a clinic context exists.

-- 1. Clinic onboarding (PRD 4.3, ONB-01): the platform creates a clinic, its system roles and
--    the first admin's invitation in ONE transaction, inside withNewTenant() which sets
--    app.clinic_id to the new clinic id, so every tenant policy still pins each row to that
--    clinic. The platform can write these setup tables only; it still has no grant on patients.
--    It may also resend or replace the first admin's invitation (story 19).
GRANT INSERT ON roles, role_permissions, invitation_branches TO eyadex_platform;
GRANT INSERT, UPDATE ON invitations TO eyadex_platform;

-- 2. Accepting an invitation (/invite/$token) happens before any clinic is known. This function
--    resolves a token hash to its clinic so the API can then enter withTenant(clinic_id).
--    It reveals nothing else, and only for a pending, unexpired invitation.
CREATE UNIQUE INDEX invitations_token_hash_idx ON invitations (token_hash);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_invite_lookup_owner') THEN
    CREATE ROLE eyadex_invite_lookup_owner NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO eyadex_invite_lookup_owner;
GRANT SELECT (clinic_id, token_hash, status, expires_at) ON invitations TO eyadex_invite_lookup_owner;
CREATE POLICY invitations_token_lookup ON invitations FOR SELECT TO eyadex_invite_lookup_owner
  USING (status = 'pending' AND expires_at > now());

CREATE FUNCTION invitation_clinic_for_token(p_token_hash text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT clinic_id FROM invitations
  WHERE token_hash = p_token_hash AND status = 'pending' AND expires_at > now()
  LIMIT 1
$$;
ALTER FUNCTION invitation_clinic_for_token(text) OWNER TO eyadex_invite_lookup_owner;
REVOKE ALL ON FUNCTION invitation_clinic_for_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invitation_clinic_for_token(text) TO eyadex_app;
