-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Finance F2 core (docs/specs/finance-design.md §4.1, §4.2, §4.5, §8d; ADR-0034): the ten payment, refund
-- and cash-closing catalogue keys, the money tables with their patient-carrying foreign keys, and the
-- audit rules that keep finance rows away from the platform.

-- Spec §4.1: the resources `payments`, `refunds` and `cash_closings` — ten keys, ids c0041…c004a in the
-- order PERMISSION_CATALOG emits them (packages/contracts/src/permissions.ts).
ALTER TABLE permissions DROP CONSTRAINT permissions_key_check;
ALTER TABLE permissions ADD CONSTRAINT permissions_key_check CHECK (key ~ '^(view|create|update|deactivate|overbook):(branches|users|roles|patients|audit_log|clinic_settings|appointments|services|schedules|visits|medical|medicines|invoices|discounts|prices|payments|refunds|cash_closings):(clinic|branch|own)$');
INSERT INTO permissions (id, key, action, resource, scope, module) VALUES
  ('00000000-0000-7000-8000-0000000c0041', 'view:payments:clinic', 'view', 'payments', 'clinic', 'finance'),
  ('00000000-0000-7000-8000-0000000c0042', 'view:payments:branch', 'view', 'payments', 'branch', 'finance'),
  ('00000000-0000-7000-8000-0000000c0043', 'create:payments:clinic', 'create', 'payments', 'clinic', 'finance'),
  ('00000000-0000-7000-8000-0000000c0044', 'create:payments:branch', 'create', 'payments', 'branch', 'finance'),
  ('00000000-0000-7000-8000-0000000c0045', 'create:refunds:clinic', 'create', 'refunds', 'clinic', 'finance'),
  ('00000000-0000-7000-8000-0000000c0046', 'create:refunds:branch', 'create', 'refunds', 'branch', 'finance'),
  ('00000000-0000-7000-8000-0000000c0047', 'view:cash_closings:clinic', 'view', 'cash_closings', 'clinic', 'finance'),
  ('00000000-0000-7000-8000-0000000c0048', 'view:cash_closings:branch', 'view', 'cash_closings', 'branch', 'finance'),
  ('00000000-0000-7000-8000-0000000c0049', 'create:cash_closings:clinic', 'create', 'cash_closings', 'clinic', 'finance'),
  ('00000000-0000-7000-8000-0000000c004a', 'create:cash_closings:branch', 'create', 'cash_closings', 'branch', 'finance');

-- Spec §4.2: every money row reaches its parents through composite foreign keys that carry patient_id,
-- so the invoice needs a unique (clinic_id, id, patient_id) to be their target. Payments and refunds also
-- carry the invoice's branch (F2-Q8) and currency, so an invoice's branch, patient or currency cannot
-- change once money names it.
ALTER TABLE invoices ADD CONSTRAINT invoices_id_patient_unique UNIQUE (clinic_id, id, patient_id);
ALTER TABLE invoices ADD CONSTRAINT invoices_money_target_unique
  UNIQUE (clinic_id, id, branch_id, patient_id, currency);

-- Spec §4.2, FIN-11: the four fixed payment methods, each switched on or off by the clinic. A clinic
-- with no row for a method has it enabled, so existing clinics need no backfill.
CREATE TABLE clinic_payment_methods (
  clinic_id  uuid NOT NULL REFERENCES clinics (id),
  id         uuid NOT NULL,
  method     text NOT NULL CHECK (method IN ('cash', 'knet', 'bank_transfer', 'other')),
  enabled    boolean NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  CONSTRAINT clinic_payment_methods_method_unique UNIQUE (clinic_id, method)
);

-- Spec §4.2, R1-8, R1-9: the gap-free receipt and refund numbers per branch, series and clinic-timezone
-- year, taken FOR UPDATE inside the writing transaction (F2-Q13: refunds are numbered too).
CREATE TABLE receipt_sequences (
  clinic_id   uuid NOT NULL REFERENCES clinics (id),
  id          uuid NOT NULL,
  branch_id   uuid NOT NULL,
  series      text NOT NULL CHECK (series IN ('receipt', 'refund')),
  year        smallint NOT NULL CHECK (year BETWEEN 2000 AND 9999),
  next_number integer NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, branch_id) REFERENCES branches (clinic_id, id),
  CONSTRAINT receipt_sequences_branch_series_year_unique UNIQUE (clinic_id, branch_id, series, year)
);

