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
ALTER TABLE patient_notifications ADD COLUMN provider_message_id text NULL
  CONSTRAINT patient_notifications_provider_message_id_check CHECK (char_length(provider_message_id) <= 200);
CREATE INDEX patient_notifications_clinic_provider_message_idx
  ON patient_notifications (clinic_id, provider_message_id) WHERE provider_message_id IS NOT NULL;

-- A provider can accept then reject delivery. Keep the original route and acceptance time only for
-- that specific WhatsApp/Evolution failure; every other unsent row still has neither.
ALTER TABLE patient_notifications DROP CONSTRAINT patient_notifications_sent_check;
ALTER TABLE patient_notifications ADD CONSTRAINT patient_notifications_sent_check CHECK (
  (route IS NULL AND sent_at IS NULL AND status <> 'sent')
  OR (route IS NOT NULL AND sent_at IS NOT NULL AND (
    status = 'sent' OR (status = 'failed' AND channel = 'whatsapp' AND route = 'evolution'
      AND last_error IS NOT DISTINCT FROM 'evolution:evo_delivery_rejected')
  ))
);
