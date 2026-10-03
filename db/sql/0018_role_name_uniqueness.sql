-- SQL baseline (applied to production 2026-10-03, PostgreSQL 18; compatible with 16).
-- A clinic's role names are unique per language, ignoring case and surrounding spaces, so two
-- roles can never look identical in the role picker (PRD story 46). Deactivated roles keep
-- their names reserved: reactivating one must never collide with a newer role.
CREATE UNIQUE INDEX roles_name_ar_unique ON roles (clinic_id, lower(btrim(name_ar)));
CREATE UNIQUE INDEX roles_name_en_unique ON roles (clinic_id, lower(btrim(name_en)));
