-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- P2 slice M2 (docs/specs/medical-design.md §2, §4, §5; plan Task 4 with amendments R1-1, R1-9, R2-3):
-- the `medical` module flag, its ten catalogue keys, visits, their notes and addenda, and the patient's
-- medical file. No role gains a key and no clinic or default switches the module on here: both happen
-- only at the release migration (spec §9, R1-16).

-- Spec §2: a module the platform switches per clinic. Existing clinics get no row: a module with no row
-- is off (ADR-0010).
ALTER TABLE clinic_features DROP CONSTRAINT clinic_features_module_check;
ALTER TABLE clinic_features ADD CONSTRAINT clinic_features_module_check
  CHECK (module IN ('patients', 'appointments', 'medical'));

-- R2-3: the new-clinic default, off until the release migration turns it on. Same recipe as 0042 (the
-- ADR-0020 amendment: seeded, NOT NULL, no DEFAULT left behind). The settings use case writes every
-- column in one UPDATE, so the platform needs the column grant even while the API only lets it be false.
ALTER TABLE platform_settings ADD COLUMN default_module_medical boolean NOT NULL DEFAULT false;
ALTER TABLE platform_settings ALTER COLUMN default_module_medical DROP DEFAULT;
GRANT UPDATE (default_module_medical) ON platform_settings TO eyadex_platform;

-- Spec §2: the resources `visits`, `medical` (clinical content) and `medicines` (the clinic's list).
-- The rows mirror PERMISSION_CATALOG (packages/contracts) in its order; code looks keys up by key.
ALTER TABLE permissions DROP CONSTRAINT permissions_key_check;
ALTER TABLE permissions ADD CONSTRAINT permissions_key_check CHECK (key ~ '^(view|create|update|deactivate|overbook):(branches|users|roles|patients|audit_log|clinic_settings|appointments|services|schedules|visits|medical|medicines):(clinic|branch|own)$');
ALTER TABLE permissions DROP CONSTRAINT permissions_module_check;
ALTER TABLE permissions ADD CONSTRAINT permissions_module_check
  CHECK (module IN ('patients', 'appointments', 'medical'));
INSERT INTO permissions (id, key, action, resource, scope, module) VALUES
  ('00000000-0000-7000-8000-0000000c002a', 'view:visits:clinic', 'view', 'visits', 'clinic', 'medical'),
  ('00000000-0000-7000-8000-0000000c002b', 'view:visits:branch', 'view', 'visits', 'branch', 'medical'),
  ('00000000-0000-7000-8000-0000000c002c', 'view:visits:own', 'view', 'visits', 'own', 'medical'),
  ('00000000-0000-7000-8000-0000000c002d', 'create:visits:own', 'create', 'visits', 'own', 'medical'),
  ('00000000-0000-7000-8000-0000000c002e', 'view:medical:clinic', 'view', 'medical', 'clinic', 'medical'),
  ('00000000-0000-7000-8000-0000000c002f', 'view:medical:own', 'view', 'medical', 'own', 'medical'),
  ('00000000-0000-7000-8000-0000000c0030', 'update:medical:clinic', 'update', 'medical', 'clinic', 'medical'),
  ('00000000-0000-7000-8000-0000000c0031', 'update:medical:own', 'update', 'medical', 'own', 'medical'),
  ('00000000-0000-7000-8000-0000000c0032', 'view:medicines:clinic', 'view', 'medicines', 'clinic', 'medical'),
  ('00000000-0000-7000-8000-0000000c0033', 'update:medicines:clinic', 'update', 'medicines', 'clinic', 'medical');

-- Every `*_enc` column holds a FieldCipher envelope `f1.<keyVersion>.<iv>.<ciphertext>.<tag>` (ADR-0028),
-- never clinical text: the CHECKs below refuse a value that is not one, so a writer that forgets to seal
-- fails loudly instead of storing plaintext. Actor columns (`signed_by`, `updated_by`,
-- `author_membership_id`) are membership ids with no foreign key, like appointments.created_by (0043): a
-- key to the actor's membership would take one more membership row lock at write time (ADR-0027).

-- Spec §4, P2-2, P2-6: a visit starts from an arrived appointment or as a walk-in; a draft is signed
-- (locked) or cancelled, never deleted. Cancelling is for drafts only, so a cancelled visit was never
-- signed; the note says why in the clinic's words, encrypted.
CREATE TABLE visits (
  clinic_id              uuid NOT NULL REFERENCES clinics (id),
  id                     uuid NOT NULL,
  branch_id              uuid NOT NULL,
  patient_id             uuid NOT NULL,
  provider_membership_id uuid NOT NULL,
  appointment_id         uuid NULL,
  status                 text NOT NULL CHECK (status IN ('draft', 'signed', 'cancelled')),
  started_at             timestamptz NOT NULL,
  signed_at              timestamptz NULL,
  signed_by              uuid NULL,
  cancel_reason          text NULL
    CHECK (cancel_reason IN ('opened_by_mistake', 'patient_left', 'other')),
  cancel_note_enc        text NULL CHECK (cancel_note_enc ~ '^f1\.[0-9]+\.'),
  created_at             timestamptz NOT NULL,
  updated_at             timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, branch_id) REFERENCES branches (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  FOREIGN KEY (clinic_id, provider_membership_id) REFERENCES memberships (clinic_id, id),
  FOREIGN KEY (clinic_id, appointment_id) REFERENCES appointments (clinic_id, id),
  CONSTRAINT visits_signed_check
    CHECK ((status = 'signed') = (signed_at IS NOT NULL) AND (signed_at IS NULL) = (signed_by IS NULL)),
  CONSTRAINT visits_cancelled_check
    CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL)
      AND (cancel_note_enc IS NULL OR status = 'cancelled'))
);

