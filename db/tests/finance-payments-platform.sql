-- The F2 money tables and their audit rows never reach the platform (0064, 0065, 0066; spec §4.5, FIN-3,
-- F2-Q19): the platform reads monthly totals only, and a payment, a refund, a credit or a cash closing
-- names a patient or is finance, so the platform sees none of them.
-- Runs inside one transaction and ROLLS BACK, so it is safe on any database that has the db/sql baseline.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/finance-payments-platform.sql

BEGIN;

-- Grants: the platform (and every role but the clinic one) has no privilege at all on the money tables;
-- the clinic role reads and inserts, never deletes, and updates only the counters and the settings row.
DO $$
DECLARE t text; r text; priv text; col text; want text[]; got boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['clinic_payment_methods','receipt_sequences','payments','payment_allocations',
      'patient_credits','refunds','refund_sources','cash_closings','branch_cash_drawers'] LOOP
    FOREACH r IN ARRAY ARRAY['eyadex_platform','eyadex_auth','eyadex_dispatcher'] LOOP
      FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(r, t, priv) THEN
          RAISE EXCEPTION 'FIN-F2-GRANTS: % has % on %', r, priv, t;
        END IF;
      END LOOP;
    END LOOP;
    IF NOT has_table_privilege('eyadex_app', t, 'SELECT')
       OR NOT has_table_privilege('eyadex_app', t, 'INSERT') THEN
      RAISE EXCEPTION 'FIN-F2-GRANTS: eyadex_app cannot read or write %', t;
    END IF;
    -- No table-level UPDATE on any money table: only the counters and the switch change, by name (PR #92 review).
    IF has_table_privilege('eyadex_app', t, 'UPDATE') THEN
      RAISE EXCEPTION 'FIN-F2-GRANTS: eyadex_app has a table-level UPDATE on %', t;
    END IF;
    FOREACH priv IN ARRAY ARRAY['DELETE','TRUNCATE'] LOOP
      IF has_table_privilege('eyadex_app', t, priv) THEN
        RAISE EXCEPTION 'FIN-F2-GRANTS: eyadex_app has % on %', priv, t;
      END IF;
    END LOOP;
  END LOOP;
  -- The column-level UPDATE is exactly the counters and the switch; a row's identity never moves (PR #92 review).
  FOR t, want IN SELECT * FROM (VALUES
      ('clinic_payment_methods', ARRAY['enabled','updated_at']::text[]),
      ('receipt_sequences', ARRAY['next_number','updated_at']::text[]),
      ('branch_cash_drawers', ARRAY['last_cash_seq','last_closed_seq','last_closing_id','updated_at']::text[])
    ) AS v(t, want) LOOP
    FOR col IN SELECT column_name FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = t LOOP
      SELECT has_column_privilege('eyadex_app', t, col, 'UPDATE') INTO got;
      IF got <> (col = ANY (want)) THEN
        RAISE EXCEPTION 'FIN-F2-GRANTS: eyadex_app updates % of % wrongly', col, t;
      END IF;
    END LOOP;
  END LOOP;
  -- No column of the other six money tables is updatable.
  FOREACH t IN ARRAY ARRAY['payments','payment_allocations','patient_credits','refunds','refund_sources','cash_closings'] LOOP
    FOR col IN SELECT column_name FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = t LOOP
      IF has_column_privilege('eyadex_app', t, col, 'UPDATE') THEN
        RAISE EXCEPTION 'FIN-F2-GRANTS: eyadex_app updates the column % of %', col, t;
      END IF;
    END LOOP;
  END LOOP;
  -- RLS (CLAUDE.md §5): every money table is enabled and forced, with the standard tenant policy; the
  -- policies that name a finance owner role sit beside it.
  FOREACH t IN ARRAY ARRAY['clinic_payment_methods','receipt_sequences','payments','payment_allocations',
      'patient_credits','refunds','refund_sources','cash_closings','branch_cash_drawers'] LOOP
    IF (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c
         WHERE c.oid = to_regclass('public.' || t)) IS NOT TRUE THEN
      RAISE EXCEPTION 'FIN-F2-RLS: % does not force row level security', t;
    END IF;
    IF (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_tenant_isolation'
           AND 'public' = ANY(roles)
           AND qual = '(clinic_id = (NULLIF(current_setting(''app.clinic_id''::text, true), ''''::text))::uuid)'
           AND with_check = '(clinic_id = (NULLIF(current_setting(''app.clinic_id''::text, true), ''''::text))::uuid)') <> 1 THEN
      RAISE EXCEPTION 'FIN-F2-RLS: % does not carry the standard tenant policy', t;
    END IF;
  END LOOP;
END $$;

-- The two finance owner roles: a NOLOGIN, NOBYPASSRLS role that reads exactly the columns its check needs
-- and nothing else — no patient column, no patients table.
DO $$
DECLARE t text; col text; want text[]; got boolean;
BEGIN
  IF (SELECT rolcanlogin OR rolbypassrls FROM pg_roles WHERE rolname = 'eyadex_finance_check_owner') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FIN-F2-GRANTS: the check owner can log in, bypass RLS, or is missing';
  END IF;
  FOR t, want IN SELECT * FROM (VALUES
      ('invoices', ARRAY['clinic_id','id','status','total_minor']::text[]),
      ('payments', ARRAY['clinic_id','id','branch_id','patient_id','amount_minor','cash_seq']::text[]),
      ('payment_allocations', ARRAY['clinic_id','id','patient_id','invoice_id','payment_id','credit_id','amount_minor']::text[]),
      ('patient_credits', ARRAY['clinic_id','id','patient_id','origin_allocation_id','amount_minor']::text[]),
      ('refunds', ARRAY['clinic_id','id','branch_id','patient_id','amount_minor','cash_seq']::text[]),
      ('refund_sources', ARRAY['clinic_id','refund_id','credit_id','patient_id','amount_minor']::text[]),
      ('branch_cash_drawers', ARRAY['clinic_id','branch_id','last_cash_seq','last_closed_seq','last_closing_id']::text[]),
      ('cash_closings', ARRAY['clinic_id','id','branch_id','from_cash_seq','to_cash_seq','expected_minor','previous_closing_id']::text[])
    ) AS v(t, want) LOOP
    FOR col IN SELECT column_name FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = t LOOP
      SELECT has_column_privilege('eyadex_finance_check_owner', t, col, 'SELECT') INTO got;
      IF got <> (col = ANY (want)) THEN
        RAISE EXCEPTION 'FIN-F2-GRANTS: the check owner reads % of % wrongly', col, t;
      END IF;
    END LOOP;
  END LOOP;
  -- The check owner reads no patient and no settings row.
  IF has_table_privilege('eyadex_finance_check_owner', 'patients', 'SELECT') THEN
    RAISE EXCEPTION 'FIN-F2-GRANTS: the check owner can read patients';
  END IF;
  FOR col IN SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'patients' LOOP
    IF has_column_privilege('eyadex_finance_check_owner', 'patients', col, 'SELECT') THEN
      RAISE EXCEPTION 'FIN-F2-GRANTS: the check owner can read the column % of patients', col;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['clinic_payment_methods','receipt_sequences'] LOOP
    IF has_table_privilege('eyadex_finance_check_owner', t, 'SELECT')
       OR has_column_privilege('eyadex_finance_check_owner', t, 'id', 'SELECT') THEN
      RAISE EXCEPTION 'FIN-F2-GRANTS: the check owner reads %', t;
    END IF;
  END LOOP;
  -- The totals owner reads the four money columns and nothing else (FIN-3, R1-17).
  FOR t, want IN SELECT * FROM (VALUES
      ('payments', ARRAY['clinic_id','received_at','amount_minor','currency']::text[]),
      ('refunds', ARRAY['clinic_id','refunded_at','amount_minor','currency']::text[])
    ) AS v(t, want) LOOP
    FOR col IN SELECT column_name FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = t LOOP
      SELECT has_column_privilege('eyadex_finance_totals_owner', t, col, 'SELECT') INTO got;
      IF got <> (col = ANY (want)) THEN
        RAISE EXCEPTION 'FIN-F2-GRANTS: the totals owner reads % of % wrongly', col, t;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- The check functions: owned by the check owner, SECURITY DEFINER, and callable by no runtime role. The
-- totals function runs for the platform only, and its columns keep their names and their order.
DO $$
DECLARE sig text; r text; fn regprocedure; result text;
BEGIN
  FOREACH sig IN ARRAY ARRAY['finance_check_patient(uuid, uuid)','finance_check_cash_movement(uuid, uuid, bigint)',
      'finance_check_drawer(uuid, uuid)','finance_check_closing(uuid, uuid)','finance_patient_money_trigger()',
      'finance_cash_movement_trigger()','finance_cash_drawer_trigger()','finance_cash_closing_trigger()'] LOOP
    FOREACH r IN ARRAY ARRAY['eyadex_app','eyadex_platform','eyadex_auth','eyadex_dispatcher'] LOOP
      IF has_function_privilege(r, sig, 'EXECUTE') THEN
        RAISE EXCEPTION 'FIN-F2-GRANTS: % can run %', r, sig;
      END IF;
    END LOOP;
    fn := to_regprocedure(sig);
    IF fn IS NULL THEN
      RAISE EXCEPTION 'FIN-F2-GRANTS: % is missing', sig;
    END IF;
    IF (SELECT p.proowner::regrole::text FROM pg_proc p WHERE p.oid = fn) <> 'eyadex_finance_check_owner' THEN
      RAISE EXCEPTION 'FIN-F2-GRANTS: % is not owned by the check owner', sig;
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = fn) THEN
      RAISE EXCEPTION 'FIN-F2-GRANTS: % is not SECURITY DEFINER', sig;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('eyadex_platform', 'finance_monthly_totals(uuid)', 'EXECUTE')
     OR has_function_privilege('eyadex_app', 'finance_monthly_totals(uuid)', 'EXECUTE')
     OR has_function_privilege('eyadex_auth', 'finance_monthly_totals(uuid)', 'EXECUTE')
     OR has_function_privilege('eyadex_dispatcher', 'finance_monthly_totals(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FIN-F2-GRANTS: the totals function runs for the platform only';
  END IF;
  IF (SELECT p.proowner::regrole::text FROM pg_proc p
       WHERE p.oid = to_regprocedure('finance_monthly_totals(uuid)')) <> 'eyadex_finance_totals_owner' THEN
    RAISE EXCEPTION 'FIN-F2-GRANTS: the totals function is not owned by the totals owner';
  END IF;
  result := pg_get_function_result(to_regprocedure('finance_monthly_totals(uuid)'));
  IF result IS DISTINCT FROM 'TABLE(month date, invoiced_minor bigint, currency character, collected_minor bigint, refunded_minor bigint)' THEN
    RAISE EXCEPTION 'FIN-F2-GRANTS: the totals function returns %', result;
  END IF;
END $$;

-- One clinic with a patient, an invoice, two payments, a credit and a refund, written by the owner role.
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-00000000064a','finance-f2-platform','م','M','dermatology','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
INSERT INTO branches VALUES ('00000000-0000-7000-8000-00000000064a','00000000-0000-7000-8000-00000000064b','ف','B',true,now(),now());
INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
    civil_id_enc, civil_id_hmac, civil_id_last4, status, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-00000000064a','00000000-0000-7000-8000-00000000064c','1','x','+96500000064','1990-01-01','female',
    '00000000-0000-7000-8000-00000000064b','f1.1.iv.body.tag',repeat('d',64),'0000','active',now(),now());
INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status, source, source_id,
    issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp, tax_minor, total_minor,
    created_by, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-00000000064a','00000000-0000-7000-8000-00000000064d','00000000-0000-7000-8000-00000000064b',
    '00000000-0000-7000-8000-00000000064c',2026,1,'F2-2026-000001','issued','manual',null,
    '2026-10-15T10:00Z','KWD',3,10000,0,0,0,10000,gen_random_uuid(),now(),now());
-- 2026-10-31T22:30Z is 1 November in Kuwait, so that payment lands in November.
INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
    amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
  VALUES ('00000000-0000-7000-8000-00000000064a','00000000-0000-7000-8000-00000000064e','00000000-0000-7000-8000-00000000064b',
    '00000000-0000-7000-8000-00000000064c','00000000-0000-7000-8000-00000000064d',2026,1,'F2-R-2026-000001','knet',
    4000,'KWD',3,null,'2026-10-31T22:30Z','2026-10-31',null,gen_random_uuid(),now()),
    ('00000000-0000-7000-8000-00000000064a','00000000-0000-7000-8000-000000000650','00000000-0000-7000-8000-00000000064b',
    '00000000-0000-7000-8000-00000000064c','00000000-0000-7000-8000-00000000064d',2026,2,'F2-R-2026-000002','knet',
    1000,'KWD',3,null,'2026-10-20T10:00Z','2026-10-20',null,gen_random_uuid(),now());
INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
  VALUES ('00000000-0000-7000-8000-00000000064a','00000000-0000-7000-8000-00000000064f','00000000-0000-7000-8000-00000000064d',
    '00000000-0000-7000-8000-00000000064c','00000000-0000-7000-8000-00000000064e',null,4000,gen_random_uuid(),now()),
    ('00000000-0000-7000-8000-00000000064a','00000000-0000-7000-8000-000000000651','00000000-0000-7000-8000-00000000064d',
    '00000000-0000-7000-8000-00000000064c','00000000-0000-7000-8000-000000000650',null,1000,gen_random_uuid(),now());
INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
  VALUES ('00000000-0000-7000-8000-00000000064a','00000000-0000-7000-8000-000000000652','00000000-0000-7000-8000-00000000064c',
    '00000000-0000-7000-8000-000000000651',500,'refund',gen_random_uuid(),now());
INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
    amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
  VALUES ('00000000-0000-7000-8000-00000000064a','00000000-0000-7000-8000-000000000653','00000000-0000-7000-8000-00000000064b',
    '00000000-0000-7000-8000-00000000064c','00000000-0000-7000-8000-00000000064d',2026,1,'F2-RF-2026-000001','knet',
    500,'KWD',3,'x','2026-10-21T10:00Z','2026-10-21',null,gen_random_uuid(),now());
