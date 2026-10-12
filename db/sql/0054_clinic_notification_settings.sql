-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase 3 N1 (docs/specs/notifications-design.md §2, owner decision N-1): which messages a clinic sends.

-- One row per clinic, written whole by the settings save. A clinic without a row uses the defaults
-- (email on, every message on); the application supplies them, so no column has a database default.
-- N2 adds the WhatsApp switch.
CREATE TABLE clinic_notification_settings (
  clinic_id     uuid NOT NULL REFERENCES clinics (id),
  id            uuid NOT NULL,
  email_enabled boolean NOT NULL,
  booked        boolean NOT NULL,
  rescheduled   boolean NOT NULL,
  cancelled     boolean NOT NULL,
  reminder_day  boolean NOT NULL,
  reminder_2h   boolean NOT NULL,
  prescription  boolean NOT NULL,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  -- Also the index behind the clinic_id foreign key and the RLS predicate.
  CONSTRAINT clinic_notification_settings_one_per_clinic UNIQUE (clinic_id)
);

ALTER TABLE clinic_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_notification_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_notification_settings_tenant_isolation ON clinic_notification_settings
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- The API (save) and the worker (send-time check) run as eyadex_app. Switching a message off is an
-- update, never a delete. The platform has no privilege: a clinic's messaging is the clinic's.
GRANT SELECT, INSERT, UPDATE ON clinic_notification_settings TO eyadex_app;
REVOKE ALL ON clinic_notification_settings FROM eyadex_platform;
