-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Finance F3 reports core (docs/specs/finance-f3-reports-design.md §3, §5, §7.3, §7.4, §8;
-- docs/specs/finance-f3-export-pipeline.md §8): the seven report keys, the export tables, the audit rules
-- for an export, the expand columns of the stored business days, and the report view and functions.

-- Spec §3, EY-10.1: four report resources, one view key per report group — seven keys, ids c004b…c0051 in
-- the order PERMISSION_CATALOG emits them (packages/contracts/src/permissions.ts).
ALTER TABLE permissions DROP CONSTRAINT permissions_key_check;
ALTER TABLE permissions ADD CONSTRAINT permissions_key_check CHECK (key ~ '^(view|create|update|deactivate|overbook):(branches|users|roles|patients|audit_log|clinic_settings|appointments|services|schedules|visits|medical|medicines|invoices|discounts|prices|payments|refunds|cash_closings|report_takings|report_analytics|report_patients|report_own):(clinic|branch|own)$');
INSERT INTO permissions (id, key, action, resource, scope, module) VALUES
  ('00000000-0000-7000-8000-0000000c004b', 'view:report_takings:clinic', 'view', 'report_takings', 'clinic', 'finance'),
  ('00000000-0000-7000-8000-0000000c004c', 'view:report_takings:branch', 'view', 'report_takings', 'branch', 'finance'),
  ('00000000-0000-7000-8000-0000000c004d', 'view:report_analytics:clinic', 'view', 'report_analytics', 'clinic', 'finance'),
  ('00000000-0000-7000-8000-0000000c004e', 'view:report_analytics:branch', 'view', 'report_analytics', 'branch', 'finance'),
  ('00000000-0000-7000-8000-0000000c004f', 'view:report_patients:clinic', 'view', 'report_patients', 'clinic', 'finance'),
  ('00000000-0000-7000-8000-0000000c0050', 'view:report_patients:branch', 'view', 'report_patients', 'branch', 'finance'),
  ('00000000-0000-7000-8000-0000000c0051', 'view:report_own:own', 'view', 'report_own', 'own', 'finance');

-- Spec §6, §8 (expand step), F3-Q1 a, EY-10.5: the stored business days, nullable until the writers fill
-- them and the backfills are verified; the contract step (0072) adds NOT NULL and their indexes.
ALTER TABLE invoices ADD COLUMN business_date date NULL;
ALTER TABLE payment_allocations ADD COLUMN business_date date NULL;

-- Spec §4 (R8), EY-10.2: who set a discount is stored, never derived from created_by or the audit log; a
-- membership id with no FK, like payments.received_by. A discount set before the column existed stays NULL.
ALTER TABLE invoice_lines ADD COLUMN discounted_by uuid NULL;
ALTER TABLE invoices ADD COLUMN discounted_by uuid NULL;

-- Spec §7.3, pipeline §8.1: one row per export request; the worker moves its status, lease and file
-- fields. The row is never deleted (CLAUDE.md §5): an expired or purged export stays for the audit trail.
CREATE TABLE finance_report_exports (
  clinic_id       uuid NOT NULL REFERENCES clinics (id),
  id              uuid NOT NULL,
  requested_by    uuid NOT NULL,
  report          text NOT NULL CHECK (report IN ('daily_takings', 'period_summary', 'by_service', 'by_doctor',
    'outstanding', 'patient_credit', 'refunds', 'discounts', 'cash_closings', 'own_summary')),
  params          jsonb NOT NULL CHECK (jsonb_typeof(params) = 'object'),
  format          text NOT NULL CHECK (format IN ('csv', 'xlsx')),
  scope           text NOT NULL CHECK (scope IN ('clinic', 'branch', 'own')),
  patient_ids     uuid[] NULL,
  status          text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'done', 'failed', 'expired', 'purged')),
  attempt         integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  lease_owner     text NULL,
  lease_until     timestamptz NULL,
  next_attempt_at timestamptz NULL,
  storage_key     text NULL
    CHECK (storage_key ~ '^clinic/[0-9a-f-]{36}/finance-exports/[0-9a-f-]{36}/[0-9]+\.(csv|xlsx)$'),
  byte_size       integer NULL CHECK (byte_size > 0),
  row_count       integer NULL CHECK (row_count >= 0),
  error_code      text NULL,
  created_at      timestamptz NOT NULL,
  started_at      timestamptz NULL,
  finished_at     timestamptz NULL,
  expires_at      timestamptz NULL,
  PRIMARY KEY (clinic_id, id),
  -- EY-10.6: only an own export stores the patients it holds, so the download can re-check them.
  CONSTRAINT finance_report_exports_patient_ids_own_check CHECK (patient_ids IS NULL OR scope = 'own')
);
CREATE INDEX finance_report_exports_requester_idx ON finance_report_exports (clinic_id, requested_by, created_at);
-- Pipeline §2 step 3: at most one running export per member, held by the database at the lease.
CREATE UNIQUE INDEX finance_report_exports_one_running_idx ON finance_report_exports (clinic_id, requested_by)
  WHERE status = 'running';
