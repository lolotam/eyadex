-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Finance F1, plan Task 5 (spec R1-15, R1-16, R2-5, R2-7, §8c.1 C1 approved 2026-10-15): invoice sends join
-- the patient-notification ledger, a resend is a new row keyed by the client's `send_request_id`, and each
-- send gets a private link whose token is kept as a SHA-256 hash for lookup plus a sealed copy for retries.

-- R2-5: one row per (subject, kind, channel, time) stays the rule for appointment and visit messages, but
-- an invoice may be sent again. The constraint becomes a partial unique index on the same columns; every
-- writer names the index target (ON CONFLICT (…) WHERE subject_type <> 'invoice') instead of the constraint.
ALTER TABLE patient_notifications DROP CONSTRAINT patient_notifications_once;
CREATE UNIQUE INDEX patient_notifications_once
  ON patient_notifications (clinic_id, subject_id, kind, channel, subject_at) NULLS NOT DISTINCT
  WHERE subject_type <> 'invoice';

-- R2-5: the client makes one id per press of «ابعت»; a retry repeats it, a new press makes a new one. The
-- same id twice is one row (the use case returns the first, or refuses another invoice or channel).
ALTER TABLE patient_notifications ADD COLUMN send_request_id uuid NULL;
CREATE UNIQUE INDEX patient_notifications_send_request
  ON patient_notifications (clinic_id, send_request_id) WHERE send_request_id IS NOT NULL;

ALTER TABLE patient_notifications DROP CONSTRAINT patient_notifications_kind_check,
  ADD CONSTRAINT patient_notifications_kind_check CHECK (kind IN ('booked', 'rescheduled', 'cancelled',
    'reminder_day', 'reminder_2h', 'prescription', 'invoice'));
ALTER TABLE patient_notifications DROP CONSTRAINT patient_notifications_subject_type_check,
  ADD CONSTRAINT patient_notifications_subject_type_check
    CHECK (subject_type IN ('appointment', 'visit', 'invoice'));
ALTER TABLE patient_notifications DROP CONSTRAINT patient_notifications_subject_check,
  ADD CONSTRAINT patient_notifications_subject_check CHECK (
    ((kind = 'prescription') = (subject_type = 'visit'))
    AND ((kind = 'invoice') = (subject_type = 'invoice'))
    AND ((subject_type = 'appointment') = (subject_at IS NOT NULL))
    AND ((subject_type = 'invoice') = (send_request_id IS NOT NULL)));
-- R1 rule 15: an invoice voided before the worker sends is skipped, not sent.
ALTER TABLE patient_notifications DROP CONSTRAINT patient_notifications_skip_reason_check,
  ADD CONSTRAINT patient_notifications_skip_reason_check CHECK (skip_reason IN ('setting_off', 'no_email',
    'opted_out', 'not_booked', 'moved', 'whatsapp_disconnected', 'template_missing', 'invoice_void'));

-- R1-16 + C1: one live link per notification; a voided invoice, a rotated seal key, an expiry or a send
-- that proves non-delivery revokes it (revoked_at), never a delete. `token_hash` is SHA-256 of the 32
-- random bytes; `token_sealed` is the same token sealed by the worker with INVOICE_LINK_SEAL_KEY
-- (SecretSealer `v1.` format), read only by eyadex_app and never by the lookup function's owner.
CREATE TABLE invoice_links (
  clinic_id       uuid NOT NULL REFERENCES clinics (id),
  id              uuid NOT NULL,
  invoice_id      uuid NOT NULL,
  notification_id uuid NOT NULL,
  token_hash      bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  token_sealed    text NOT NULL CHECK (token_sealed ~ '^v1\.'),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz NULL,
  created_at      timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, invoice_id) REFERENCES invoices (clinic_id, id),
  FOREIGN KEY (clinic_id, notification_id) REFERENCES patient_notifications (clinic_id, id),
  CONSTRAINT invoice_links_token_hash_unique UNIQUE (token_hash)
);
CREATE UNIQUE INDEX invoice_links_clinic_notification_live ON invoice_links (clinic_id, notification_id)
  WHERE revoked_at IS NULL;
CREATE INDEX invoice_links_clinic_notification_idx ON invoice_links (clinic_id, notification_id);
CREATE INDEX invoice_links_clinic_invoice_idx ON invoice_links (clinic_id, invoice_id);

ALTER TABLE invoice_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_links FORCE ROW LEVEL SECURITY;
CREATE POLICY invoice_links_tenant_isolation ON invoice_links
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON invoice_links TO eyadex_app;
REVOKE ALL ON invoice_links FROM eyadex_platform;

-- R2-7: the public `/i/<token>` route has no clinic yet. It hashes the token and asks this function for the
-- clinic and invoice of a live link, then reads the invoice inside withTenant. The owner role can read the
-- six lookup columns and nothing else (never `token_sealed`); the policy is role-wide on purpose and the
-- function filters on the hash (the 0059 pattern).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_invoice_link_owner') THEN
    CREATE ROLE eyadex_invoice_link_owner NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO eyadex_invoice_link_owner;
GRANT SELECT (clinic_id, id, invoice_id, token_hash, expires_at, revoked_at) ON invoice_links
  TO eyadex_invoice_link_owner;
CREATE POLICY invoice_links_lookup_read ON invoice_links FOR SELECT TO eyadex_invoice_link_owner USING (true);

CREATE FUNCTION invoice_link_lookup(p_hash bytea)
  RETURNS TABLE (clinic_id uuid, invoice_id uuid, link_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT l.clinic_id, l.invoice_id, l.id
  FROM invoice_links l
  WHERE l.token_hash = p_hash AND l.revoked_at IS NULL AND l.expires_at > now()
$$;
ALTER FUNCTION invoice_link_lookup(bytea) OWNER TO eyadex_invoice_link_owner;
REVOKE ALL ON FUNCTION invoice_link_lookup(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invoice_link_lookup(bytea) TO eyadex_app;
