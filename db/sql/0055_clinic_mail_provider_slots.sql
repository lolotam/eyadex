-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase 3 N1 (docs/specs/notifications-design.md §2, owner decision N-3): a clinic keeps a primary and an
-- optional fallback mail provider. Patient messages try the primary, then the fallback; invitation emails
-- keep the primary route only (spec §8).

-- Every existing row is the clinic's one provider, so it becomes the primary. The default stays: an API
-- that does not name the slot yet keeps writing the primary row.
ALTER TABLE clinic_mail_providers ADD COLUMN slot text NOT NULL DEFAULT 'primary'
  CONSTRAINT clinic_mail_providers_slot_check CHECK (slot IN ('primary', 'fallback'));

-- One provider per slot instead of one per clinic. The new constraint is created first, so the clinic_id
-- foreign key and the RLS predicate always have an index that starts with clinic_id.
ALTER TABLE clinic_mail_providers
  ADD CONSTRAINT clinic_mail_providers_one_per_slot UNIQUE (clinic_id, slot);
ALTER TABLE clinic_mail_providers DROP CONSTRAINT clinic_mail_providers_one_per_clinic;

-- No grant change: eyadex_app keeps 0030's privileges (table-level, so they cover the new column) and no
-- other runtime role has any.