-- Spec §4: one live visit per appointment (a cancelled one frees it). A partial unique index, never a
-- table constraint (R1-9); the plain appointment index serves the foreign key.
CREATE UNIQUE INDEX visits_clinic_appointment_live ON visits (clinic_id, appointment_id)
  WHERE appointment_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX visits_clinic_appointment_idx ON visits (clinic_id, appointment_id);
-- A patient's visits newest first (the list), a branch's day, and the `own` predicate (a visit with the
-- caller, any status: R1-18). Every foreign key leads an index.
CREATE INDEX visits_clinic_patient_started_idx ON visits (clinic_id, patient_id, started_at DESC);
CREATE INDEX visits_clinic_branch_started_idx ON visits (clinic_id, branch_id, started_at);
CREATE INDEX visits_clinic_provider_patient_idx
  ON visits (clinic_id, provider_membership_id, patient_id);

-- P2-3, P2-6: the visit's four note sections, written by its provider while the visit is a draft.
CREATE TABLE visit_notes (
  clinic_id       uuid NOT NULL REFERENCES clinics (id),
  id              uuid NOT NULL,
  visit_id        uuid NOT NULL,
  complaint_enc   text NULL CHECK (complaint_enc ~ '^f1\.[0-9]+\.'),
  examination_enc text NULL CHECK (examination_enc ~ '^f1\.[0-9]+\.'),
  assessment_enc  text NULL CHECK (assessment_enc ~ '^f1\.[0-9]+\.'),
  plan_enc        text NULL CHECK (plan_enc ~ '^f1\.[0-9]+\.'),
  updated_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, visit_id) REFERENCES visits (clinic_id, id)
);
CREATE UNIQUE INDEX visit_notes_clinic_visit_unique ON visit_notes (clinic_id, visit_id);

-- P2-6: a correction to a signed note, never an edit of it: who, when, what.
CREATE TABLE visit_addenda (
  clinic_id            uuid NOT NULL REFERENCES clinics (id),
  id                   uuid NOT NULL,
  visit_id             uuid NOT NULL,
  author_membership_id uuid NOT NULL,
  body_enc             text NOT NULL CHECK (body_enc ~ '^f1\.[0-9]+\.'),
  created_at           timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, visit_id) REFERENCES visits (clinic_id, id)
);
CREATE INDEX visit_addenda_clinic_visit_created_idx
  ON visit_addenda (clinic_id, visit_id, created_at);

