-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- P2 slice M5 (docs/specs/medical-design.md §4, §6; plan Task 10 with amendments R1-14, R1-15, R2-7):
-- a patient's attachments (images, lab PDFs), optionally on one of the patient's visits. The bytes live
-- in the blob store, sealed by the API before they leave it (ADR-0028); this table holds where, what type,
-- how big, the plaintext's SHA-256 and the file name, encrypted. An attachment is archived, never deleted.

-- `storage_key` is exactly `clinic/<clinic_id>/<id>` (the blob store adds its own optional folder prefix):
-- no file name and no patient data, so a key seen in the store's logs says nothing, and one row owns one
-- blob. `name_enc` is a FieldCipher envelope like every other `*_enc` column (0046). `uploaded_by` is a
-- membership id with no foreign key, like 0046's actor columns: a key to the uploader's membership would
-- take one more membership row lock (ADR-0027).
CREATE TABLE patient_attachments (
  clinic_id    uuid NOT NULL REFERENCES clinics (id),
  id           uuid NOT NULL,
  patient_id   uuid NOT NULL,
  visit_id     uuid NULL,
  storage_key  text NOT NULL,
  content_type text NOT NULL
    CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes   integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  name_enc     text NOT NULL CHECK (name_enc ~ '^f1\.[0-9]+\.'),
  status       text NOT NULL CHECK (status IN ('active', 'archived')),
  uploaded_by  uuid NOT NULL,
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  FOREIGN KEY (clinic_id, visit_id) REFERENCES visits (clinic_id, id),
  CONSTRAINT patient_attachments_storage_key_check
    CHECK (storage_key = 'clinic/' || clinic_id || '/' || id)
);

-- A patient's attachments newest first (the list) and a visit's (the visit page). Every foreign key
-- leads a plain index.
CREATE INDEX patient_attachments_clinic_patient_created_idx
  ON patient_attachments (clinic_id, patient_id, created_at DESC);
CREATE INDEX patient_attachments_clinic_visit_idx ON patient_attachments (clinic_id, visit_id);

ALTER TABLE patient_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY patient_attachments_tenant_isolation ON patient_attachments
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- The clinic runtime role only, and never DELETE (archived instead). The platform has no privilege
-- (PRD §8, P2-K3). The audit entity `attachment` is already patient access and outside the platform's
-- view (0046).
GRANT SELECT, INSERT, UPDATE ON patient_attachments TO eyadex_app;
REVOKE ALL ON patient_attachments FROM eyadex_platform;
