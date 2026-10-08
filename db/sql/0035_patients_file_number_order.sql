-- Slice 9 (ADR-0018): the patient list pages newest file first with a `file_number::bigint` cursor.
-- The unique (clinic_id, file_number) index orders text, which PostgreSQL cannot use for the bigint
-- order, so later pages would scan and sort the clinic's files. This expression index serves the
-- order and the range directly (read backwards for DESC).
CREATE INDEX patients_clinic_file_number_num_idx ON patients (clinic_id, ((file_number)::bigint));
