-- SQL baseline (applied to production 2026-10-03, PostgreSQL 18; compatible with 16).
-- Patient file numbers (PRD 4.6, story 67): a sequential counter per clinic, separate from the
-- internal id, never reused. The API takes the next number inside the patient-create transaction:
--   INSERT INTO clinic_counters (clinic_id, name, value, updated_at)
--   VALUES (<clinic>, 'patient_file_number', 1, now())
--   ON CONFLICT (clinic_id, name)
--   DO UPDATE SET value = clinic_counters.value + 1, updated_at = now()
--   RETURNING value;
-- The upsert locks the clinic's counter row, so concurrent creates get distinct numbers, and a
-- rolled-back create only leaves a gap (gaps are fine; reuse is not).

CREATE TABLE clinic_counters (
  clinic_id  uuid NOT NULL REFERENCES clinics (id),
  name       text NOT NULL CHECK (name IN ('patient_file_number')),
  value      bigint NOT NULL CHECK (value > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, name)
);

ALTER TABLE clinic_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_counters_tenant_isolation ON clinic_counters
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- A counter only moves forward, so a file number can never be handed out twice.
CREATE FUNCTION enforce_counter_forward() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.value <= OLD.value THEN
    RAISE EXCEPTION 'counter % can only increase', OLD.name USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER clinic_counters_forward
  BEFORE UPDATE ON clinic_counters
  FOR EACH ROW EXECUTE FUNCTION enforce_counter_forward();

REVOKE ALL ON clinic_counters FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON clinic_counters TO eyadex_app;
-- The platform never sees it: the counter is a patient count.
REVOKE ALL ON clinic_counters FROM eyadex_platform;

-- File numbers are stored as plain positive integers; the UI pads them for display.
ALTER TABLE patients ADD CONSTRAINT patients_file_number_numeric CHECK (file_number ~ '^[1-9][0-9]*$');
