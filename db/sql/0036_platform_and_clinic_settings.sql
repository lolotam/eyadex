-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase B slice 11 (ADR-0020): platform-wide settings, and a clinic's write of its own settings.

-- Story 26. One row, seeded with OD-6 so a read never finds nothing. Global configuration, not a
-- clinic table: it holds no clinic data, so it has no clinic_id and no RLS. The bounds are the
-- contract's; the sender name becomes an email display name, so a control character (a header line
-- break) is refused here too.
CREATE TABLE platform_settings (
  id                       smallint PRIMARY KEY CHECK (id = 1),
  default_trial_days       integer NOT NULL CHECK (default_trial_days BETWEEN 1 AND 90),
  alert_days_before_expiry integer NOT NULL CHECK (alert_days_before_expiry BETWEEN 1 AND 60),
  email_sender_name        text NOT NULL CHECK (
    char_length(email_sender_name) BETWEEN 2 AND 60
    AND email_sender_name = btrim(email_sender_name)
    AND email_sender_name !~ '[[:cntrl:]]'
  ),
  updated_at               timestamptz NOT NULL
);
INSERT INTO platform_settings (id, default_trial_days, alert_days_before_expiry, email_sender_name, updated_at)
  VALUES (1, 14, 7, 'Eyadex', now());

-- The platform reads and changes the values (never the key, never a second row). The clinic role
-- reads them: the expiry banner (/v1/me) and the worker's reminder need the alert window and the name.
GRANT SELECT, UPDATE (default_trial_days, alert_days_before_expiry, email_sender_name, updated_at)
  ON platform_settings TO eyadex_platform;
GRANT SELECT ON platform_settings TO eyadex_app;

-- Story 55: a clinic changes its own names, default language and time zone. Column grants only:
-- status, expiry, limits, slug and specialty stay platform-only. The policy pins the write to the
-- row of the transaction's clinic (the SELECT policy of 0013 already limits what it can see).
GRANT UPDATE (name_ar, name_en, default_language, timezone, updated_at) ON clinics TO eyadex_app;
CREATE POLICY clinics_own_clinic_update ON clinics FOR UPDATE TO eyadex_app
  USING (id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
