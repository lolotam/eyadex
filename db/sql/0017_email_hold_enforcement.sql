-- SQL baseline (applied to production 2026-10-03, PostgreSQL 18; compatible with 16).
-- The database itself enforces one email = one account: a runtime role can only write a
-- membership or an invitation whose email the registry (0015) already holds for that clinic.
-- The migration owner is exempt (it is trusted and runs migrations and backfills only).

-- True when the registry holds p_email for p_clinic with the given kind (and, for invitations,
-- for that invitation and not expired). Reveals nothing about other clinics.
CREATE FUNCTION email_hold_matches(p_email text, p_clinic uuid, p_kind text, p_invitation uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM email_reservations r
    WHERE r.email = lower(btrim(p_email))
      AND r.clinic_id = p_clinic
      AND r.kind = p_kind
      AND (p_kind <> 'invitation' OR (r.invitation_id = p_invitation AND r.expires_at > now()))
  )
$$;
ALTER FUNCTION email_hold_matches(text, uuid, text, uuid) OWNER TO eyadex_email_registry_owner;
REVOKE ALL ON FUNCTION email_hold_matches(text, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION email_hold_matches(text, uuid, text, uuid) TO eyadex_app, eyadex_platform;

-- Trigger functions run as the caller, so current_user is the runtime role being checked.
CREATE FUNCTION enforce_membership_email_hold() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('eyadex_app', 'eyadex_platform')
     AND NOT email_hold_matches(NEW.email, NEW.clinic_id, 'membership', NULL) THEN
    RAISE EXCEPTION 'membership email % is not held for this clinic', NEW.email
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION enforce_invitation_email_hold() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('eyadex_app', 'eyadex_platform')
     AND NOT email_hold_matches(NEW.email, NEW.clinic_id, 'invitation', NEW.id) THEN
    RAISE EXCEPTION 'invitation email % is not held for this invitation', NEW.email
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER memberships_email_hold
  BEFORE INSERT OR UPDATE OF email, clinic_id ON memberships
  FOR EACH ROW EXECUTE FUNCTION enforce_membership_email_hold();

CREATE TRIGGER invitations_email_hold
  BEFORE INSERT OR UPDATE OF email, clinic_id ON invitations
  FOR EACH ROW EXECUTE FUNCTION enforce_invitation_email_hold();
