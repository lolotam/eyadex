-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Appointments slice A3 (ADR-0026 A3, docs/specs/appointments-design.md §3, D-4, D-8): the catalogue
-- gains `view:patients:own`, the patients view scope the A3 queries evaluate: a file is "own" when it has
-- at least one appointment with the caller that is not cancelled. The predicate reads appointments
-- through 0043's partial index `appointments_clinic_provider_patient_live_idx`, so no index is added.
--
-- No role changes. The locked Clinic Admin does not get the key (D-16 covers clinic-scope keys; the
-- admin's `view:patients:clinic` is wider), and existing clinics' doctor roles keep their keys: only new
-- clinics' doctor role is seeded with the own keys (SYSTEM_ROLES).
--
-- Order: apply before the A3 code ships. The new code needs the row (onboarding seeds the doctor role
-- with this key and stops on a key the catalogue lacks). The old code is unaffected by it: no role holds
-- the key, its role writes accept only keys of its own catalogue, and its `effectivePermissions` drops
-- any stored key it does not know.
INSERT INTO permissions (id, key, action, resource, scope, module) VALUES
  ('00000000-0000-7000-8000-0000000c0029', 'view:patients:own', 'view', 'patients', 'own', 'patients')
ON CONFLICT DO NOTHING;