-- Spec §4.2: money in — one receipt, one method, one invoice. The row is append-only, so a correction is
-- a new movement, never an edit (§4.3).
CREATE TABLE payments (
  clinic_id         uuid NOT NULL REFERENCES clinics (id),
  id                uuid NOT NULL,
  branch_id         uuid NOT NULL,
  patient_id        uuid NOT NULL,
  invoice_id        uuid NOT NULL,
  year              smallint NOT NULL CHECK (year BETWEEN 2000 AND 9999),
  receipt_seq       integer NOT NULL CHECK (receipt_seq >= 1),
  receipt_number    text NOT NULL,
  method            text NOT NULL CHECK (method IN ('cash', 'knet', 'bank_transfer', 'other')),
  amount_minor      bigint NOT NULL CHECK (amount_minor > 0),
  currency          char(3) NOT NULL CHECK (currency IN ('KWD', 'BHD', 'OMR', 'SAR', 'AED', 'QAR')),
  currency_exponent smallint NOT NULL CHECK (currency_exponent IN (2, 3)),
  reference         text NULL CHECK (length(reference) BETWEEN 1 AND 60),
  received_at       timestamptz NOT NULL,
  business_date     date NOT NULL,
  cash_seq          bigint NULL CHECK (cash_seq >= 1),
  received_by       uuid NOT NULL,
  created_at        timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, branch_id) REFERENCES branches (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  CONSTRAINT payments_invoice_fkey FOREIGN KEY (clinic_id, invoice_id, branch_id, patient_id, currency)
    REFERENCES invoices (clinic_id, id, branch_id, patient_id, currency),
  CONSTRAINT payments_currency_exponent_match_check
    CHECK (currency_exponent = CASE WHEN currency IN ('KWD', 'BHD', 'OMR') THEN 3 ELSE 2 END),
  CONSTRAINT payments_cash_seq_method_check CHECK ((method = 'cash') = (cash_seq IS NOT NULL)),
  CONSTRAINT payments_receipt_number_unique UNIQUE (clinic_id, receipt_number),
  CONSTRAINT payments_receipt_seq_unique UNIQUE (clinic_id, branch_id, year, receipt_seq),
  CONSTRAINT payments_cash_seq_unique UNIQUE (clinic_id, branch_id, cash_seq),
  CONSTRAINT payments_allocation_target_unique UNIQUE (clinic_id, id, invoice_id, patient_id)
);
CREATE INDEX payments_invoice_idx ON payments (clinic_id, invoice_id, branch_id, patient_id, currency);
CREATE INDEX payments_clinic_patient_idx ON payments (clinic_id, patient_id);
CREATE INDEX payments_clinic_branch_date_idx ON payments (clinic_id, branch_id, business_date);

-- Spec §4.2: money placed on an invoice, funded by exactly one payment or one credit. A payment-funded
-- allocation names its payment's invoice (EY-5.1 (b)); a credit-funded one may go to any invoice of the
-- patient (FIN-13). The credit's foreign key is added in block 8, once patient_credits exists.
CREATE TABLE payment_allocations (
  clinic_id    uuid NOT NULL REFERENCES clinics (id),
  id           uuid NOT NULL,
  invoice_id   uuid NOT NULL,
  patient_id   uuid NOT NULL,
  payment_id   uuid NULL,
  credit_id    uuid NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  CONSTRAINT payment_allocations_clinic_id_invoice_id_patient_id_fkey FOREIGN KEY (clinic_id, invoice_id, patient_id)
    REFERENCES invoices (clinic_id, id, patient_id),
  CONSTRAINT payment_allocations_payment_fkey FOREIGN KEY (clinic_id, payment_id, invoice_id, patient_id)
    REFERENCES payments (clinic_id, id, invoice_id, patient_id),
  CONSTRAINT payment_allocations_source_check CHECK (num_nonnulls(payment_id, credit_id) = 1),
  CONSTRAINT payment_allocations_id_patient_unique UNIQUE (clinic_id, id, patient_id)
);
CREATE INDEX payment_allocations_clinic_invoice_patient_idx ON payment_allocations (clinic_id, invoice_id, patient_id);
CREATE INDEX payment_allocations_payment_idx ON payment_allocations (clinic_id, payment_id, invoice_id, patient_id);
CREATE INDEX payment_allocations_clinic_credit_patient_idx ON payment_allocations (clinic_id, credit_id, patient_id);
CREATE INDEX payment_allocations_clinic_patient_idx ON payment_allocations (clinic_id, patient_id);

