-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Finance F2 release (docs/specs/finance-design.md §4.1, §4.5 row 0067; R2-4 again, F2-Q15): each
-- existing clinic's locked admin role gains the five new clinic-scope keys (view/create:payments:clinic,
-- create:refunds:clinic, view/create:cash_closings:clinic) through 0063's statement unchanged — its
-- predicate (module finance, scope clinic) now also matches them. No other role changes, no `finance`
-- flag changes, and the new-clinic default stays off: the platform switches finance on per clinic.

-- R1-11: the locked clinic admin only, found by `system_key`; it holds every clinic-scope key of the
-- catalogue and never a branch or `own` one, so the other finance keys stay out. Doctor, receptionist,
-- technician and custom roles do not change (FIN-4 "existing roles are not changed").
INSERT INTO role_permissions (clinic_id, id, role_id, permission_id, created_at)
SELECT r.clinic_id, uuidv7(), r.id, p.id, now()
FROM roles r JOIN permissions p ON p.module = 'finance' AND p.scope = 'clinic'
WHERE r.system_key = 'clinic_admin' AND r.is_locked
ON CONFLICT (clinic_id, role_id, permission_id) DO NOTHING;
