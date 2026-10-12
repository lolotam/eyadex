-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase 3 N2 (docs/specs/notifications-design.md §7.1): WhatsApp joins the notification settings and the
-- message ledger.

-- The clinic's WhatsApp switch. Off for every clinic until it links a number and turns it on (the API
-- refuses to turn it on while the channel is not connected).
ALTER TABLE clinic_notification_settings ADD COLUMN whatsapp_enabled boolean NOT NULL DEFAULT false;

-- A WhatsApp message is delivered by the clinic's transport, and is skipped when the channel is not
-- connected at send time or (coexistence) no Meta template is set for its kind. The constraints keep
-- their 0056 names, with the new values appended.
ALTER TABLE patient_notifications DROP CONSTRAINT patient_notifications_route_check;
ALTER TABLE patient_notifications ADD CONSTRAINT patient_notifications_route_check
  CHECK (route IN ('primary', 'fallback', 'platform', 'evolution', 'coexistence'));
ALTER TABLE patient_notifications DROP CONSTRAINT patient_notifications_skip_reason_check;
ALTER TABLE patient_notifications ADD CONSTRAINT patient_notifications_skip_reason_check
  CHECK (skip_reason IN ('setting_off', 'no_email', 'opted_out', 'not_booked', 'moved',
    'whatsapp_disconnected', 'template_missing'));

-- No grant change: eyadex_app keeps 0054's and 0056's table-level privileges, which cover the new
-- column, and the platform still has none.
