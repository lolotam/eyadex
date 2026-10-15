-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Finance F1 release (docs/specs/finance-design.md §3.1, §8c.3 item 4; plan Task 6; R2-4, FIN-4): each
-- existing clinic's locked admin role gains the seven clinic-scope finance keys, the same set
-- `system-roles.ts` (`clinicScope`) gives a new clinic's admin. No clinic's `finance` flag changes.

-- R1-11: the locked clinic admin only, found by `system_key`. It holds every clinic-scope key of the
-- catalogue and never a branch or `own` one, so the other six finance keys stay out. Doctor, receptionist,
-- technician and custom roles do not change (FIN-4 "existing roles are not changed"): the admin grants
-- finance keys to them in the role editor. Unlike 0050 there is no one-scope-per-action guard: a locked
-- admin's keys are all clinic scope, so it can hold no other scope of these actions.
INSERT INTO role_permissions (clinic_id, id, role_id, permission_id, created_at)
SELECT r.clinic_id, uuidv7(), r.id, p.id, now()
FROM roles r JOIN permissions p ON p.module = 'finance' AND p.scope = 'clinic'
WHERE r.system_key = 'clinic_admin' AND r.is_locked
ON CONFLICT (clinic_id, role_id, permission_id) DO NOTHING;

-- Unlike 0050, the module stays off for new clinics: the platform switches finance on per clinic. 0060
-- already left this false; the statement records the release decision where the release is.
UPDATE platform_settings SET default_module_finance = false;
