-- SQL baseline (applied to production 2026-10-03, PostgreSQL 18; compatible with 16).
-- Runtime roles and grants (PRD 4.5). The roles themselves (LOGIN + password) are created
-- outside this file so no password is ever committed; this file only grants privileges.
-- No runtime role has BYPASSRLS. The owner role runs migrations only.

-- Nobody gets anything by default.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO eyadex_app, eyadex_auth, eyadex_platform, eyadex_dispatcher;

-- The tenant root gets RLS too: a clinic session sees only its own clinic row,
-- the platform role sees every clinic.
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinics FORCE ROW LEVEL SECURITY;
CREATE POLICY clinics_own_clinic ON clinics FOR SELECT TO eyadex_app
  USING (id = current_setting('app.clinic_id')::uuid);
CREATE POLICY clinics_platform_all ON clinics TO eyadex_platform
  USING (true) WITH CHECK (true);

-- eyadex_app: API + worker inside withTenant(). Read/write clinic data, never delete.
GRANT SELECT ON clinics TO eyadex_app;
GRANT SELECT ON permissions TO eyadex_app;
-- Feature flags are controlled by the platform only (PRD 4.8): the clinic reads them.
GRANT SELECT ON clinic_features TO eyadex_app;
GRANT SELECT, INSERT, UPDATE ON
  branches, roles, role_permissions, memberships, membership_branches,
  invitations, invitation_branches, patients
  TO eyadex_app;
-- Append-only: the audit log can be written and read, never changed or deleted.
GRANT SELECT, INSERT ON audit_log TO eyadex_app;

-- eyadex_platform: the super-admin module. Manages clinics, subscription and flags,
-- reads a clinic's users and branches, and NEVER touches patients or patient-access audit rows.
GRANT SELECT, INSERT, UPDATE ON clinics, clinic_features TO eyadex_platform;
GRANT SELECT ON permissions, branches, roles, role_permissions, memberships,
  membership_branches, invitations, invitation_branches TO eyadex_platform;
GRANT SELECT, INSERT ON platform_audit_log TO eyadex_platform;
REVOKE ALL ON patients FROM eyadex_platform;
REVOKE ALL ON audit_log FROM eyadex_platform;

-- The platform reads clinics' administrative events only, through this view.
-- It runs with the owner's rights (crossing clinics on purpose) and filters out
-- every patient-access event, so patient activity is unreachable from the platform role.
CREATE VIEW platform_clinic_admin_audit WITH (security_barrier = true) AS
  SELECT clinic_id, id, actor_user_id, action, entity_type, entity_id, branch_id, details, created_at
  FROM audit_log
  WHERE category = 'administrative';
GRANT SELECT ON platform_clinic_admin_audit TO eyadex_platform;

-- eyadex_auth (Better Auth identity tables) and eyadex_dispatcher (outbox) get their
-- table grants together with those tables in Phase B.
