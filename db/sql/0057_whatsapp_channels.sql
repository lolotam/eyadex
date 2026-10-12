-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase 3 N2 (docs/specs/notifications-design.md §7, §7.1; owner decisions N-6, N-7): patient messages over
-- the clinic's own WhatsApp number.

-- One row per clinic; no row = WhatsApp not linked. `instance_name` is the clinic's Evolution instance
-- (`eyadex-<clinic id>`). `sealed_credentials` is the coexistence access token sealed with
-- MAIL_PROVIDER_SEAL_KEY, bound to the row id (AAD), never readable without the key. `risk_accepted_by` is
-- the admin's user id, without a foreign key (like the audit actor). `last_error` is a short code, never a
-- provider's message. `next_send_at` is the per-clinic pace: the worker sends one message at a time under
-- this row's lock and pushes it forward after each send, to lower the ban risk of the Evolution link.
CREATE TABLE clinic_whatsapp_channels (
  clinic_id           uuid NOT NULL REFERENCES clinics (id),
  id                  uuid NOT NULL,
  transport           text NULL CHECK (transport IN ('evolution', 'coexistence')),
  status              text NOT NULL CHECK (status IN ('disconnected', 'pending', 'connected')),
  instance_name       text NULL,
  phone_last4         text NULL CHECK (phone_last4 ~ '^[0-9]{4}$'),
  risk_accepted_at    timestamptz NULL,
  risk_accepted_by    uuid NULL,
  risk_version        integer NULL,
  sealed_credentials  text NULL,
  phone_number_id     text NULL,
  business_account_id text NULL,
  templates           jsonb NOT NULL DEFAULT '{}',
  connected_at        timestamptz NULL,
  last_error          text NULL CHECK (char_length(last_error) <= 120),
  next_send_at        timestamptz NULL,
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  -- Also the index behind the clinic_id foreign key and the RLS predicate.
  CONSTRAINT clinic_whatsapp_channels_one_per_clinic UNIQUE (clinic_id)
);

ALTER TABLE clinic_whatsapp_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_whatsapp_channels FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_whatsapp_channels_tenant_isolation ON clinic_whatsapp_channels
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- The API (connect, disconnect, coexistence) and the worker (send, pace) run as eyadex_app. Unlinking is
-- an update to `disconnected`, never a delete. The platform has no privilege: the channel is the clinic's.
GRANT SELECT, INSERT, UPDATE ON clinic_whatsapp_channels TO eyadex_app;
REVOKE ALL ON clinic_whatsapp_channels FROM eyadex_platform;

-- The WhatsApp switch (N2). Off by default: a clinic links its number first, then turns it on.
ALTER TABLE clinic_notification_settings
  ADD COLUMN whatsapp_enabled boolean NOT NULL DEFAULT false;

-- The ledger learns the WhatsApp senders and the two WhatsApp skip reasons: not connected at send time, or
-- (coexistence) no Meta template for that kind.
ALTER TABLE patient_notifications DROP CONSTRAINT patient_notifications_route_check;
ALTER TABLE patient_notifications ADD CONSTRAINT patient_notifications_route_check
  CHECK (route IN ('primary', 'fallback', 'platform', 'evolution', 'coexistence'));
ALTER TABLE patient_notifications DROP CONSTRAINT patient_notifications_skip_reason_check;
ALTER TABLE patient_notifications ADD CONSTRAINT patient_notifications_skip_reason_check
  CHECK (skip_reason IN ('setting_off', 'no_email', 'opted_out', 'not_booked', 'moved',
    'whatsapp_disconnected', 'template_missing'));
