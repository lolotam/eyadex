-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase B slice 11 (ADR-0020): the pre-expiry reminder ledger (story 79, PRD §4.9).

-- One row per clinic per expiry date that a reminder was queued for. The worker inserts it with
-- ON CONFLICT DO NOTHING in the same transaction as the outbox event, so a clinic is reminded once
-- per expiry date whatever the scan rate or the number of workers; a renewal is a new date. Access
-- never depends on it: "expired" is computed at check time (SUB-02).
CREATE TABLE clinic_expiry_reminders (
  clinic_id  uuid NOT NULL REFERENCES clinics (id),
  id         uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  -- Also the index behind the clinic_id foreign key and the RLS predicate.
  CONSTRAINT clinic_expiry_reminders_once UNIQUE (clinic_id, expires_at)
);

ALTER TABLE clinic_expiry_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_expiry_reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_expiry_reminders_tenant_isolation ON clinic_expiry_reminders
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- The worker runs as eyadex_app. Append-only: a reminder that was queued stays a fact.
GRANT SELECT, INSERT ON clinic_expiry_reminders TO eyadex_app;
