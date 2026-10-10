-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Appointments slice A2 (ADR-0026 §11, docs/specs/appointments-design.md §2, §4): one booking of a
-- patient with a provider in a branch. No catalogue or role change: the keys came with 0042, and
-- existing clinics' roles stay as they are (owner decision 2026-10-10).

-- Spec §2. Times are instants (UTC); the clinic's zone only matters for the schedule check. Never
-- deleted: an appointment is cancelled (D-11), with a reason from the short list. `created_by` is the
-- actor's user id with no foreign key, like audit_log.actor_user_id: a foreign key to the actor's
-- membership would take a second membership row lock at insert time, after the branch row (ADR-0027).
CREATE TABLE appointments (
  clinic_id              uuid NOT NULL REFERENCES clinics (id),
  id                     uuid NOT NULL,
  branch_id              uuid NOT NULL,
  patient_id             uuid NOT NULL,
  provider_membership_id uuid NOT NULL,
  service_id             uuid NULL,
  starts_at              timestamptz NOT NULL,
  ends_at                timestamptz NOT NULL,
  status                 text NOT NULL
    CHECK (status IN ('booked', 'arrived', 'completed', 'no_show', 'cancelled')),
  overbooked             boolean NOT NULL,
  cancel_reason          text NULL
    CHECK (cancel_reason IN ('patient_cancelled', 'provider_cancelled', 'other')),
  cancel_note            text NULL CHECK (char_length(cancel_note) <= 200),
  created_by             uuid NOT NULL,
  created_at             timestamptz NOT NULL,
  updated_at             timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, branch_id) REFERENCES branches (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  FOREIGN KEY (clinic_id, provider_membership_id) REFERENCES memberships (clinic_id, id),
  FOREIGN KEY (clinic_id, service_id) REFERENCES clinic_services (clinic_id, id),
  -- D-15: 5 minutes to 8 hours (the use case refuses first; this is the last line).
  CONSTRAINT appointments_interval_check
    CHECK (ends_at - starts_at BETWEEN interval '5 minutes' AND interval '8 hours'),
  -- D-11: a cancelled appointment has a reason, and only a cancelled one does.
  CONSTRAINT appointments_cancelled_check
    CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL))
);

-- Spec §2: the provider's day (the overlap check and A4's week), the branch day, a patient's
-- appointments, and the partial index A3's `own` predicate reads. Every foreign key leads an index.
CREATE INDEX appointments_clinic_provider_starts_idx
  ON appointments (clinic_id, provider_membership_id, starts_at);
CREATE INDEX appointments_clinic_branch_starts_idx ON appointments (clinic_id, branch_id, starts_at);
CREATE INDEX appointments_clinic_patient_idx ON appointments (clinic_id, patient_id);
CREATE INDEX appointments_clinic_service_idx ON appointments (clinic_id, service_id);
CREATE INDEX appointments_clinic_provider_patient_live_idx
  ON appointments (clinic_id, provider_membership_id, patient_id) WHERE status <> 'cancelled';

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
CREATE POLICY appointments_tenant_isolation ON appointments
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- The clinic runtime role only, and never DELETE. Appointments name patients: the platform has no
-- privilege on them (CLAUDE.md §8).
GRANT SELECT, INSERT, UPDATE ON appointments TO eyadex_app;
REVOKE ALL ON appointments FROM eyadex_platform;

-- An appointment's audit row is administrative (spec §4 rule 9) but it records a patient's booking: who
-- was seen by which provider, when. The platform reads clinic administrative rows only through this
-- view, so it now leaves out the appointment rows as it leaves out the patient ones (0013). Same columns,
-- same owner and grant; CREATE OR REPLACE keeps both.
CREATE OR REPLACE VIEW platform_clinic_admin_audit WITH (security_barrier = true) AS
  SELECT clinic_id, id, actor_user_id, action, entity_type, entity_id, branch_id, details, created_at
  FROM audit_log
  WHERE category = 'administrative' AND entity_type NOT IN ('patient', 'appointment');
