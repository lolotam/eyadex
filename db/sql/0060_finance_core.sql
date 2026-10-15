-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Finance F1 core (docs/specs/finance-design.md §3, R1, R2; plan Task 3): the `finance` module flag, its
-- thirteen catalogue keys, the clinic's currency and tax, branch invoice prefixes, service and doctor
-- prices, gap-free invoice numbers, invoices and their lines. No role gains a key and no clinic or
-- default switches the module on here: the release migration (0063) does that (R2-4).

-- Spec §2: a module the platform switches per clinic; a module with no row is off (ADR-0010).
ALTER TABLE clinic_features DROP CONSTRAINT clinic_features_module_check;
ALTER TABLE clinic_features ADD CONSTRAINT clinic_features_module_check
  CHECK (module IN ('patients', 'appointments', 'medical', 'finance'));

-- The new-clinic default, off (same recipe as 0046: seeded, NOT NULL, no DEFAULT left behind).
ALTER TABLE platform_settings ADD COLUMN default_module_finance boolean NOT NULL DEFAULT false;
ALTER TABLE platform_settings ALTER COLUMN default_module_finance DROP DEFAULT;
GRANT UPDATE (default_module_finance) ON platform_settings TO eyadex_platform;

-- Spec §3.1, §8c.3: the resources `invoices`, `discounts`, `prices` — 13 keys. The rows mirror
-- PERMISSION_CATALOG (packages/contracts) in its order; code looks keys up by key.
ALTER TABLE permissions DROP CONSTRAINT permissions_key_check;
ALTER TABLE permissions ADD CONSTRAINT permissions_key_check CHECK (key ~ '^(view|create|update|deactivate|overbook):(branches|users|roles|patients|audit_log|clinic_settings|appointments|services|schedules|visits|medical|medicines|invoices|discounts|prices):(clinic|branch|own)$');
ALTER TABLE permissions DROP CONSTRAINT permissions_module_check;
ALTER TABLE permissions ADD CONSTRAINT permissions_module_check
  CHECK (module IN ('patients', 'appointments', 'medical', 'finance'));
INSERT INTO permissions (id, key, action, resource, scope, module) VALUES
  ('00000000-0000-7000-8000-0000000c0034', 'view:invoices:clinic', 'view', 'invoices', 'clinic', 'finance'),
  ('00000000-0000-7000-8000-0000000c0035', 'view:invoices:branch', 'view', 'invoices', 'branch', 'finance'),
  ('00000000-0000-7000-8000-0000000c0036', 'view:invoices:own', 'view', 'invoices', 'own', 'finance'),
  ('00000000-0000-7000-8000-0000000c0037', 'create:invoices:clinic', 'create', 'invoices', 'clinic', 'finance'),
  ('00000000-0000-7000-8000-0000000c0038', 'create:invoices:branch', 'create', 'invoices', 'branch', 'finance'),
  ('00000000-0000-7000-8000-0000000c0039', 'update:invoices:clinic', 'update', 'invoices', 'clinic', 'finance'),
  ('00000000-0000-7000-8000-0000000c003a', 'update:invoices:branch', 'update', 'invoices', 'branch', 'finance'),
  ('00000000-0000-7000-8000-0000000c003b', 'deactivate:invoices:clinic', 'deactivate', 'invoices', 'clinic', 'finance'),
  ('00000000-0000-7000-8000-0000000c003c', 'deactivate:invoices:branch', 'deactivate', 'invoices', 'branch', 'finance'),
  ('00000000-0000-7000-8000-0000000c003d', 'create:discounts:clinic', 'create', 'discounts', 'clinic', 'finance'),
  ('00000000-0000-7000-8000-0000000c003e', 'create:discounts:branch', 'create', 'discounts', 'branch', 'finance'),
  ('00000000-0000-7000-8000-0000000c003f', 'view:prices:clinic', 'view', 'prices', 'clinic', 'finance'),
  ('00000000-0000-7000-8000-0000000c0040', 'update:prices:clinic', 'update', 'prices', 'clinic', 'finance');

