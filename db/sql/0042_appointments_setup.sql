-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Appointments slice A1 (ADR-0026, docs/specs/appointments-design.md §2-§3): the `appointments`
-- module flag, its permission keys, a member's booking profile, the clinic's services, weekly
-- provider schedules and time off. Appointments themselves arrive with slice A2.

-- D-9: a module the platform switches per clinic, like `patients`. Existing clinics get no row: a module
-- with no row is off (ADR-0010), so nothing changes for them until the platform turns it on.
ALTER TABLE clinic_features DROP CONSTRAINT clinic_features_module_check;
ALTER TABLE clinic_features ADD CONSTRAINT clinic_features_module_check
  CHECK (module IN ('patients', 'appointments'));

-- D-9: the module joins the new-clinic default modules (ADR-0020 amendment's recipe: one boolean
-- column per module, seeded, NOT NULL, no DEFAULT left behind). The temporary DEFAULT only seeds the
-- one existing row; the create form then pre-fills appointments on, and the super admin may turn it off.
ALTER TABLE platform_settings ADD COLUMN default_module_appointments boolean NOT NULL DEFAULT true;
ALTER TABLE platform_settings ALTER COLUMN default_module_appointments DROP DEFAULT;
GRANT UPDATE (default_module_appointments) ON platform_settings TO eyadex_platform;

-- Spec §3: the action `overbook`, the module's three resources and the scope `own`. The rows mirror
-- PERMISSION_CATALOG (packages/contracts); code looks permissions up by key, never by id.
-- `view:patients:own` arrives with slice A3, together with the query that evaluates it.
ALTER TABLE permissions DROP CONSTRAINT permissions_key_check;
ALTER TABLE permissions ADD CONSTRAINT permissions_key_check CHECK (key ~ '^(view|create|update|deactivate|overbook):(branches|users|roles|patients|audit_log|clinic_settings|appointments|services|schedules):(clinic|branch|own)$');
ALTER TABLE permissions DROP CONSTRAINT permissions_module_check;
ALTER TABLE permissions ADD CONSTRAINT permissions_module_check
  CHECK (module IN ('patients', 'appointments'));