-- P2-7: the patient's medical file, five free-text sections, one row per patient.
CREATE TABLE patient_medical_profiles (
  clinic_id               uuid NOT NULL REFERENCES clinics (id),
  id                      uuid NOT NULL,
  patient_id              uuid NOT NULL,
  allergies_enc           text NULL CHECK (allergies_enc ~ '^f1\.[0-9]+\.'),
  chronic_conditions_enc  text NULL CHECK (chronic_conditions_enc ~ '^f1\.[0-9]+\.'),
  current_medications_enc text NULL CHECK (current_medications_enc ~ '^f1\.[0-9]+\.'),
  surgical_history_enc    text NULL CHECK (surgical_history_enc ~ '^f1\.[0-9]+\.'),
  family_history_enc      text NULL CHECK (family_history_enc ~ '^f1\.[0-9]+\.'),
  updated_by              uuid NOT NULL,
  created_at              timestamptz NOT NULL,
  updated_at              timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id)
);
CREATE UNIQUE INDEX patient_medical_profiles_clinic_patient_unique
  ON patient_medical_profiles (clinic_id, patient_id);

ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits FORCE ROW LEVEL SECURITY;
CREATE POLICY visits_tenant_isolation ON visits
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE visit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY visit_notes_tenant_isolation ON visit_notes
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE visit_addenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_addenda FORCE ROW LEVEL SECURITY;
CREATE POLICY visit_addenda_tenant_isolation ON visit_addenda
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE patient_medical_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_medical_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY patient_medical_profiles_tenant_isolation ON patient_medical_profiles
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- The clinic runtime role only, and never DELETE. An addendum is append-only (P2-6: never an edit), so
-- it gets no UPDATE either. The platform has no privilege on any of them (PRD §8, P2-K3).
GRANT SELECT, INSERT, UPDATE ON visits, visit_notes, patient_medical_profiles TO eyadex_app;
GRANT SELECT, INSERT ON visit_addenda TO eyadex_app;
REVOKE ALL ON visits, visit_notes, visit_addenda, patient_medical_profiles FROM eyadex_platform;

-- R1-1, spec §5: every audit row about a patient's clinical record is patient access, so the database
-- refuses one filed as administrative, as it does for `patient` (0011). `medicine` (the clinic's list,
-- not patient data) stays administrative.
ALTER TABLE audit_log DROP CONSTRAINT audit_log_patient_events_are_patient_access;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_patient_events_are_patient_access
  CHECK (entity_type NOT IN ('patient', 'visit', 'visit_addendum', 'diagnosis', 'prescription',
    'medical_profile', 'attachment') OR category = 'patient_access');

-- The platform reads clinic audit only through this view (0013, 0043). It now also leaves out every
-- medical entity: the six patient-access ones by category already, and `medicine` too, since the platform
-- never needs the clinic's clinical module. Same columns, same owner and grant; CREATE OR REPLACE keeps both.
CREATE OR REPLACE VIEW platform_clinic_admin_audit WITH (security_barrier = true) AS
  SELECT clinic_id, id, actor_user_id, action, entity_type, entity_id, branch_id, details, created_at
  FROM audit_log
  WHERE category = 'administrative'
    AND entity_type NOT IN ('patient', 'appointment', 'visit', 'visit_addendum', 'diagnosis',
      'prescription', 'medical_profile', 'attachment', 'medicine');

-- The view owner's only access to audit_log (0013) follows the view, so the view can never widen past
-- it; 0043 left the policy at `patient`, which the view alone then narrowed. The platform's own INSERT
-- policy (0016, onboarding audit rows) gets the same list: the platform never writes a medical row.
ALTER POLICY audit_log_platform_admin_rows ON audit_log
  USING (category = 'administrative'
    AND entity_type NOT IN ('patient', 'appointment', 'visit', 'visit_addendum', 'diagnosis',
      'prescription', 'medical_profile', 'attachment', 'medicine'));
ALTER POLICY audit_log_platform_admin_insert ON audit_log
  WITH CHECK (
    category = 'administrative'
    AND entity_type NOT IN ('patient', 'visit', 'visit_addendum', 'diagnosis', 'prescription',
      'medical_profile', 'attachment', 'medicine')
    AND clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
