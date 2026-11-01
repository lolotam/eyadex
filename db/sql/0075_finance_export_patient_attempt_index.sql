-- The partial uniqueness indexes do not cover complete markers or redacted rows.
-- Keep every referencing row indexed for the allocated-blob foreign key.
CREATE INDEX finance_report_export_patients_attempt_idx
  ON finance_report_export_patients (clinic_id, export_id, attempt);