INSERT INTO permissions (id, key, action, resource, scope, module) VALUES
  ('00000000-0000-7000-8000-0000000c0018', 'view:appointments:clinic', 'view', 'appointments', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0019', 'view:appointments:branch', 'view', 'appointments', 'branch', 'appointments'),
  ('00000000-0000-7000-8000-0000000c001a', 'view:appointments:own', 'view', 'appointments', 'own', 'appointments'),
  ('00000000-0000-7000-8000-0000000c001b', 'create:appointments:clinic', 'create', 'appointments', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c001c', 'create:appointments:branch', 'create', 'appointments', 'branch', 'appointments'),
  ('00000000-0000-7000-8000-0000000c001d', 'update:appointments:clinic', 'update', 'appointments', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c001e', 'update:appointments:branch', 'update', 'appointments', 'branch', 'appointments'),
  ('00000000-0000-7000-8000-0000000c001f', 'overbook:appointments:clinic', 'overbook', 'appointments', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0020', 'overbook:appointments:branch', 'overbook', 'appointments', 'branch', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0021', 'view:services:clinic', 'view', 'services', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0022', 'create:services:clinic', 'create', 'services', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0023', 'update:services:clinic', 'update', 'services', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0024', 'deactivate:services:clinic', 'deactivate', 'services', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0025', 'view:schedules:clinic', 'view', 'schedules', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0026', 'view:schedules:branch', 'view', 'schedules', 'branch', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0027', 'update:schedules:clinic', 'update', 'schedules', 'clinic', 'appointments'),
  ('00000000-0000-7000-8000-0000000c0028', 'update:schedules:branch', 'update', 'schedules', 'branch', 'appointments');

-- D-1, D-15: whether a member can be booked (never derived from the role name) and the length of a
-- booking with no service. Every existing member starts not bookable, 20 minutes.
ALTER TABLE memberships
  ADD COLUMN accepts_appointments boolean NOT NULL DEFAULT false,
  ADD COLUMN default_duration_minutes integer NOT NULL DEFAULT 20
    CONSTRAINT memberships_default_duration_minutes_check
    CHECK (default_duration_minutes BETWEEN 5 AND 480);

-- D-12: one clinic-level list. Names are unique per language like roles (0018), inactive ones included,
-- so reactivating one can never collide. No price until the finance phase; never deleted (deactivated).
CREATE TABLE clinic_services (
  clinic_id        uuid NOT NULL REFERENCES clinics (id),
  id               uuid NOT NULL,
  name_ar          text NOT NULL,
  name_en          text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  status           text NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id)
);
CREATE UNIQUE INDEX clinic_services_name_ar_unique ON clinic_services (clinic_id, lower(btrim(name_ar)));
CREATE UNIQUE INDEX clinic_services_name_en_unique ON clinic_services (clinic_id, lower(btrim(name_en)));
CREATE INDEX clinic_services_clinic_status_idx ON clinic_services (clinic_id, status);

-- D-6, D-14: a provider's weekly hours per branch in clinic wall-clock time; 24:00 ends a day. Rows are
-- configuration, not history: saving a branch's week deletes its rows and writes the new ones in one
-- transaction under the provider lock (ADR-0026 §4), and that change is audited. Overlaps across a
-- provider's branches are refused by the use case under the same lock (D-13: no new extension).
CREATE TABLE provider_schedules (
  clinic_id     uuid NOT NULL REFERENCES clinics (id),
  id            uuid NOT NULL,
  membership_id uuid NOT NULL,
  branch_id     uuid NOT NULL,
  weekday       smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at     time NOT NULL,
  ends_at       time NOT NULL,
  created_at    timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, membership_id) REFERENCES memberships (clinic_id, id),
  FOREIGN KEY (clinic_id, branch_id) REFERENCES branches (clinic_id, id),
  CONSTRAINT provider_schedules_interval_check CHECK (starts_at < ends_at)
);
CREATE INDEX provider_schedules_clinic_membership_weekday_idx
  ON provider_schedules (clinic_id, membership_id, weekday);
CREATE INDEX provider_schedules_clinic_branch_idx ON provider_schedules (clinic_id, branch_id);

-- D-6: periods a provider cannot be booked in, stored UTC. Never deleted: a mistaken one is cancelled.
-- The note is free text about a person's absence: it never reaches an audit row (ADR-0026 §7).
CREATE TABLE provider_time_off (
  clinic_id     uuid NOT NULL REFERENCES clinics (id),
  id            uuid NOT NULL,
  membership_id uuid NOT NULL,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  note          text NULL CHECK (char_length(note) <= 200),
  cancelled_at  timestamptz NULL,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, membership_id) REFERENCES memberships (clinic_id, id),
  CONSTRAINT provider_time_off_interval_check CHECK (starts_at < ends_at)
);
CREATE INDEX provider_time_off_clinic_membership_starts_idx
  ON provider_time_off (clinic_id, membership_id, starts_at);

ALTER TABLE clinic_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_services FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_services_tenant_isolation ON clinic_services
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE provider_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_schedules_tenant_isolation ON provider_schedules
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE provider_time_off ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_time_off FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_time_off_tenant_isolation ON provider_time_off
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- The clinic runtime role only. Schedule rows are replaced (DELETE + INSERT), never updated; services and
-- time off are updated (deactivate, cancel), never deleted. The platform never reads any of them: they
-- name the clinic's staff and, from A2 on, sit next to the appointments that name patients.
GRANT SELECT, INSERT, UPDATE ON clinic_services, provider_time_off TO eyadex_app;
GRANT SELECT, INSERT, DELETE ON provider_schedules TO eyadex_app;
REVOKE ALL ON clinic_services, provider_schedules, provider_time_off FROM eyadex_platform;

-- PRD §5.3: "Clinic Admin (locked, everything)". A locked role refuses every write (ADR-0017), so only
-- this file can give existing admins the module's keys; without them no existing clinic could ever open
-- its services or schedules. No other existing role changes (spec §3). The keys of a module that is off
-- grant nothing until the platform turns it on (ADR-0010).
DO $$
BEGIN
  -- Every clinic's roles: only a role that bypasses RLS sees them all. Refuse loudly rather than
  -- backfill nothing.
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION '0042: the admin backfill must run as the migration owner (superuser)';
  END IF;
END $$;
INSERT INTO role_permissions (clinic_id, id, role_id, permission_id, created_at)
SELECT r.clinic_id, uuidv7(), r.id, p.id, now()
FROM roles r CROSS JOIN permissions p
WHERE r.system_key = 'clinic_admin' AND r.is_locked
  AND p.module = 'appointments' AND p.scope = 'clinic'
ON CONFLICT (clinic_id, role_id, permission_id) DO NOTHING;
