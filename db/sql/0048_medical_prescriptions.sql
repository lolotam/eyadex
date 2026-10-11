-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- P2 slice M4 (docs/specs/medical-design.md §4, §5; plan Task 9 with amendment R1-13): the medicines
-- written on a visit (P2-9) and the clinic's own list of frequent medicines to pick them from (P2-F2).

-- P2-9, R1-13: the prescription as one list the provider replaces whole while the visit is a draft,
-- archived and re-inserted like the diagnoses (0047). Every value is a FieldCipher envelope bound to its
-- own row (ADR-0028); the dose, frequency and duration are always written (an empty one is sealed as
-- such), the note only when there is one.
CREATE TABLE visit_prescription_items (
  clinic_id     uuid NOT NULL REFERENCES clinics (id),
  id            uuid NOT NULL,
  visit_id      uuid NOT NULL,
  position      smallint NOT NULL CHECK (position BETWEEN 0 AND 29),
  medicine_enc  text NOT NULL CHECK (medicine_enc ~ '^f1\.[0-9]+\.'),
  dose_enc      text NOT NULL CHECK (dose_enc ~ '^f1\.[0-9]+\.'),
  frequency_enc text NOT NULL CHECK (frequency_enc ~ '^f1\.[0-9]+\.'),
  duration_enc  text NOT NULL CHECK (duration_enc ~ '^f1\.[0-9]+\.'),
  note_enc      text NULL CHECK (note_enc ~ '^f1\.[0-9]+\.'),
  created_at    timestamptz NOT NULL,
  archived_at   timestamptz NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, visit_id) REFERENCES visits (clinic_id, id)
);

-- One active row per place in the list (R1-13, R1-9); the plain index serves the foreign key.
CREATE UNIQUE INDEX visit_prescription_items_clinic_visit_position_active
  ON visit_prescription_items (clinic_id, visit_id, position) WHERE archived_at IS NULL;
CREATE INDEX visit_prescription_items_clinic_visit_idx
  ON visit_prescription_items (clinic_id, visit_id);

ALTER TABLE visit_prescription_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_prescription_items FORCE ROW LEVEL SECURITY;
CREATE POLICY visit_prescription_items_tenant_isolation ON visit_prescription_items
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- P2-F2: the clinic's frequent medicines, typed by the clinic (not patient data, stored plain, spec §3).
-- A name is unique per clinic whatever its status, compared as the services list compares its names
-- (0042); a medicine is deactivated, never deleted.
CREATE TABLE clinic_medicines (
  clinic_id         uuid NOT NULL REFERENCES clinics (id),
  id                uuid NOT NULL,
  name              text NOT NULL,
  default_dose      text NULL,
  default_frequency text NULL,
  status            text NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id)
);
CREATE UNIQUE INDEX clinic_medicines_name_unique ON clinic_medicines (clinic_id, lower(btrim(name)));

ALTER TABLE clinic_medicines ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_medicines FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_medicines_tenant_isolation ON clinic_medicines
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- The clinic runtime role only, and never DELETE. The platform has no privilege on either (P2-K3): the
-- medicines list belongs to the clinic's clinical module, like its audit rows (0046).
GRANT SELECT, INSERT, UPDATE ON visit_prescription_items, clinic_medicines TO eyadex_app;
REVOKE ALL ON visit_prescription_items, clinic_medicines FROM eyadex_platform;