-- FIN-A3, R2-3: one currency per clinic with its minor-unit exponent, and a clinic-wide tax rate in basis
-- points. Appended with defaults, so existing clinics get KWD / 3 / 0 % and positional inserts still work.
-- The currency changes only through finance_set_currency (0061), which refuses once a price or an invoice
-- exists.
ALTER TABLE clinics
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'KWD'
    CONSTRAINT clinics_currency_check CHECK (currency IN ('KWD', 'BHD', 'OMR', 'SAR', 'AED', 'QAR')),
  ADD COLUMN currency_exponent smallint NOT NULL DEFAULT 3,
  ADD COLUMN tax_rate_bp integer NOT NULL DEFAULT 0
    CONSTRAINT clinics_tax_rate_bp_check CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  ADD COLUMN commercial_reg_no text NULL
    CONSTRAINT clinics_commercial_reg_no_check CHECK (length(commercial_reg_no) <= 40),
  ADD COLUMN logo_blob_key text NULL,
  -- The exponent always follows the currency (money.ts SUPPORTED_CURRENCIES).
  ADD CONSTRAINT clinics_currency_exponent_check CHECK (currency_exponent =
    CASE WHEN currency IN ('KWD', 'BHD', 'OMR') THEN 3 ELSE 2 END);

-- Spec §3.2, R1-9: a branch's invoice prefix; it locks after the branch's first invoice, and a prefix used
-- once in a clinic never goes to another branch (the use case writes both rows in one transaction).
ALTER TABLE branches ADD COLUMN invoice_prefix text NULL
  CONSTRAINT branches_invoice_prefix_check CHECK (invoice_prefix ~ '^[A-Z0-9]{2,6}$');
CREATE UNIQUE INDEX branches_clinic_invoice_prefix_unique ON branches (clinic_id, invoice_prefix)
  WHERE invoice_prefix IS NOT NULL;

CREATE TABLE used_invoice_prefixes (
  clinic_id  uuid NOT NULL REFERENCES clinics (id),
  id         uuid NOT NULL,
  prefix     text NOT NULL CHECK (prefix ~ '^[A-Z0-9]{2,6}$'),
  branch_id  uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, branch_id) REFERENCES branches (clinic_id, id),
  CONSTRAINT used_invoice_prefixes_prefix_unique UNIQUE (clinic_id, prefix)
);
CREATE INDEX used_invoice_prefixes_clinic_branch_idx ON used_invoice_prefixes (clinic_id, branch_id);

-- FIN-A8: a base price per service (NULL = no price yet). One line is capped at 10¹² minor units (R1-2).
ALTER TABLE clinic_services ADD COLUMN price_minor bigint NULL
  CONSTRAINT clinic_services_price_minor_check CHECK (price_minor BETWEEN 0 AND 1000000000000);

-- FIN-A8: a doctor's own price for a service, which wins over the base price. The list is configuration
-- replaced as a whole (PUT), so rows are deleted and written again, like provider_schedules (0042).
CREATE TABLE service_provider_prices (
  clinic_id   uuid NOT NULL REFERENCES clinics (id),
  id          uuid NOT NULL,
  service_id  uuid NOT NULL,
  member_id   uuid NOT NULL,
  price_minor bigint NOT NULL CHECK (price_minor BETWEEN 0 AND 1000000000000),
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, service_id) REFERENCES clinic_services (clinic_id, id),
  FOREIGN KEY (clinic_id, member_id) REFERENCES memberships (clinic_id, id),
  CONSTRAINT service_provider_prices_unique UNIQUE (clinic_id, service_id, member_id)
);
CREATE INDEX service_provider_prices_clinic_member_idx ON service_provider_prices (clinic_id, member_id);

-- R1-8: gap-free numbers per branch and clinic-timezone year, taken FOR UPDATE inside the issuing
-- transaction.
CREATE TABLE invoice_sequences (
  clinic_id   uuid NOT NULL REFERENCES clinics (id),
  id          uuid NOT NULL,
  branch_id   uuid NOT NULL,
  year        smallint NOT NULL CHECK (year BETWEEN 2000 AND 9999),
  next_number integer NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, branch_id) REFERENCES branches (clinic_id, id),
  CONSTRAINT invoice_sequences_branch_year_unique UNIQUE (clinic_id, branch_id, year)
);

