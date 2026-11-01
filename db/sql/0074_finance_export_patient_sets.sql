-- Forward-only. 0071-0073 are reserved for the separately approved stored-business-day release.
-- ADR-0036: bounded per-attempt own bookkeeping; no patient array leaves PostgreSQL.
ALTER TABLE finance_report_exports ADD COLUMN patient_set_mode text NOT NULL DEFAULT 'array'
  CHECK (patient_set_mode IN ('array', 'ledger'));
ALTER TABLE finance_report_exports ALTER COLUMN byte_size TYPE bigint;
ALTER TABLE finance_report_exports ALTER COLUMN row_count TYPE bigint;
GRANT UPDATE (patient_set_mode) ON finance_report_exports TO eyadex_app;

CREATE TABLE finance_report_export_patients (
  clinic_id uuid NOT NULL REFERENCES clinics (id),
  id uuid NOT NULL,
  export_id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt >= 1),
  patient_id uuid NULL,
  is_complete boolean NOT NULL DEFAULT false,
  cleared_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  -- Pin the allocated blob, not the export row: its heartbeat must remain free to renew.
  FOREIGN KEY (clinic_id, export_id, attempt)
    REFERENCES finance_report_export_blobs (clinic_id, export_id, attempt),
  CONSTRAINT finance_report_export_patients_complete_check
    CHECK (NOT is_complete OR (patient_id IS NULL AND cleared_at IS NULL)),
  CONSTRAINT finance_report_export_patients_cleared_check
    CHECK (is_complete OR ((patient_id IS NULL) = (cleared_at IS NOT NULL)))
);
CREATE UNIQUE INDEX finance_report_export_patients_member_idx
  ON finance_report_export_patients (clinic_id, export_id, attempt, patient_id)
  WHERE patient_id IS NOT NULL;
CREATE UNIQUE INDEX finance_report_export_patients_complete_idx
  ON finance_report_export_patients (clinic_id, export_id, attempt) WHERE is_complete;

ALTER TABLE finance_report_export_patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_report_export_patients FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_report_export_patients_tenant_isolation ON finance_report_export_patients
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
GRANT SELECT, INSERT ON finance_report_export_patients TO eyadex_app;
-- Patient identifiers clear at original expiry; opaque attempt bookkeeping stays for the trail.
GRANT UPDATE (patient_id, cleared_at) ON finance_report_export_patients TO eyadex_app;
REVOKE ALL ON finance_report_export_patients FROM eyadex_platform, eyadex_auth, eyadex_dispatcher;
