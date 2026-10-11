-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- P2 slice M1 (ADR-0028, docs/specs/medical-design.md §3, P2-11, P2-F5; plan Task 3 with amendments
-- R1-5, R1-6): the civil ID is stored encrypted. Additive: the API writes only the three new columns
-- (and `civil_id = NULL`) from this release on, the backfill command converts the older rows, and a later
-- file drops the plain column once the backfill is verified on that environment.
--
-- civil_id_enc   the FieldCipher envelope, bound to patients:civil_id_enc:<clinic>:<row>
-- civil_id_hmac  HMAC-SHA256 of the 12 digits under the clinic's index key (exact search, uniqueness)
-- civil_id_last4 the last four digits lists keep showing (P2-F5)
--
-- The three are set together or not at all. Uniqueness per clinic moves to the hmac; the plain unique
-- index of 0021 stays until the plain column goes, so a legacy number still blocks a duplicate.
ALTER TABLE patients
  ADD COLUMN civil_id_enc   text NULL,
  ADD COLUMN civil_id_hmac  text NULL,
  ADD COLUMN civil_id_last4 text NULL,
  ADD CONSTRAINT patients_civil_id_last4_digits CHECK (civil_id_last4 IS NULL OR civil_id_last4 ~ '^[0-9]{4}$'),
  ADD CONSTRAINT patients_civil_id_hmac_hex CHECK (civil_id_hmac IS NULL OR civil_id_hmac ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT patients_civil_id_encrypted_together CHECK (
    (civil_id_enc IS NULL) = (civil_id_hmac IS NULL) AND (civil_id_enc IS NULL) = (civil_id_last4 IS NULL));
CREATE UNIQUE INDEX patients_clinic_civil_id_hmac_unique
  ON patients (clinic_id, civil_id_hmac) WHERE civil_id_hmac IS NOT NULL;