-- Spec §4.2, FIN-13: money released from an allocation and owed back to the patient.
CREATE TABLE patient_credits (
  clinic_id            uuid NOT NULL REFERENCES clinics (id),
  id                   uuid NOT NULL,
  patient_id           uuid NOT NULL,
  origin_allocation_id uuid NOT NULL,
  amount_minor         bigint NOT NULL CHECK (amount_minor > 0),
  cause                text NOT NULL CHECK (cause IN ('invoice_edited', 'invoice_voided', 'refund')),
  created_by           uuid NOT NULL,
  created_at           timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  CONSTRAINT patient_credits_clinic_id_origin_allocation_id_patient_id_fkey
    FOREIGN KEY (clinic_id, origin_allocation_id, patient_id) REFERENCES payment_allocations (clinic_id, id, patient_id),
  CONSTRAINT patient_credits_id_patient_unique UNIQUE (clinic_id, id, patient_id)
);
CREATE INDEX patient_credits_clinic_origin_patient_idx ON patient_credits (clinic_id, origin_allocation_id, patient_id);
CREATE INDEX patient_credits_clinic_patient_idx ON patient_credits (clinic_id, patient_id);

-- Spec §4.2: the allocation side of the credit foreign key, added after patient_credits exists, so
-- money can never move between two patients.
ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_clinic_id_credit_id_patient_id_fkey
  FOREIGN KEY (clinic_id, credit_id, patient_id) REFERENCES patient_credits (clinic_id, id, patient_id);

-- Spec §4.2, FIN-14: money out. The original payment is never deleted; a refund is its own movement
-- with its own number (F2-Q13).
CREATE TABLE refunds (
  clinic_id         uuid NOT NULL REFERENCES clinics (id),
  id                uuid NOT NULL,
  branch_id         uuid NOT NULL,
  patient_id        uuid NOT NULL,
  invoice_id        uuid NOT NULL,
  year              smallint NOT NULL CHECK (year BETWEEN 2000 AND 9999),
  refund_seq        integer NOT NULL CHECK (refund_seq >= 1),
  refund_number     text NOT NULL,
  method            text NOT NULL CHECK (method IN ('cash', 'knet', 'bank_transfer', 'other')),
  amount_minor      bigint NOT NULL CHECK (amount_minor > 0),
  currency          char(3) NOT NULL CHECK (currency IN ('KWD', 'BHD', 'OMR', 'SAR', 'AED', 'QAR')),
  currency_exponent smallint NOT NULL CHECK (currency_exponent IN (2, 3)),
  reason            text NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  refunded_at       timestamptz NOT NULL,
  business_date     date NOT NULL,
  cash_seq          bigint NULL CHECK (cash_seq >= 1),
  refunded_by       uuid NOT NULL,
  created_at        timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, branch_id) REFERENCES branches (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  CONSTRAINT refunds_invoice_fkey FOREIGN KEY (clinic_id, invoice_id, branch_id, patient_id, currency)
    REFERENCES invoices (clinic_id, id, branch_id, patient_id, currency),
  CONSTRAINT refunds_currency_exponent_match_check
    CHECK (currency_exponent = CASE WHEN currency IN ('KWD', 'BHD', 'OMR') THEN 3 ELSE 2 END),
  CONSTRAINT refunds_cash_seq_method_check CHECK ((method = 'cash') = (cash_seq IS NOT NULL)),
  CONSTRAINT refunds_refund_number_unique UNIQUE (clinic_id, refund_number),
  CONSTRAINT refunds_refund_seq_unique UNIQUE (clinic_id, branch_id, year, refund_seq),
  CONSTRAINT refunds_cash_seq_unique UNIQUE (clinic_id, branch_id, cash_seq),
  CONSTRAINT refunds_id_patient_unique UNIQUE (clinic_id, id, patient_id)
);
CREATE INDEX refunds_invoice_idx ON refunds (clinic_id, invoice_id, branch_id, patient_id, currency);
CREATE INDEX refunds_clinic_patient_idx ON refunds (clinic_id, patient_id);
CREATE INDEX refunds_clinic_branch_date_idx ON refunds (clinic_id, branch_id, business_date);

-- Spec §4.2: which credits a refund spent; Σ amount = refunds.amount_minor, checked by the use case and
-- re-checked at commit by 0066.
CREATE TABLE refund_sources (
  clinic_id    uuid NOT NULL REFERENCES clinics (id),
  id           uuid NOT NULL,
  refund_id    uuid NOT NULL,
  credit_id    uuid NOT NULL,
  patient_id   uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at   timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  CONSTRAINT refund_sources_clinic_id_refund_id_patient_id_fkey FOREIGN KEY (clinic_id, refund_id, patient_id)
    REFERENCES refunds (clinic_id, id, patient_id),
  CONSTRAINT refund_sources_clinic_id_credit_id_patient_id_fkey FOREIGN KEY (clinic_id, credit_id, patient_id)
    REFERENCES patient_credits (clinic_id, id, patient_id),
  CONSTRAINT refund_sources_refund_credit_unique UNIQUE (clinic_id, refund_id, credit_id)
);
CREATE INDEX refund_sources_clinic_refund_patient_idx ON refund_sources (clinic_id, refund_id, patient_id);
CREATE INDEX refund_sources_clinic_credit_patient_idx ON refund_sources (clinic_id, credit_id, patient_id);
CREATE INDEX refund_sources_clinic_patient_idx ON refund_sources (clinic_id, patient_id);

