-- SQL baseline (applied to production 2026-10-03, PostgreSQL 18; compatible with 16).

-- 1. Link tables have no inactive state: changing a user from branches A+B to B, or removing a
--    permission from a role, deletes the obsolete link row. DELETE is granted on these three
--    link tables ONLY (RLS still limits it to the caller's clinic). Users, branches, roles,
--    patients and the audit log stay undeletable.
GRANT DELETE ON membership_branches, role_permissions, invitation_branches TO eyadex_app;

-- 2. Onboarding and first-admin resends run as eyadex_platform and must record the clinic's
--    administrative audit entry (invitation.sent / invitation.resent) in the same transaction.
--    The platform may INSERT administrative, non-patient rows for the clinic it is working on,
--    and still cannot read the audit log (it reads platform_clinic_admin_audit only).
GRANT INSERT ON audit_log TO eyadex_platform;
CREATE POLICY audit_log_platform_admin_insert ON audit_log FOR INSERT TO eyadex_platform
  WITH CHECK (
    category = 'administrative'
    AND entity_type <> 'patient'
    AND clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
