-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- ADR-0028, R1-6: the plain `patients.civil_id` column goes. 0045 moved the civil ID to civil_id_enc /
-- civil_id_hmac / civil_id_last4, the API stopped naming the plain column, and the backfill emptied it on
-- staging and production (verified: no row holds a plain number). The plan called this file 0046; that
-- number went to the medical visits, so it lands here.
--
-- With the column go 0021's digits check and its per-clinic unique index: the database now only sees an
-- envelope, so the 12-digit shape is the API contract's job and uniqueness is the hmac index of 0045.
--
-- An environment where a plain number is still stored refuses this file instead of losing the number.
-- patients is FORCE ROW LEVEL SECURITY (0010) and no role has BYPASSRLS, so without a clinic context the
-- check would see zero rows and pass; lifting FORCE for this one transaction lets the owner see them all.
ALTER TABLE patients NO FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM patients WHERE civil_id IS NOT NULL) THEN
    RAISE EXCEPTION '0052: patients still hold a plain civil_id; convert them with the backfill shipped before 0052 first';
  END IF;
END $$;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;

ALTER TABLE patients DROP CONSTRAINT patients_civil_id_digits;
DROP INDEX patients_clinic_civil_id_unique;
ALTER TABLE patients DROP COLUMN civil_id;