-- Spec §4.2, FIN-15: the daily cash closing of a branch. The counted and expected amounts are bounded
-- at 10¹⁸ so counted − expected always fits a bigint (PR #89 review); the chain of closings follows
-- previous_closing_id, so a day with no cash still closes (R3-3); a branch closes once a day (F2-Q9);
-- and a count that differs from the expected amount needs a note (F2-Q11).
CREATE TABLE cash_closings (
  clinic_id           uuid NOT NULL REFERENCES clinics (id),
  id                  uuid NOT NULL,
  branch_id           uuid NOT NULL,
  business_date       date NOT NULL,
  from_cash_seq       bigint NOT NULL CHECK (from_cash_seq >= 0),
  to_cash_seq         bigint NOT NULL,
  expected_minor      bigint NOT NULL CHECK (expected_minor BETWEEN -1000000000000000000 AND 1000000000000000000),
  counted_minor       bigint NOT NULL CHECK (counted_minor BETWEEN 0 AND 1000000000000000000),
  difference_minor    bigint GENERATED ALWAYS AS (counted_minor - expected_minor) STORED,
  method_totals       jsonb NOT NULL CHECK (jsonb_typeof(method_totals) = 'array'),
  note                text NULL CHECK (length(note) BETWEEN 1 AND 300),
  previous_closing_id uuid NULL,
  currency            char(3) NOT NULL CHECK (currency IN ('KWD', 'BHD', 'OMR', 'SAR', 'AED', 'QAR')),
  currency_exponent   smallint NOT NULL CHECK (currency_exponent IN (2, 3)),
  closed_by           uuid NOT NULL,
  closed_at           timestamptz NOT NULL,
  created_at          timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, branch_id) REFERENCES branches (clinic_id, id),
  CONSTRAINT cash_closings_period_check CHECK (to_cash_seq >= from_cash_seq),
  CONSTRAINT cash_closings_difference_note_check CHECK (counted_minor = expected_minor OR note IS NOT NULL),
  -- The exponent always follows the currency, as on clinics (0060).
  CONSTRAINT cash_closings_currency_exponent_match_check
    CHECK (currency_exponent = CASE WHEN currency IN ('KWD', 'BHD', 'OMR') THEN 3 ELSE 2 END),
  CONSTRAINT cash_closings_branch_id_unique UNIQUE (clinic_id, branch_id, id),
  CONSTRAINT cash_closings_chain_unique UNIQUE NULLS NOT DISTINCT (clinic_id, branch_id, previous_closing_id),
  CONSTRAINT cash_closings_business_date_unique UNIQUE (clinic_id, branch_id, business_date)
);
ALTER TABLE cash_closings ADD CONSTRAINT cash_closings_clinic_id_branch_id_previous_closing_id_fkey
  FOREIGN KEY (clinic_id, branch_id, previous_closing_id) REFERENCES cash_closings (clinic_id, branch_id, id);
CREATE INDEX cash_closings_clinic_branch_closed_idx ON cash_closings (clinic_id, branch_id, closed_at);

-- Spec §4.2, §4.4: the branch's cash counter. Every cash movement takes the next cash_seq from this row
-- under FOR UPDATE, so a cash movement is in exactly one closing.
CREATE TABLE branch_cash_drawers (
  clinic_id       uuid NOT NULL REFERENCES clinics (id),
  id              uuid NOT NULL,
  branch_id       uuid NOT NULL,
  last_cash_seq   bigint NOT NULL CHECK (last_cash_seq >= 0),
  last_closed_seq bigint NOT NULL CHECK (last_closed_seq >= 0),
  last_closing_id uuid NULL,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, branch_id) REFERENCES branches (clinic_id, id),
  CONSTRAINT branch_cash_drawers_clinic_id_branch_id_last_closing_id_fkey
    FOREIGN KEY (clinic_id, branch_id, last_closing_id) REFERENCES cash_closings (clinic_id, branch_id, id),
  CONSTRAINT branch_cash_drawers_closed_check CHECK (last_closed_seq <= last_cash_seq),
  CONSTRAINT branch_cash_drawers_first_closing_check CHECK (last_closing_id IS NOT NULL OR last_closed_seq = 0),
  CONSTRAINT branch_cash_drawers_branch_unique UNIQUE (clinic_id, branch_id)
);
CREATE INDEX branch_cash_drawers_clinic_branch_closing_idx ON branch_cash_drawers (clinic_id, branch_id, last_closing_id);

