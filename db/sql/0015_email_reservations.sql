-- SQL baseline (applied to production 2026-10-03, PostgreSQL 18; compatible with 16).
-- One email = one account across ALL clinics AND the platform team (PRD 4.6). Forced RLS hides
-- other clinics' rows, so the invariant needs a global registry. Nobody reads or writes it
-- directly; SECURITY DEFINER functions act only for the CALLER'S clinic (app.clinic_id) and never
-- reveal which clinic holds a taken email.
--
-- kind 'invitation' : held by one clinic until expires_at (an expired hold is free to take)
-- kind 'membership' : held by one clinic forever (users are deactivated, never deleted)
-- kind 'platform'   : a platform-team account, no clinic, never released

CREATE TABLE email_reservations (
  email       text PRIMARY KEY CHECK (email = lower(btrim(email)) AND email <> ''),
  kind        text NOT NULL CHECK (kind IN ('invitation', 'membership', 'platform')),
  clinic_id   uuid NULL REFERENCES clinics (id),
  -- The invitation that currently holds the email; only that invitation can renew, convert or
  -- release it, so cancelling an old invitation never frees a newer one's hold.
  invitation_id uuid NULL,
  expires_at  timestamptz NULL,
  reserved_at timestamptz NOT NULL,
  CHECK ((kind = 'platform') = (clinic_id IS NULL)),
  CHECK ((kind = 'invitation') = (expires_at IS NOT NULL)),
  CHECK ((kind = 'invitation') = (invitation_id IS NOT NULL))
);
CREATE INDEX email_reservations_clinic_idx ON email_reservations (clinic_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_email_registry_owner') THEN
    CREATE ROLE eyadex_email_registry_owner NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO eyadex_email_registry_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON email_reservations TO eyadex_email_registry_owner;
ALTER TABLE email_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY email_reservations_registry_owner ON email_reservations TO eyadex_email_registry_owner
  USING (true) WITH CHECK (true);

-- Holds an email for a new invitation of the caller's clinic. False when any clinic or the
-- platform holds it (an expired invitation hold of any clinic counts as free).
CREATE FUNCTION reserve_invitation_email(p_email text, p_invitation_id uuid, p_expires_at timestamptz) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_clinic uuid := NULLIF(current_setting('app.clinic_id', true), '')::uuid;
  v_rows integer;
BEGIN
  IF v_clinic IS NULL THEN RAISE EXCEPTION 'reserve_invitation_email requires a clinic context'; END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN RAISE EXCEPTION 'invitation expiry must be in the future'; END IF;
  IF p_invitation_id IS NULL THEN RAISE EXCEPTION 'invitation id is required'; END IF;
  INSERT INTO email_reservations (email, kind, clinic_id, invitation_id, expires_at, reserved_at)
    VALUES (lower(btrim(p_email)), 'invitation', v_clinic, p_invitation_id, p_expires_at, now())
    ON CONFLICT (email) DO UPDATE
      SET clinic_id = EXCLUDED.clinic_id, invitation_id = EXCLUDED.invitation_id,
          expires_at = EXCLUDED.expires_at, reserved_at = now()
      WHERE email_reservations.kind = 'invitation' AND email_reservations.expires_at <= now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$$;

-- Moves the caller's own invitation hold to a new expiry (resend).
CREATE FUNCTION renew_invitation_email(p_email text, p_invitation_id uuid, p_expires_at timestamptz) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_clinic uuid := NULLIF(current_setting('app.clinic_id', true), '')::uuid;
  v_rows integer;
BEGIN
  IF v_clinic IS NULL THEN RAISE EXCEPTION 'renew_invitation_email requires a clinic context'; END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN RAISE EXCEPTION 'invitation expiry must be in the future'; END IF;
  UPDATE email_reservations SET expires_at = p_expires_at, reserved_at = now()
    WHERE email = lower(btrim(p_email)) AND kind = 'invitation' AND clinic_id = v_clinic
      AND invitation_id = p_invitation_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$$;

-- Turns the caller's own, unexpired invitation hold into a permanent membership (accept).
-- Never creates a membership hold out of nothing.
CREATE FUNCTION convert_invitation_email_to_membership(p_email text, p_invitation_id uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_clinic uuid := NULLIF(current_setting('app.clinic_id', true), '')::uuid;
  v_rows integer;
BEGIN
  IF v_clinic IS NULL THEN RAISE EXCEPTION 'convert_invitation_email_to_membership requires a clinic context'; END IF;
  UPDATE email_reservations
    SET kind = 'membership', invitation_id = NULL, expires_at = NULL, reserved_at = now()
    WHERE email = lower(btrim(p_email)) AND kind = 'invitation' AND clinic_id = v_clinic
      AND invitation_id = p_invitation_id AND expires_at > now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$$;

-- Frees the caller's own invitation hold (cancelled invitation).
CREATE FUNCTION release_invitation_email(p_email text, p_invitation_id uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_clinic uuid := NULLIF(current_setting('app.clinic_id', true), '')::uuid;
  v_rows integer;
BEGIN
  IF v_clinic IS NULL THEN RAISE EXCEPTION 'release_invitation_email requires a clinic context'; END IF;
  DELETE FROM email_reservations
    WHERE email = lower(btrim(p_email)) AND kind = 'invitation' AND clinic_id = v_clinic
      AND invitation_id = p_invitation_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$$;

-- Holds an email for a platform-team account (no clinic). False when anything holds it,
-- except an expired invitation hold.
CREATE FUNCTION reserve_platform_email(p_email text) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE v_rows integer;
BEGIN
  INSERT INTO email_reservations (email, kind, clinic_id, invitation_id, expires_at, reserved_at)
    VALUES (lower(btrim(p_email)), 'platform', NULL, NULL, NULL, now())
    ON CONFLICT (email) DO UPDATE
      SET kind = 'platform', clinic_id = NULL, invitation_id = NULL, expires_at = NULL,
          reserved_at = now()
      WHERE email_reservations.kind = 'invitation' AND email_reservations.expires_at <= now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$$;

ALTER FUNCTION reserve_invitation_email(text, uuid, timestamptz) OWNER TO eyadex_email_registry_owner;
ALTER FUNCTION renew_invitation_email(text, uuid, timestamptz) OWNER TO eyadex_email_registry_owner;
ALTER FUNCTION convert_invitation_email_to_membership(text, uuid) OWNER TO eyadex_email_registry_owner;
ALTER FUNCTION release_invitation_email(text, uuid) OWNER TO eyadex_email_registry_owner;
ALTER FUNCTION reserve_platform_email(text) OWNER TO eyadex_email_registry_owner;
REVOKE ALL ON FUNCTION reserve_invitation_email(text, uuid, timestamptz),
  renew_invitation_email(text, uuid, timestamptz), convert_invitation_email_to_membership(text, uuid),
  release_invitation_email(text, uuid), reserve_platform_email(text) FROM PUBLIC;
-- Clinic API: invite, resend, accept, cancel. Platform: the first admin while onboarding.
GRANT EXECUTE ON FUNCTION reserve_invitation_email(text, uuid, timestamptz),
  renew_invitation_email(text, uuid, timestamptz), convert_invitation_email_to_membership(text, uuid),
  release_invitation_email(text, uuid) TO eyadex_app, eyadex_platform;
-- Platform-team accounts are created by identity (auth) or the platform module.
GRANT EXECUTE ON FUNCTION reserve_platform_email(text) TO eyadex_auth, eyadex_platform;
