-- Finance F3 grants (docs/specs/finance-f3-reports-design.md §5.1, §7.4, §8; pipeline §8.3): the platform,
-- auth and dispatcher roles have no privilege on the export tables, the balance view or any report
-- function, and the platform never sees an export's audit row. Read-only checks inside a transaction
-- that ROLLS BACK, so the file is safe on any database with the db/sql baseline.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/finance-reports-platform.sql

BEGIN;

DO $$
DECLARE r text; t text; f text; p text;
BEGIN
  FOREACH r IN ARRAY ARRAY['eyadex_platform', 'eyadex_auth', 'eyadex_dispatcher'] LOOP
    FOREACH t IN ARRAY ARRAY['finance_report_exports', 'finance_report_export_blobs', 'finance_invoice_balances'] LOOP
      FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege(r, t, p) THEN
          RAISE EXCEPTION 'F3-GRANTS: % holds % on %', r, p, t;
        END IF;
      END LOOP;
    END LOOP;
    FOREACH f IN ARRAY ARRAY['finance_report_daily_takings(date, date, uuid[])',
        'finance_report_period_summary(date, date, uuid[])', 'finance_report_by_service(date, date, uuid[])',
        'finance_report_by_doctor(date, date, uuid[])', 'finance_report_cash_closings(date, date, uuid[])'] LOOP
      IF has_function_privilege(r, f, 'EXECUTE') THEN
        RAISE EXCEPTION 'F3-GRANTS: % can run %', r, f;
      END IF;
    END LOOP;
  END LOOP;
  -- The API role reads and writes the tables (no DELETE), reads the view and runs every function.
  IF NOT has_table_privilege('eyadex_app', 'finance_invoice_balances', 'SELECT')
     OR has_table_privilege('eyadex_app', 'finance_report_exports', 'DELETE')
     OR has_table_privilege('eyadex_app', 'finance_report_export_blobs', 'DELETE')
     OR has_column_privilege('eyadex_app', 'finance_report_exports', 'requested_by', 'UPDATE')
     OR has_column_privilege('eyadex_app', 'finance_report_export_blobs', 'storage_key', 'UPDATE')
     OR NOT has_function_privilege('eyadex_app', 'finance_report_daily_takings(date, date, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'F3-GRANTS: eyadex_app does not hold exactly the F3 grants';
  END IF;
  -- Invoker rights only: no report function runs as its owner (§5.1).
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'finance\_report\_%' AND prosecdef) THEN
    RAISE EXCEPTION 'F3-GRANTS: a report function is SECURITY DEFINER';
  END IF;
END $$;

-- The platform never sees an export's audit row, through the admin view or its own policy (FIN-3, §7.4).
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000f310a','fin-reports-plat','ت','P','dermatology','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-0000000f310a', gen_random_uuid(), gen_random_uuid(),
  'finance_report.exported', 'administrative', 'finance_report_export', gen_random_uuid(), null,
  '{"report":"daily_takings"}', now());
-- The clinic context is set, so the platform's insert policy can refuse only on the entity (PR #124 review).
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000f310a';
SET LOCAL ROLE eyadex_platform;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM platform_clinic_admin_audit WHERE entity_type = 'finance_report_export') THEN
    RAISE EXCEPTION 'F3-GRANTS: the platform admin audit view shows a report export';
  END IF;
  BEGIN
    INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-0000000f310a', gen_random_uuid(), gen_random_uuid(),
      'finance_report.exported', 'administrative', 'finance_report_export', gen_random_uuid(), null, '{}', now());
    RAISE EXCEPTION 'F3-GRANTS: the platform wrote a report export audit row';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- The control: the same insert with an administrative entity the platform may write is accepted.
  INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-0000000f310a', gen_random_uuid(), gen_random_uuid(),
    'clinic.updated', 'administrative', 'clinic', null, null, '{}', now());
END $$;
RESET ROLE;

\echo 'Finance report grant tests: all passed'
ROLLBACK;