INSERT INTO refund_sources (clinic_id, id, refund_id, credit_id, patient_id, amount_minor, created_at)
  VALUES ('00000000-0000-7000-8000-00000000064a','00000000-0000-7000-8000-000000000654','00000000-0000-7000-8000-000000000653',
    '00000000-0000-7000-8000-000000000652','00000000-0000-7000-8000-00000000064c',500,now());

-- One audit row of every finance entity, written by the owner role.
DO $$
DECLARE e text;
BEGIN
  INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-00000000064a', gen_random_uuid(), gen_random_uuid(), 'payment.recorded', 'patient_access', 'payment', gen_random_uuid(), null, '{}', now());
  INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-00000000064a', gen_random_uuid(), gen_random_uuid(), 'refund.recorded', 'patient_access', 'refund', gen_random_uuid(), null, '{}', now());
  INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-00000000064a', gen_random_uuid(), gen_random_uuid(), 'credit.released', 'patient_access', 'patient_credit', gen_random_uuid(), null, '{}', now());
  INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-00000000064a', gen_random_uuid(), gen_random_uuid(), 'cash_closing.closed', 'administrative', 'cash_closing', gen_random_uuid(), null, '{}', now());
  -- The payment methods are a clinic setting about no patient: administrative, and the platform's (0064).
  INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-00000000064a', gen_random_uuid(), gen_random_uuid(), 'payment_methods.changed', 'administrative', 'payment_methods', gen_random_uuid(), null, '{}', now());
  -- A patient-named money event can never be filed as administrative (0064's rule).
  FOREACH e IN ARRAY ARRAY['payment','refund','patient_credit'] LOOP
    BEGIN
      INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-00000000064a', gen_random_uuid(), gen_random_uuid(), e || '.created', 'administrative', e, null, null, '{}', now());
      RAISE EXCEPTION 'FIN-F2-AUDIT: a % event was accepted as administrative', e;
    EXCEPTION WHEN check_violation THEN NULL; END;
  END LOOP;
END $$;

-- As the platform: no money table is readable, its only window on clinic audit shows no money row, and the
-- monthly totals carry the collected and the refunded money (0065).
SET LOCAL ROLE eyadex_platform;
DO $$
DECLARE t text; n bigint; got text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clinic_payment_methods','receipt_sequences','payments','payment_allocations',
      'patient_credits','refunds','refund_sources','cash_closings','branch_cash_drawers'] LOOP
    BEGIN
      EXECUTE format('SELECT 1 FROM %I LIMIT 1', t);
      RAISE EXCEPTION 'PLAT-01: platform can read %', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  SELECT count(*) INTO n FROM platform_clinic_admin_audit
    WHERE clinic_id = '00000000-0000-7000-8000-00000000064a'
      AND entity_type IN ('payment','refund','patient_credit','cash_closing');
  IF n <> 0 THEN RAISE EXCEPTION 'PLAT-01: the admin audit view shows % money rows', n; END IF;
  SELECT count(*) INTO n FROM platform_clinic_admin_audit WHERE clinic_id = '00000000-0000-7000-8000-00000000064a';
  IF n <> 1 THEN RAISE EXCEPTION 'PLAT: the admin audit view shows % rows of the clinic, expected 1', n; END IF;
  -- Totals by the clinic-timezone month: the November payment lands in November (R1-17).
  SELECT string_agg(month || '=' || invoiced_minor || '/' || collected_minor || '/' || refunded_minor || ' ' || currency, ', ' ORDER BY month)
    INTO got FROM finance_monthly_totals('00000000-0000-7000-8000-00000000064a');
  IF got IS DISTINCT FROM '2026-10-01=10000/1000/500 KWD, 2026-11-01=0/4000/0 KWD' THEN
    RAISE EXCEPTION 'FIN-F2-GRANTS: the platform totals are %', got;
  END IF;
END $$;
-- Onboarding and settings write administrative rows as the platform (0016); never a money one (0064, F2-Q19).
DO $$
DECLARE e text;
BEGIN
  PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-00000000064a', true);
  FOREACH e IN ARRAY ARRAY['payment','refund','patient_credit','cash_closing'] LOOP
    BEGIN
      INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-00000000064a', gen_random_uuid(), gen_random_uuid(), e || '.created', 'administrative', e, null, null, '{}', now());
      RAISE EXCEPTION 'PLAT-01: the platform wrote an administrative % audit row', e;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-00000000064a', gen_random_uuid(), gen_random_uuid(), 'payment_methods.changed', 'administrative', 'payment_methods', null, null, '{}', now());
END $$;

RESET ROLE;
\echo 'Finance F2 platform tests: all passed'
ROLLBACK;