CREATE INDEX finance_report_exports_expiry_idx ON finance_report_exports (clinic_id, status, expires_at);

-- Pipeline §6, §8.2: one row per blob key ever allocated, written before the upload, so the sweeper can
-- delete every key, a lost or partial upload included. The rows are the trail and are never deleted.
CREATE TABLE finance_report_export_blobs (
  clinic_id   uuid NOT NULL REFERENCES clinics (id),
  id          uuid NOT NULL,
  export_id   uuid NOT NULL,
  attempt     integer NOT NULL CHECK (attempt >= 1),
  storage_key text NOT NULL
    CHECK (storage_key ~ '^clinic/[0-9a-f-]{36}/finance-exports/[0-9a-f-]{36}/[0-9]+\.(csv|xlsx)$'),
  state       text NOT NULL CHECK (state IN ('allocated', 'uploaded', 'published', 'deleted', 'gone')),
  deleted_at  timestamptz NULL,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, id),
  FOREIGN KEY (clinic_id, export_id) REFERENCES finance_report_exports (clinic_id, id),
  CONSTRAINT finance_report_export_blobs_attempt_unique UNIQUE (clinic_id, export_id, attempt),
  CONSTRAINT finance_report_export_blobs_deleted_at_check
    CHECK ((deleted_at IS NOT NULL) = (state IN ('deleted', 'gone')))
);
CREATE INDEX finance_report_export_blobs_sweep_idx ON finance_report_export_blobs (clinic_id, state, updated_at);

-- CLAUDE.md §5: RLS enabled and forced; no clinic context means zero rows, never an error.
ALTER TABLE finance_report_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_report_exports FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_report_exports_tenant_isolation ON finance_report_exports
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
ALTER TABLE finance_report_export_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_report_export_blobs FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_report_export_blobs_tenant_isolation ON finance_report_export_blobs
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- Pipeline §8.1, §8.2: column-level UPDATE, no DELETE; the platform and the other runtime roles get nothing.
GRANT SELECT, INSERT ON finance_report_exports, finance_report_export_blobs TO eyadex_app;
GRANT UPDATE (status, attempt, lease_owner, lease_until, next_attempt_at, storage_key, byte_size, row_count,
  error_code, started_at, finished_at, expires_at, patient_ids) ON finance_report_exports TO eyadex_app;
GRANT UPDATE (state, updated_at, deleted_at) ON finance_report_export_blobs TO eyadex_app;
REVOKE ALL ON finance_report_exports, finance_report_export_blobs FROM eyadex_platform, eyadex_auth, eyadex_dispatcher;

-- Spec §7.4, EY-9.15 a: an export of R5–R8 holds patient names, so its audit row is patient access; the
-- other reports' exports are administrative. Either way the platform never sees an export row (FIN-3).
ALTER TABLE audit_log ADD CONSTRAINT audit_log_patient_report_exports_are_patient_access
  CHECK (entity_type <> 'finance_report_export'
    OR details ->> 'report' NOT IN ('outstanding', 'patient_credit', 'refunds', 'discounts')
    OR category = 'patient_access');