-- Spec §3.2, R1-10: an invoice is never deleted; a void keeps its row, number and lines. Amounts are
-- bigint minor units; aggregates are bounded by the type (R1-2). `created_by` is a membership id with no
-- foreign key, like appointments.created_by (0043). `source_id` names an appointment or a visit by kind,
-- so it has no foreign key either; the use case checks it.
CREATE TABLE invoices (
  clinic_id         uuid NOT NULL REFERENCES clinics (id),
  id                uuid NOT NULL,
  branch_id         uuid NOT NULL,
  patient_id        uuid NOT NULL,
  year              smallint NOT NULL CHECK (year BETWEEN 2000 AND 9999),
  number_seq        integer NOT NULL CHECK (number_seq >= 1),
  number            text NOT NULL,
  status            text NOT NULL CHECK (status IN ('issued', 'void')),
  source            text NOT NULL CHECK (source IN ('appointment', 'visit', 'manual')),
  source_id         uuid NULL,
  issued_at         timestamptz NOT NULL,
  currency          char(3) NOT NULL CHECK (currency IN ('KWD', 'BHD', 'OMR', 'SAR', 'AED', 'QAR')),
  currency_exponent smallint NOT NULL CHECK (currency_exponent IN (2, 3)),
  subtotal_minor    bigint NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor    bigint NOT NULL CHECK (discount_minor >= 0),
  tax_rate_bp       integer NOT NULL CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  tax_minor         bigint NOT NULL CHECK (tax_minor >= 0),
  total_minor       bigint NOT NULL CHECK (total_minor >= 0),
  invoice_discount  jsonb NULL,
  void_reason       text NULL CHECK (length(void_reason) BETWEEN 1 AND 300),
  voided_at         timestamptz NULL,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, branch_id) REFERENCES branches (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  CONSTRAINT invoices_number_unique UNIQUE (clinic_id, number),
  CONSTRAINT invoices_source_id_check CHECK ((source = 'manual') = (source_id IS NULL)),
  CONSTRAINT invoices_void_check
    CHECK ((status = 'void') = (voided_at IS NOT NULL AND void_reason IS NOT NULL)
      AND (voided_at IS NULL) = (void_reason IS NULL))
);
-- Spec §3.2: at most one live invoice per appointment or visit, so the «فاتورة» button cannot bill twice.
CREATE UNIQUE INDEX invoices_clinic_source_live ON invoices (clinic_id, source, source_id)
  WHERE status <> 'void';
CREATE INDEX invoices_clinic_branch_issued_idx ON invoices (clinic_id, branch_id, issued_at);
CREATE INDEX invoices_clinic_patient_idx ON invoices (clinic_id, patient_id);

-- Spec §3.2, FIN-A5: an issued invoice's lines stay editable. A line removed by an edit is archived, not
-- deleted (no DELETE anywhere), and archiving frees its position — the visit_diagnoses pattern (0047).
-- `provider_id` is the doctor of a service line (a membership).
CREATE TABLE invoice_lines (
  clinic_id        uuid NOT NULL REFERENCES clinics (id),
  id               uuid NOT NULL,
  invoice_id       uuid NOT NULL,
  position         smallint NOT NULL CHECK (position BETWEEN 0 AND 49),
  kind             text NOT NULL CHECK (kind IN ('service', 'free')),
  service_id       uuid NULL,
  provider_id      uuid NULL,
  description_ar   text NOT NULL CHECK (length(description_ar) BETWEEN 1 AND 200),
  description_en   text NOT NULL CHECK (length(description_en) BETWEEN 1 AND 200),
  quantity         smallint NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor BETWEEN 0 AND 1000000000000),
  line_discount    jsonb NULL,
  line_total_minor bigint NOT NULL CHECK (line_total_minor BETWEEN 0 AND 1000000000000),
  archived_at      timestamptz NULL,
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, invoice_id) REFERENCES invoices (clinic_id, id),
  FOREIGN KEY (clinic_id, service_id) REFERENCES clinic_services (clinic_id, id),
  FOREIGN KEY (clinic_id, provider_id) REFERENCES memberships (clinic_id, id),
  CONSTRAINT invoice_lines_service_check CHECK ((kind = 'service') = (service_id IS NOT NULL))
);
CREATE UNIQUE INDEX invoice_lines_clinic_invoice_position_active
  ON invoice_lines (clinic_id, invoice_id, position) WHERE archived_at IS NULL;
