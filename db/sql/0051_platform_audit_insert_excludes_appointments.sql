-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- The platform's INSERT policy on audit_log (0016, onboarding audit rows) gets the same entity list as
-- its read policy and its view. 0046 rewrote that policy with the medical entities but left out
-- `appointment`, which 0043 keeps away from the platform: an appointment row is filed as administrative
-- (0043, spec §4 rule 9) yet records a patient's booking, so the platform could still write one.
-- 0046 is already applied on staging, so the fix is this file, not an edit of 0046.
ALTER POLICY audit_log_platform_admin_insert ON audit_log
  WITH CHECK (
    category = 'administrative'
    AND entity_type NOT IN ('patient', 'appointment', 'visit', 'visit_addendum', 'diagnosis',
      'prescription', 'medical_profile', 'attachment', 'medicine')
    AND clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
