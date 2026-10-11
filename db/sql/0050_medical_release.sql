-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- P2 release, slice M6 (docs/specs/medical-design.md §2, §9; plan Task 12 with amendments R1-16, R2-3,
-- R2-5; ADR-0029 §12): existing clinics' system roles gain the medical module's keys by the same rule as
-- new clinics' templates (identity/domain/system-roles.ts), and the module joins the new-clinic defaults.
-- No clinic's `medical` flag changes: the platform switches it on per clinic after the release deploy.

-- R1-16: system roles only, found by `system_key`; a custom role never changes. The locked clinic admin
-- gains the clinic-scope `visits` and `medicines` keys and never a `medical` one (P2-5: it grants those to
-- other roles through its bounded delegation, R1-2). A role that already holds a key of the same action
-- and resource at another scope keeps it alone (one scope per action, `permissionKeysSchema`).
-- db/maintenance/medical-release-catch-up.sql repeats this statement after the deploy (R2-5).
INSERT INTO role_permissions (clinic_id, id, role_id, permission_id, created_at)
SELECT r.clinic_id, uuidv7(), r.id, p.id, now()
FROM (VALUES
    ('clinic_admin', 'view:visits:clinic'),
    ('clinic_admin', 'view:medicines:clinic'),
    ('clinic_admin', 'update:medicines:clinic'),
    ('doctor', 'view:visits:own'),
    ('doctor', 'create:visits:own'),
    ('doctor', 'view:medical:own'),
    ('doctor', 'update:medical:own'),
    ('doctor', 'view:medicines:clinic'),
    ('receptionist', 'view:visits:branch')
  ) AS release (system_key, key)
JOIN roles r ON r.system_key = release.system_key
  AND (r.system_key <> 'clinic_admin' OR r.is_locked)
JOIN permissions p ON p.key = release.key
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions held JOIN permissions q ON q.id = held.permission_id
  WHERE held.clinic_id = r.clinic_id AND held.role_id = r.id
    AND q.action = p.action AND q.resource = p.resource)
ON CONFLICT (clinic_id, role_id, permission_id) DO NOTHING;

-- R2-3: new clinics get the medical module by default from now on; the super admin may still turn it off
-- on the create form or in the platform settings.
UPDATE platform_settings SET default_module_medical = true;