CREATE INDEX invoice_lines_clinic_invoice_idx ON invoice_lines (clinic_id, invoice_id, position);
CREATE INDEX invoice_lines_clinic_service_idx ON invoice_lines (clinic_id, service_id);
CREATE INDEX invoice_lines_clinic_provider_idx ON invoice_lines (clinic_id, provider_id);

ALTER TABLE used_invoice_prefixes ENABLE ROW LEVEL SECURITY;
ALTER TABLE used_invoice_prefixes FORCE ROW LEVEL SECURITY;
CREATE POLICY used_invoice_prefixes_tenant_isolation ON used_invoice_prefixes
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE service_provider_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_provider_prices FORCE ROW LEVEL SECURITY;
CREATE POLICY service_provider_prices_tenant_isolation ON service_provider_prices
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_sequences FORCE ROW LEVEL SECURITY;
CREATE POLICY invoice_sequences_tenant_isolation ON invoice_sequences
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY invoices_tenant_isolation ON invoices
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY invoice_lines_tenant_isolation ON invoice_lines
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- The clinic runtime role only. Invoices and their lines are never deleted (a void keeps them, a removed
-- line is archived); a used prefix is history; only the doctor price list is replaced. The platform has
-- no privilege on any finance table: it reads monthly totals only through finance_monthly_totals (0061).
GRANT SELECT, INSERT, UPDATE ON invoice_sequences, invoices, invoice_lines TO eyadex_app;
GRANT SELECT, INSERT ON used_invoice_prefixes TO eyadex_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_provider_prices TO eyadex_app;
REVOKE ALL ON used_invoice_prefixes, service_provider_prices, invoice_sequences, invoices, invoice_lines
  FROM eyadex_platform;

-- Spec §8 R1 rule 3: every finance audit row names a patient's invoice, so it is patient access and the
-- platform never sees it — the same treatment as the medical entities (0046, 0051).
ALTER TABLE audit_log DROP CONSTRAINT audit_log_patient_events_are_patient_access;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_patient_events_are_patient_access
  CHECK (entity_type NOT IN ('patient', 'visit', 'visit_addendum', 'diagnosis', 'prescription',
    'medical_profile', 'attachment', 'invoice', 'invoice_link') OR category = 'patient_access');

CREATE OR REPLACE VIEW platform_clinic_admin_audit WITH (security_barrier = true) AS
  SELECT clinic_id, id, actor_user_id, action, entity_type, entity_id, branch_id, details, created_at
  FROM audit_log
  WHERE category = 'administrative'
    AND entity_type NOT IN ('patient', 'appointment', 'visit', 'visit_addendum', 'diagnosis',
      'prescription', 'medical_profile', 'attachment', 'medicine', 'invoice', 'invoice_link');

ALTER POLICY audit_log_platform_admin_rows ON audit_log
  USING (category = 'administrative'
    AND entity_type NOT IN ('patient', 'appointment', 'visit', 'visit_addendum', 'diagnosis',
      'prescription', 'medical_profile', 'attachment', 'medicine', 'invoice', 'invoice_link'));
ALTER POLICY audit_log_platform_admin_insert ON audit_log
  WITH CHECK (
    category = 'administrative'
    AND entity_type NOT IN ('patient', 'appointment', 'visit', 'visit_addendum', 'diagnosis',
      'prescription', 'medical_profile', 'attachment', 'medicine', 'invoice', 'invoice_link')
    AND clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );
