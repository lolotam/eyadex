-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase 3 N2 (docs/specs/notifications-design.md §7.1, owner decisions N-6, N-7): the clinic's WhatsApp
-- channel. One row per clinic; no row = never linked.

-- `instance_name` is the clinic's Evolution instance (`eyadex-<clinic id>`). `risk_accepted_*` record the
-- admin who accepted the ban-risk text of an `evolution` link and its version (no foreign key: the user
-- is an auth identity, like audit_log.actor_user_id). `sealed_credentials` is the coexistence access
-- token sealed with MAIL_PROVIDER_SEAL_KEY bound to this row's id: never stored, returned, audited or
-- logged in clear. Only the last four digits of the linked number are kept. `templates` maps a message
-- kind to its Meta template `{name, language}` (coexistence). `last_error` is a short code, never a
-- provider's message. `next_send_at` is the pace the worker keeps between two sends of one clinic.
CREATE TABLE clinic_whatsapp_channels (
  clinic_id           uuid NOT NULL REFERENCES clinics (id),
  id                  uuid NOT NULL,
  transport           text NULL CHECK (transport IN ('evolution', 'coexistence')),
  status              text NOT NULL CHECK (status IN ('disconnected', 'pending', 'connected')),
  instance_name       text NULL CHECK (char_length(instance_name) <= 100),
  phone_last4         text NULL CHECK (phone_last4 ~ '^[0-9]{4}$'),
  risk_accepted_at    timestamptz NULL,
  risk_accepted_by    uuid NULL,
  risk_version        integer NULL CHECK (risk_version >= 1),
  sealed_credentials  text NULL,
  phone_number_id     text NULL CHECK (phone_number_id ~ '^[0-9]{5,30}$'),
  business_account_id text NULL CHECK (business_account_id ~ '^[0-9]{5,30}$'),
  templates           jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(templates) = 'object'),
  connected_at        timestamptz NULL,
  last_error          text NULL CHECK (char_length(last_error) <= 120),
  next_send_at        timestamptz NULL,
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  -- Also the index behind the clinic_id foreign key and the RLS predicate.
  CONSTRAINT clinic_whatsapp_channels_one_per_clinic UNIQUE (clinic_id),
  -- The risk is accepted whole: who, when and which text, or nothing.
  CONSTRAINT clinic_whatsapp_channels_risk_check CHECK (
    (risk_accepted_at IS NULL) = (risk_accepted_by IS NULL)
    AND (risk_accepted_at IS NULL) = (risk_version IS NULL)
  ),
  -- A link in progress or made always says how; a connected one says since when.
  CONSTRAINT clinic_whatsapp_channels_link_check CHECK (
    (status = 'disconnected' OR transport IS NOT NULL)
    AND ((status = 'connected') = (connected_at IS NOT NULL))
  )
);

ALTER TABLE clinic_whatsapp_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_whatsapp_channels FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_whatsapp_channels_tenant_isolation ON clinic_whatsapp_channels
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- The API (link, unlink, coexistence) and the worker (send, pace) run as eyadex_app. Unlinking is an
-- update to `disconnected`, never a delete. The platform has no privilege: the clinic's number and its
-- sealed credentials are the clinic's.
GRANT SELECT, INSERT, UPDATE ON clinic_whatsapp_channels TO eyadex_app;
REVOKE ALL ON clinic_whatsapp_channels FROM eyadex_platform;