-- Spec §4.2: RLS enabled and forced on every clinic table, with the standard policy — no clinic context
-- means no rows, never an error.
ALTER TABLE clinic_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_payment_methods FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_payment_methods_tenant_isolation ON clinic_payment_methods
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE receipt_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_sequences FORCE ROW LEVEL SECURITY;
CREATE POLICY receipt_sequences_tenant_isolation ON receipt_sequences
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY payments_tenant_isolation ON payments
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_allocations_tenant_isolation ON payment_allocations
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE patient_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_credits FORCE ROW LEVEL SECURITY;
CREATE POLICY patient_credits_tenant_isolation ON patient_credits
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY refunds_tenant_isolation ON refunds
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE refund_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY refund_sources_tenant_isolation ON refund_sources
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE cash_closings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_closings FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_closings_tenant_isolation ON cash_closings
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE branch_cash_drawers ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_cash_drawers FORCE ROW LEVEL SECURITY;
CREATE POLICY branch_cash_drawers_tenant_isolation ON branch_cash_drawers
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- Spec §4.2: money rows are append-only, so they get SELECT and INSERT only; only the counters and the
-- settings row change. The platform reads finance as totals only (FIN-3), so it gets no privilege here.
-- Only the counters and the switch change; a row never moves to another clinic, branch, series, year or method (PR #92 review).
GRANT SELECT, INSERT ON payments, payment_allocations, patient_credits, refunds, refund_sources, cash_closings
  TO eyadex_app;
GRANT SELECT, INSERT ON clinic_payment_methods, receipt_sequences, branch_cash_drawers TO eyadex_app;
GRANT UPDATE (enabled, updated_at) ON clinic_payment_methods TO eyadex_app;
GRANT UPDATE (next_number, updated_at) ON receipt_sequences TO eyadex_app;
GRANT UPDATE (last_cash_seq, last_closed_seq, last_closing_id, updated_at) ON branch_cash_drawers TO eyadex_app;
REVOKE ALL ON clinic_payment_methods, receipt_sequences, payments, payment_allocations, patient_credits, refunds,
  refund_sources, cash_closings, branch_cash_drawers FROM eyadex_platform;

-- Spec §4.2, FIN-3, F2-Q19: a payment, a refund and a credit name a patient, so they are patient access
-- and the platform never sees them; a closing names no patient but is finance, and the platform sees
-- finance only as totals, so it is hidden too; the payment methods stay visible, like other clinic
-- settings, because they name no patient.
ALTER TABLE audit_log DROP CONSTRAINT audit_log_patient_events_are_patient_access;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_patient_events_are_patient_access
  CHECK (entity_type NOT IN ('patient', 'visit', 'visit_addendum', 'diagnosis', 'prescription',
    'medical_profile', 'attachment', 'invoice', 'invoice_link', 'payment', 'refund', 'patient_credit')
    OR category = 'patient_access');

CREATE OR REPLACE VIEW platform_clinic_admin_audit WITH (security_barrier = true) AS
  SELECT clinic_id, id, actor_user_id, action, entity_type, entity_id, branch_id, details, created_at
  FROM audit_log
  WHERE category = 'administrative'
    AND entity_type NOT IN ('patient', 'appointment', 'visit', 'visit_addendum', 'diagnosis',
      'prescription', 'medical_profile', 'attachment', 'medicine', 'invoice', 'invoice_link', 'payment',
      'refund', 'patient_credit', 'cash_closing');

ALTER POLICY audit_log_platform_admin_rows ON audit_log
  USING (category = 'administrative'
    AND entity_type NOT IN ('patient', 'appointment', 'visit', 'visit_addendum', 'diagnosis',
      'prescription', 'medical_profile', 'attachment', 'medicine', 'invoice', 'invoice_link', 'payment',
      'refund', 'patient_credit', 'cash_closing'));
ALTER POLICY audit_log_platform_admin_insert ON audit_log
  WITH CHECK (
    category = 'administrative'
    AND entity_type NOT IN ('patient', 'appointment', 'visit', 'visit_addendum', 'diagnosis',
      'prescription', 'medical_profile', 'attachment', 'medicine', 'invoice', 'invoice_link', 'payment',
      'refund', 'patient_credit', 'cash_closing')
    AND clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
