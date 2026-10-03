-- SQL baseline (applied to production 2026-10-03, PostgreSQL 18; compatible with 16).
-- The database itself enforces one email = one account: a runtime role can only write a
-- membership or an invitation whose email the registry (0015) already holds for that clinic.
-- The migration owner is exempt (it is trusted and runs migrations and backfills only).

-- True when the registry holds p_email for the CALLER'S clinic (app.clinic_id) with the given kind
-- (and, for invitations, for that invitation, unexpired, and lasting at least until p_until). The clinic is never a parameter,
-- so a session can only ask about its own clinic's holds and the helper is no cross-clinic oracle.
CREATE FUNCTION email_hold_matches(p_email text, p_kind text, p_invitation uuid, p_until timestamptz)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM email_reservations r
    WHERE r.email = lower(btrim(p_email))
      AND r.clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
      AND r.kind = p_kind
      AND (p_kind <> 'invitation'
           OR (r.invitation_id = p_invitation AND r.expires_at > now() AND r.expires_at >= p_until))
  )
$$;
ALTER FUNCTION email_hold_matches(text, text, uuid, timestamptz) OWNER TO eyadex_email_registry_owner;
REVOKE ALL ON FUNCTION email_hold_matches(text, text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION email_hold_matches(text, text, uuid, timestamptz) TO eyadex_app, eyadex_platform;

-- Trigger functions run as the caller, so current_user is the runtime role being checked.
CREATE FUNCTION enforce_membership_email_hold() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('eyadex_app', 'eyadex_platform')
     AND (NEW.clinic_id IS DISTINCT FROM NULLIF(current_setting('app.clinic_id', true), '')::uuid
          OR NOT email_hold_matches(NEW.email, 'membership', NULL, NULL)) THEN
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
     AND (NEW.clinic_id IS DISTINCT FROM NULLIF(current_setting('app.clinic_id', true), '')::uuid
          OR NOT email_hold_matches(NEW.email, 'invitation', NEW.id, NEW.expires_at)) THEN
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
  BEFORE INSERT OR UPDATE OF email, clinic_id, expires_at ON invitations
  FOR EACH ROW EXECUTE FUNCTION enforce_invitation_email_hold();

-- One email = one membership, enforced by a GLOBAL unique index: it holds across every clinic
-- regardless of RLS, so even a second membership row for an already-converted hold is refused.
CREATE UNIQUE INDEX memberships_email_unique ON memberships (lower(email));
