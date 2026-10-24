-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Finance F3 release (docs/specs/finance-f3-reports-design.md §3, §8 row 0070; R2-4 again, F3-Q9 b,
-- EY-10.1): each existing clinic's locked admin role gains the three clinic-scope report keys
-- (view:report_takings:clinic, view:report_analytics:clinic, view:report_patients:clinic) through 0063's
-- statement unchanged — its predicate (module finance, scope clinic) now also matches them. No other role
-- changes: the receptionist's and the doctor's report keys are new-clinic defaults only (FIN-4).

-- R1-11: the locked clinic admin only, found by `system_key`; it holds every clinic-scope key of the
-- catalogue and never a branch or `own` one, so view:report_*:branch and view:report_own:own stay out.
-- Doctor, receptionist, technician and custom roles do not change (FIN-4 "existing roles are not changed").
INSERT INTO role_permissions (clinic_id, id, role_id, permission_id, created_at)
SELECT r.clinic_id, uuidv7(), r.id, p.id, now()
FROM roles r JOIN permissions p ON p.module = 'finance' AND p.scope = 'clinic'
WHERE r.system_key = 'clinic_admin' AND r.is_locked
ON CONFLICT (clinic_id, role_id, permission_id) DO NOTHING;