CREATE OR REPLACE VIEW platform_clinic_admin_audit WITH (security_barrier = true) AS
  SELECT clinic_id, id, actor_user_id, action, entity_type, entity_id, branch_id, details, created_at
  FROM audit_log
  WHERE category = 'administrative'
    AND entity_type NOT IN ('patient', 'appointment', 'visit', 'visit_addendum', 'diagnosis',
      'prescription', 'medical_profile', 'attachment', 'medicine', 'invoice', 'invoice_link', 'payment',
      'refund', 'patient_credit', 'cash_closing', 'finance_report_export');

ALTER POLICY audit_log_platform_admin_rows ON audit_log
  USING (category = 'administrative'
    AND entity_type NOT IN ('patient', 'appointment', 'visit', 'visit_addendum', 'diagnosis',
      'prescription', 'medical_profile', 'attachment', 'medicine', 'invoice', 'invoice_link', 'payment',
      'refund', 'patient_credit', 'cash_closing', 'finance_report_export'));
ALTER POLICY audit_log_platform_admin_insert ON audit_log
  WITH CHECK (
    category = 'administrative'
    AND entity_type NOT IN ('patient', 'appointment', 'visit', 'visit_addendum', 'diagnosis',
      'prescription', 'medical_profile', 'attachment', 'medicine', 'invoice', 'invoice_link', 'payment',
      'refund', 'patient_credit', 'cash_closing', 'finance_report_export')
    AND clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
  );

-- Spec §5.2: one row per invoice with what is paid and owed, derived from the movements exactly as
-- packages/contracts/src/settlement.ts derives them (live = allocation − the credits released from it).
-- The first security_invoker view of the repo: the caller's RLS applies, so it never crosses a clinic.
-- Until the contract step (0073) the invoice's day is issued_at in the clinic's current timezone (EY-10.6).
CREATE VIEW finance_invoice_balances WITH (security_invoker = true, security_barrier = true) AS
  SELECT i.clinic_id, i.id, i.branch_id, i.patient_id, i.status, i.issued_at,
    (i.issued_at AT TIME ZONE c.timezone)::date AS business_date,
    i.total_minor,
    coalesce(paid.paid_minor, 0)::bigint AS paid_minor,
    CASE WHEN i.status = 'issued' THEN i.total_minor - coalesce(paid.paid_minor, 0) ELSE 0 END::bigint AS owed_minor,
    i.currency
  FROM invoices i
  JOIN clinics c ON c.id = i.clinic_id
  LEFT JOIN LATERAL (
    SELECT sum(a.amount_minor - coalesce(released.amount_minor, 0)) AS paid_minor
    FROM payment_allocations a
    LEFT JOIN LATERAL (
      SELECT sum(pc.amount_minor) AS amount_minor
      FROM patient_credits pc
      WHERE pc.clinic_id = a.clinic_id AND pc.origin_allocation_id = a.id AND pc.patient_id = a.patient_id
    ) released ON true
    WHERE a.clinic_id = i.clinic_id AND a.invoice_id = i.id AND a.patient_id = i.patient_id
  ) paid ON true;

-- Spec §4 R1, §5.1: per business day, branch and method, the money in and out. Movements keep their stored
-- business_date and their own branch (F2-Q8). A NULL branch list reaches no branch: the API always passes
-- the caller's reach, and the function never widens it.
CREATE FUNCTION finance_report_daily_takings(p_from date, p_to date, p_branch_ids uuid[])
  RETURNS TABLE (business_date date, branch_id uuid, method text, in_minor bigint, out_minor bigint,
    net_minor bigint, currency char(3))
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog, public
AS $$
  SELECT m.day, m.branch, m.method, sum(m.money_in)::bigint, sum(m.money_out)::bigint,
    (sum(m.money_in) - sum(m.money_out))::bigint, m.currency
  FROM (
    SELECT p.business_date AS day, p.branch_id AS branch, p.method, p.currency,
      p.amount_minor AS money_in, 0::bigint AS money_out
    FROM payments p
    WHERE p.business_date BETWEEN p_from AND p_to AND p.branch_id = ANY (p_branch_ids)
    UNION ALL
    SELECT f.business_date, f.branch_id, f.method, f.currency, 0::bigint, f.amount_minor
    FROM refunds f
    WHERE f.business_date BETWEEN p_from AND p_to AND f.branch_id = ANY (p_branch_ids)
  ) m
  GROUP BY m.day, m.branch, m.method, m.currency
  ORDER BY m.day, m.branch, m.method
$$;

-- Spec §4 R2, R1-17: per business day and branch (the API sums the days into months). A void invoice
-- counts only in void_count; an edit or a void restates the issue day, never the edit's day. The credit
-- applied is information, not collected money; it reaches its branch through its invoice. The ±2-day
-- bound on issued_at only lets the index of 0069 narrow the scan: no timezone is that far from UTC.
CREATE FUNCTION finance_report_period_summary(p_from date, p_to date, p_branch_ids uuid[])
  RETURNS TABLE (business_date date, branch_id uuid, invoiced_minor bigint, discount_minor bigint,
    tax_minor bigint, collected_minor bigint, refunded_minor bigint, credit_applied_minor bigint,
    void_count integer, currency char(3))
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog, public
AS $$
  SELECT m.day, m.branch, sum(m.invoiced)::bigint, sum(m.discount)::bigint, sum(m.tax)::bigint,
    sum(m.collected)::bigint, sum(m.refunded)::bigint, sum(m.credit_applied)::bigint,
    sum(m.voided)::integer, m.currency
  FROM (
    SELECT (i.issued_at AT TIME ZONE c.timezone)::date AS day, i.branch_id AS branch, i.currency,
      CASE WHEN i.status = 'issued' THEN i.total_minor ELSE 0 END AS invoiced,
      CASE WHEN i.status = 'issued' THEN i.discount_minor ELSE 0 END AS discount,
      CASE WHEN i.status = 'issued' THEN i.tax_minor ELSE 0 END AS tax,
      0::bigint AS collected, 0::bigint AS refunded, 0::bigint AS credit_applied,
      CASE WHEN i.status = 'void' THEN 1 ELSE 0 END AS voided
    FROM invoices i
    JOIN clinics c ON c.id = i.clinic_id
    WHERE i.branch_id = ANY (p_branch_ids)
      AND i.issued_at >= p_from - 2 AND i.issued_at < p_to + 3
      AND (i.issued_at AT TIME ZONE c.timezone)::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT p.business_date, p.branch_id, p.currency, 0, 0, 0, p.amount_minor, 0, 0, 0
    FROM payments p
    WHERE p.business_date BETWEEN p_from AND p_to AND p.branch_id = ANY (p_branch_ids)
    UNION ALL
    SELECT f.business_date, f.branch_id, f.currency, 0, 0, 0, 0, f.amount_minor, 0, 0
    FROM refunds f
    WHERE f.business_date BETWEEN p_from AND p_to AND f.branch_id = ANY (p_branch_ids)
    UNION ALL
    SELECT (a.created_at AT TIME ZONE c.timezone)::date, i.branch_id, i.currency, 0, 0, 0, 0, 0,
      a.amount_minor, 0
    FROM payment_allocations a
    JOIN invoices i ON i.clinic_id = a.clinic_id AND i.id = a.invoice_id AND i.patient_id = a.patient_id
    JOIN clinics c ON c.id = a.clinic_id
    WHERE a.credit_id IS NOT NULL AND i.branch_id = ANY (p_branch_ids)
      AND (a.created_at AT TIME ZONE c.timezone)::date BETWEEN p_from AND p_to
  ) m
  GROUP BY m.day, m.branch, m.currency
  ORDER BY m.day, m.branch
$$;

-- Spec §4 R3, F3-Q3 a: the billed amount per service of the live lines (archived_at IS NULL) of the
-- issued invoices whose issue day is in range. line_total_minor is already net of both discounts, so the
-- rows plus the one tax row add up to the invoices' total; free lines are one row of their own.
CREATE FUNCTION finance_report_by_service(p_from date, p_to date, p_branch_ids uuid[])
  RETURNS TABLE (kind text, service_id uuid, line_count integer, quantity integer, amount_minor bigint,
    currency char(3))
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog, public
AS $$
  WITH billed AS (
    SELECT i.clinic_id, i.id, i.tax_minor, i.currency
    FROM invoices i
    JOIN clinics c ON c.id = i.clinic_id
    WHERE i.status = 'issued' AND i.branch_id = ANY (p_branch_ids)
      AND i.issued_at >= p_from - 2 AND i.issued_at < p_to + 3
      AND (i.issued_at AT TIME ZONE c.timezone)::date BETWEEN p_from AND p_to
  )
  SELECT l.kind, l.service_id, count(*)::integer, sum(l.quantity)::integer, sum(l.line_total_minor)::bigint,
    b.currency
  FROM billed b
  JOIN invoice_lines l ON l.clinic_id = b.clinic_id AND l.invoice_id = b.id AND l.archived_at IS NULL
  GROUP BY l.kind, l.service_id, b.currency
  UNION ALL
  SELECT 'tax', NULL, 0, 0, sum(b.tax_minor)::bigint, b.currency
  FROM billed b
  GROUP BY b.currency
  HAVING sum(b.tax_minor) > 0
