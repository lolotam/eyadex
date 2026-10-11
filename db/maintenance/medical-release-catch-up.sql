-- P2 release catch-up (plan amendment R2-5, ADR-0029 §12). Not a migration: db/migrate.sh never runs it.
-- A clinic created by the code that predates the release, between applying 0050 and deploying that code,
-- has system roles without the medical keys. Run this after the release deploy on each environment and
-- before the platform switches `medical` on for any clinic. It is 0050's role statement, unchanged:
-- idempotent, so a second run changes nothing. It leaves the platform default alone (the super admin may
-- have turned it off since). No BEGIN/COMMIT here: db/tests/medical-release.sql runs it inside its own
-- transaction.
-- Usage: psql -1 -v ON_ERROR_STOP=1 -f db/maintenance/medical-release-catch-up.sql   (as the migration owner)

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
