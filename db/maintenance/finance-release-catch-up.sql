-- Finance F1 release catch-up (0063; spec §8c.3 item 4, R2-4). Not a migration: db/migrate.sh never runs it.
-- A clinic created by the code that predates the release, between applying 0063 and deploying that code,
-- has a locked admin without the finance keys. Run this after the release deploy on each environment and
-- before the platform switches `finance` on for any clinic. It is 0063's role statement, unchanged:
-- idempotent, so a second run changes nothing. It leaves the platform default alone (the super admin may
-- have changed it since). No BEGIN/COMMIT here: db/tests/finance-release.sql runs it inside its own
-- transaction.
-- Usage: psql -1 -v ON_ERROR_STOP=1 -f db/maintenance/finance-release-catch-up.sql   (as the migration owner)

INSERT INTO role_permissions (clinic_id, id, role_id, permission_id, created_at)
SELECT r.clinic_id, uuidv7(), r.id, p.id, now()
FROM roles r JOIN permissions p ON p.module = 'finance' AND p.scope = 'clinic'
WHERE r.system_key = 'clinic_admin' AND r.is_locked
ON CONFLICT (clinic_id, role_id, permission_id) DO NOTHING;