$$;

-- Spec §4 R4, R2-6: the same lines grouped by their provider, a management view of who billed what (no
-- own scope here; R10 is the doctor's own summary). Lines with no provider are one row of their own.
CREATE FUNCTION finance_report_by_doctor(p_from date, p_to date, p_branch_ids uuid[])
  RETURNS TABLE (kind text, provider_id uuid, line_count integer, quantity integer, amount_minor bigint,
    currency char(3))
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog, public
AS $$
  WITH billed AS (
    SELECT i.clinic_id, i.id, i.tax_minor, i.currency
    FROM invoices i
    JOIN clinics c ON c.id = i.clinic_id
    WHERE i.status = 'issued' AND i.branch_id = ANY (p_branch_ids)
      AND i.issued_at >= p_from - 2 AND i.issued_at < p_to + 3
      AND (i.issued_at AT TIME ZONE c.timezone)::date BETWEEN p_from AND p_to
  )
  SELECT CASE WHEN l.provider_id IS NULL THEN 'none' ELSE 'doctor' END, l.provider_id, count(*)::integer,
    sum(l.quantity)::integer, sum(l.line_total_minor)::bigint, b.currency
  FROM billed b
  JOIN invoice_lines l ON l.clinic_id = b.clinic_id AND l.invoice_id = b.id AND l.archived_at IS NULL
  GROUP BY l.provider_id, b.currency
  UNION ALL
  SELECT 'tax', NULL, 0, 0, sum(b.tax_minor)::bigint, b.currency
  FROM billed b
  GROUP BY b.currency
  HAVING sum(b.tax_minor) > 0
$$;

-- Spec §4 R9, R3-8: one row per saved closing; it never reads the drawer's method_totals.
CREATE FUNCTION finance_report_cash_closings(p_from date, p_to date, p_branch_ids uuid[])
  RETURNS TABLE (closing_id uuid, branch_id uuid, business_date date, expected_minor bigint,
    counted_minor bigint, difference_minor bigint, closed_by uuid, note_present boolean, currency char(3))
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog, public
AS $$
  SELECT k.id, k.branch_id, k.business_date, k.expected_minor, k.counted_minor, k.difference_minor,
    k.closed_by, k.note IS NOT NULL, k.currency
  FROM cash_closings k
  WHERE k.business_date BETWEEN p_from AND p_to AND k.branch_id = ANY (p_branch_ids)
  ORDER BY k.business_date, k.branch_id
$$;

-- Spec §5.1: invoker rights, so the caller's RLS applies; only the API role may run them. Functions are
-- executable by PUBLIC by default, so that grant is taken away first.
REVOKE ALL ON finance_invoice_balances FROM PUBLIC, eyadex_platform, eyadex_auth, eyadex_dispatcher;
GRANT SELECT ON finance_invoice_balances TO eyadex_app;
REVOKE ALL ON FUNCTION finance_report_daily_takings(date, date, uuid[]),
  finance_report_period_summary(date, date, uuid[]), finance_report_by_service(date, date, uuid[]),
  finance_report_by_doctor(date, date, uuid[]), finance_report_cash_closings(date, date, uuid[])
  FROM PUBLIC, eyadex_platform, eyadex_auth, eyadex_dispatcher;
GRANT EXECUTE ON FUNCTION finance_report_daily_takings(date, date, uuid[]),
  finance_report_period_summary(date, date, uuid[]), finance_report_by_service(date, date, uuid[]),
  finance_report_by_doctor(date, date, uuid[]), finance_report_cash_closings(date, date, uuid[])
  TO eyadex_app;
