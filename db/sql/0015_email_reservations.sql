-- SQL baseline (applied to production 2026-10-03, PostgreSQL 18; compatible with 16).
-- One email = one membership across ALL clinics (PRD 4.6). Forced RLS hides other clinics'
-- memberships and invitations, so the invariant needs a global registry. Nobody reads or writes
-- it directly: two SECURITY DEFINER functions reserve and release an email for the CALLER'S
-- clinic only (taken from app.clinic_id), and reveal nothing about which clinic holds a taken email.

CREATE TABLE email_reservations (
  email       text PRIMARY KEY CHECK (email = lower(btrim(email)) AND email <> ''),
  clinic_id   uuid NOT NULL REFERENCES clinics (id),
  kind        text NOT NULL CHECK (kind IN ('invitation', 'membership')),
  reserved_at timestamptz NOT NULL
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

-- Reserves the email for the caller's clinic. Returns false when the email is already held by
-- ANY clinic (including the caller's own pending invitation), true when the reservation was made.
-- p_kind 'membership' upgrades the caller's own invitation reservation when the invite is accepted.
CREATE FUNCTION reserve_email(p_email text, p_kind text) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_clinic uuid := NULLIF(current_setting('app.clinic_id', true), '')::uuid;
  v_email text := lower(btrim(p_email));
  v_rows integer;
BEGIN
  IF v_clinic IS NULL THEN RAISE EXCEPTION 'reserve_email requires a clinic context'; END IF;
  IF p_kind = 'membership' THEN
    UPDATE email_reservations SET kind = 'membership'
      WHERE email = v_email AND clinic_id = v_clinic AND kind = 'invitation';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 1 THEN RETURN true; END IF;
  END IF;
  INSERT INTO email_reservations (email, clinic_id, kind, reserved_at)
    VALUES (v_email, v_clinic, p_kind, now())
    ON CONFLICT (email) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$$;

-- Releases an INVITATION reservation of the caller's clinic (cancelled or expired invitation).
-- Memberships are never released: users are deactivated, never deleted.
CREATE FUNCTION release_invitation_email(p_email text) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_clinic uuid := NULLIF(current_setting('app.clinic_id', true), '')::uuid;
  v_rows integer;
BEGIN
  IF v_clinic IS NULL THEN RAISE EXCEPTION 'release_invitation_email requires a clinic context'; END IF;
  DELETE FROM email_reservations
    WHERE email = lower(btrim(p_email)) AND clinic_id = v_clinic AND kind = 'invitation';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$$;

ALTER FUNCTION reserve_email(text, text) OWNER TO eyadex_email_registry_owner;
ALTER FUNCTION release_invitation_email(text) OWNER TO eyadex_email_registry_owner;
REVOKE ALL ON FUNCTION reserve_email(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_invitation_email(text) FROM PUBLIC;
-- The clinic API invites users; the platform invites a new clinic's first admin while onboarding.
GRANT EXECUTE ON FUNCTION reserve_email(text, text) TO eyadex_app, eyadex_platform;
GRANT EXECUTE ON FUNCTION release_invitation_email(text) TO eyadex_app, eyadex_platform;
