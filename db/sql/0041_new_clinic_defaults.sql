-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Default limits and modules for new clinics (ADR-0020 amendment, owner decision 2026-10-09):
-- platform settings the create-clinic form pre-fills; the super admin may change them per clinic,
-- and the create request always carries the values it keeps, so the server never picks them.

-- The bounds are the contract's (CLINIC_LIMIT_BOUNDS): a default is always a valid create. One
-- boolean column per module (PRD §4.8: `patients` only in the MVP); the API shows them as one module
-- map (`defaultModules`), typed from the contract's module list. A new module adds its column here
-- with its seed, the same way it widens clinic_features' CHECK. The DEFAULTs exist only to seed the
-- one existing row with today's values (10 users, 3 branches, patients on) and are dropped right
-- after, so every later write names its values.
ALTER TABLE platform_settings
  ADD COLUMN default_max_users integer NOT NULL DEFAULT 10
    CHECK (default_max_users BETWEEN 1 AND 1000),
  ADD COLUMN default_max_branches integer NOT NULL DEFAULT 3
    CHECK (default_max_branches BETWEEN 1 AND 100),
  ADD COLUMN default_module_patients boolean NOT NULL DEFAULT true;

ALTER TABLE platform_settings
  ALTER COLUMN default_max_users DROP DEFAULT,
  ALTER COLUMN default_max_branches DROP DEFAULT,
  ALTER COLUMN default_module_patients DROP DEFAULT;

-- 0036 grants UPDATE on a column list, so the platform role needs the new columns named. eyadex_app
-- already reads the whole row (table-level SELECT) and gets nothing more; no other role gets anything.
GRANT UPDATE (default_max_users, default_max_branches, default_module_patients)
  ON platform_settings TO eyadex_platform;
