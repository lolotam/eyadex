-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase B slice 3a: the permission catalogue (PRD §4.7) — fixed in code, seeded here, so a new
-- clinic's system roles can link to it. Mirrors PERMISSION_CATALOG in packages/contracts.
-- The ids are fixed literals (no DB default); code looks permissions up by `key`, never by id.
INSERT INTO permissions (id, key, action, resource, scope, module) VALUES
  ('00000000-0000-7000-8000-0000000c0001', 'view:branches:clinic', 'view', 'branches', 'clinic', NULL),
  ('00000000-0000-7000-8000-0000000c0002', 'create:branches:clinic', 'create', 'branches', 'clinic', NULL),
  ('00000000-0000-7000-8000-0000000c0003', 'update:branches:clinic', 'update', 'branches', 'clinic', NULL),
  ('00000000-0000-7000-8000-0000000c0004', 'deactivate:branches:clinic', 'deactivate', 'branches', 'clinic', NULL),
  ('00000000-0000-7000-8000-0000000c0005', 'view:users:clinic', 'view', 'users', 'clinic', NULL),
  ('00000000-0000-7000-8000-0000000c0006', 'create:users:clinic', 'create', 'users', 'clinic', NULL),
  ('00000000-0000-7000-8000-0000000c0007', 'update:users:clinic', 'update', 'users', 'clinic', NULL),
  ('00000000-0000-7000-8000-0000000c0008', 'deactivate:users:clinic', 'deactivate', 'users', 'clinic', NULL),
  ('00000000-0000-7000-8000-0000000c0009', 'view:roles:clinic', 'view', 'roles', 'clinic', NULL),
  ('00000000-0000-7000-8000-0000000c000a', 'create:roles:clinic', 'create', 'roles', 'clinic', NULL),
  ('00000000-0000-7000-8000-0000000c000b', 'update:roles:clinic', 'update', 'roles', 'clinic', NULL),
  ('00000000-0000-7000-8000-0000000c000c', 'deactivate:roles:clinic', 'deactivate', 'roles', 'clinic', NULL),
  ('00000000-0000-7000-8000-0000000c000d', 'view:patients:clinic', 'view', 'patients', 'clinic', 'patients'),
  ('00000000-0000-7000-8000-0000000c000e', 'create:patients:clinic', 'create', 'patients', 'clinic', 'patients'),
  ('00000000-0000-7000-8000-0000000c000f', 'update:patients:clinic', 'update', 'patients', 'clinic', 'patients'),
  ('00000000-0000-7000-8000-0000000c0010', 'deactivate:patients:clinic', 'deactivate', 'patients', 'clinic', 'patients'),
  ('00000000-0000-7000-8000-0000000c0011', 'view:patients:branch', 'view', 'patients', 'branch', 'patients'),
  ('00000000-0000-7000-8000-0000000c0012', 'create:patients:branch', 'create', 'patients', 'branch', 'patients'),
  ('00000000-0000-7000-8000-0000000c0013', 'update:patients:branch', 'update', 'patients', 'branch', 'patients'),
  ('00000000-0000-7000-8000-0000000c0014', 'deactivate:patients:branch', 'deactivate', 'patients', 'branch', 'patients'),
  ('00000000-0000-7000-8000-0000000c0015', 'view:audit_log:clinic', 'view', 'audit_log', 'clinic', NULL),
  ('00000000-0000-7000-8000-0000000c0016', 'view:clinic_settings:clinic', 'view', 'clinic_settings', 'clinic', NULL),
  ('00000000-0000-7000-8000-0000000c0017', 'update:clinic_settings:clinic', 'update', 'clinic_settings', 'clinic', NULL);
