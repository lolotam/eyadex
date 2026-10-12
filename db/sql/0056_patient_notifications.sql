-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase 3 N1 (docs/specs/notifications-design.md §2–§3): the ledger of the messages a clinic sends to its
-- patients. One row per message per channel. It holds no address and no text: the worker reads the
-- patient's current email and the appointment or visit at send time, and the outbox event carries the
-- row id only (no personal data in the outbox, spec §2).

-- `subject_id` is an appointment or a visit (`subject_type`), so it has no foreign key. `subject_at` is the
-- appointment start the message was built for (NULL for the prescription, a visit kind); a reschedule
-- moves the start, so the new start gets fresh reminders while a retry or a second scan of the same start
-- conflicts. `requested_by` is the membership that triggered it (NULL for the reminder scanner); like
-- appointments.created_by (0043) it has no foreign key, so the booking transaction takes no membership
-- row lock after the branch row (ADR-0027). `last_error` is a short code, never a provider's message.
CREATE TABLE patient_notifications (
  clinic_id    uuid NOT NULL REFERENCES clinics (id),
  id           uuid NOT NULL,
  patient_id   uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('booked', 'rescheduled', 'cancelled', 'reminder_day',
                 'reminder_2h', 'prescription')),
  -- 'whatsapp' is reserved for N2.
  channel      text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  subject_type text NOT NULL CHECK (subject_type IN ('appointment', 'visit')),
  subject_id   uuid NOT NULL,
  subject_at   timestamptz NULL,
  status       text NOT NULL CHECK (status IN ('queued', 'sent', 'skipped', 'failed')),
  skip_reason  text NULL CHECK (skip_reason IN ('setting_off', 'no_email', 'opted_out', 'not_booked',
                 'moved')),
  route        text NULL CHECK (route IN ('primary', 'fallback', 'platform')),
  requested_by uuid NULL,
  attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error   text NULL CHECK (char_length(last_error) <= 120),
  created_at   timestamptz NOT NULL,
  sent_at      timestamptz NULL,
  updated_at   timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  -- The prescription is the only visit message; every appointment message names the start it was for.
  CONSTRAINT patient_notifications_subject_check CHECK (
    ((kind = 'prescription') = (subject_type = 'visit'))
    AND ((subject_type = 'appointment') = (subject_at IS NOT NULL))
  ),
  -- A skipped message says why; a sent one says which sender delivered it and when.
  CONSTRAINT patient_notifications_skipped_check CHECK ((status = 'skipped') = (skip_reason IS NOT NULL)),
  CONSTRAINT patient_notifications_sent_check CHECK (
    ((status = 'sent') = (route IS NOT NULL)) AND ((status = 'sent') = (sent_at IS NOT NULL))
  ),
  -- Never two of one message: a retry, a second scan or a second worker conflicts here (ON CONFLICT DO
  -- NOTHING). NULLS NOT DISTINCT so the prescription (subject_at NULL) is deduplicated too.
  CONSTRAINT patient_notifications_once
    UNIQUE NULLS NOT DISTINCT (clinic_id, subject_id, kind, channel, subject_at)
);

-- The message history of an appointment or a visit, newest first; the patient foreign key.
CREATE INDEX patient_notifications_clinic_subject_created_idx
  ON patient_notifications (clinic_id, subject_id, created_at DESC);
CREATE INDEX patient_notifications_clinic_patient_idx ON patient_notifications (clinic_id, patient_id);

ALTER TABLE patient_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY patient_notifications_tenant_isolation ON patient_notifications
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- The API (queue, history) and the worker (scanner, send) run as eyadex_app inside withTenant, as the
-- mail provider test send does today; the dispatcher only claims the outbox event. Never deleted, and not
-- in 0040's retention: this is the clinic's message history the screens show, not a technical ledger.
-- It names patients: the platform has no privilege on it (CLAUDE.md §8).
GRANT SELECT, INSERT, UPDATE ON patient_notifications TO eyadex_app;
REVOKE ALL ON patient_notifications FROM eyadex_platform;
