-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- P2 slice M3 (docs/specs/medical-design.md §4, §5; plan Task 8 with amendments R1-13, R2-8): a visit's
-- diagnoses, each an ICD-10-CM code or free text (P2-8), and the ICD-10-CM reference table they are
-- checked against (P2-F1). The table's rows come from the CDC order file through the loader command
-- (apps/api/src/cli/load-icd10.ts), never from a migration.

-- P2-8, R1-13: the visit's diagnoses as one list the provider replaces whole while the visit is a draft.
-- A replace archives the active rows and inserts the new list in one transaction under the visit lock,
-- so a removed diagnosis is kept (archived), never deleted, and never shown again. The code and the text
-- are FieldCipher envelopes (ADR-0028), each bound to its own row; a text diagnosis has no code.
CREATE TABLE visit_diagnoses (
  clinic_id   uuid NOT NULL REFERENCES clinics (id),
  id          uuid NOT NULL,
  visit_id    uuid NOT NULL,
  position    smallint NOT NULL CHECK (position BETWEEN 0 AND 19),
  kind        text NOT NULL CHECK (kind IN ('icd10', 'text')),
  code_enc    text NULL CHECK (code_enc ~ '^f1\.[0-9]+\.'),
  text_enc    text NOT NULL CHECK (text_enc ~ '^f1\.[0-9]+\.'),
  created_at  timestamptz NOT NULL,
  archived_at timestamptz NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, visit_id) REFERENCES visits (clinic_id, id),
  CONSTRAINT visit_diagnoses_code_check CHECK ((kind = 'icd10') = (code_enc IS NOT NULL))
);

-- One active row per place in the list (R1-13): a partial unique index, never a table constraint (R1-9).
-- The partial index cannot serve the foreign key, so the plain one leads with it (db/tests/fk-indexes).
CREATE UNIQUE INDEX visit_diagnoses_clinic_visit_position_active
  ON visit_diagnoses (clinic_id, visit_id, position) WHERE archived_at IS NULL;
CREATE INDEX visit_diagnoses_clinic_visit_idx ON visit_diagnoses (clinic_id, visit_id);

ALTER TABLE visit_diagnoses ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_diagnoses FORCE ROW LEVEL SECURITY;
CREATE POLICY visit_diagnoses_tenant_isolation ON visit_diagnoses
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- UPDATE is for archiving a replaced row; no DELETE (CLAUDE.md §5). The platform has nothing (P2-K3).
GRANT SELECT, INSERT, UPDATE ON visit_diagnoses TO eyadex_app;
REVOKE ALL ON visit_diagnoses FROM eyadex_platform;

-- P2-F1, R2-8: ICD-10-CM as the CDC publishes it, English titles. Global reference data, not a clinic's
-- and not a patient's, so no clinic_id and no RLS. Header rows (not valid for a claim) are kept with
-- `billable = false` so the hierarchy stays whole; search and validation use billable codes only.
CREATE TABLE icd10_codes (
  code     text PRIMARY KEY,
  title_en text NOT NULL,
  billable boolean NOT NULL,
  release  text NOT NULL
);

-- Title words are matched with LIKE '%word%' on the lower-cased title; a trigram index serves that.
-- pg_trgm is a trusted extension (PostgreSQL 13+), so the migration owner needs no superuser for it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX icd10_codes_title_trgm_idx ON icd10_codes USING gin (lower(title_en) gin_trgm_ops);

-- The clinic runtime role reads it; only the owner loads it (the loader's script runs as the owner, like
-- a migration). The platform never needs it (spec §4).
GRANT SELECT ON icd10_codes TO eyadex_app;
REVOKE ALL ON icd10_codes FROM eyadex_platform;
