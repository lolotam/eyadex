-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Phase B slice 6 (ADR-0011): branch contact details and the clinic idempotency ledger.

-- PRD §4.6: a branch has an address and a phone. Both optional; existing rows stay NULL.
-- eyadex_app already holds SELECT, INSERT, UPDATE on branches (0013) and no DELETE.
ALTER TABLE branches ADD COLUMN address text NULL;
ALTER TABLE branches ADD COLUMN phone text NULL;

-- Clinic use cases claim their Idempotency-Key here, not in idempotency_keys (0025): that
-- ledger has no clinic column, so a grant to eyadex_app would let one clinic read another's
-- stored responses. This one is a clinic table like every other: forced RLS on clinic_id.
-- `response` holds identifiers only — never a token or a secret.
-- TODO(spec): retention of old keys (a worker sweep) is not decided yet (same as 0025).
CREATE TABLE clinic_idempotency_keys (
  clinic_id    uuid NOT NULL REFERENCES clinics (id),
  id           uuid NOT NULL,
  scope        text NOT NULL CHECK (scope <> ''),
  key          text NOT NULL CHECK (length(key) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response     jsonb NULL,
  created_at   timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  CONSTRAINT clinic_idempotency_keys_scope_key UNIQUE (clinic_id, scope, key)
);

ALTER TABLE clinic_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_idempotency_keys_tenant_isolation ON clinic_idempotency_keys
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- No delete, and only the stored response can change after the claim.
GRANT SELECT, INSERT, UPDATE (response) ON clinic_idempotency_keys TO eyadex_app;
