-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase B slice 7c-2a (ADR-0014): a clinic's own mail provider.

-- One provider per clinic. Credentials (the Resend API key or the SMTP password) are stored only
-- sealed with MAIL_PROVIDER_SEAL_KEY, bound to the row id; host, port and user are not secret.
-- consecutive_failures and degraded_at are written from slice 7c-2b on.
-- A config row, not business data: removing the provider deletes it (ADR-0014).
CREATE TABLE clinic_mail_providers (
  clinic_id            uuid NOT NULL REFERENCES clinics (id),
  id                   uuid NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('resend','smtp')),
  from_name            text NOT NULL,
  from_email           text NOT NULL,
  reply_to             text NULL,
  smtp_host            text NULL,
  smtp_port            integer NULL CHECK (smtp_port BETWEEN 1 AND 65535),
  smtp_user            text NULL,
  sealed_credentials   text NOT NULL,
  verified_at          timestamptz NULL,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  degraded_at          timestamptz NULL,
  last_error           text NULL CHECK (char_length(last_error) <= 120),
  created_at           timestamptz NOT NULL,
  updated_at           timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  -- Also the index behind the clinic_id foreign key and the RLS predicate.
  CONSTRAINT clinic_mail_providers_one_per_clinic UNIQUE (clinic_id),
  CONSTRAINT clinic_mail_providers_kind_fields CHECK (
    (kind = 'smtp' AND smtp_host IS NOT NULL AND smtp_port IS NOT NULL AND smtp_user IS NOT NULL)
    OR (kind = 'resend' AND smtp_host IS NULL AND smtp_port IS NULL AND smtp_user IS NULL)
  )
);

ALTER TABLE clinic_mail_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_mail_providers FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_mail_providers_tenant_isolation ON clinic_mail_providers
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- The API (configure, remove) and the worker (test send) run as eyadex_app. No other runtime role:
-- the platform never reads a clinic's mail credentials, not even sealed.
GRANT SELECT, INSERT, UPDATE, DELETE ON clinic_mail_providers TO eyadex_app;
