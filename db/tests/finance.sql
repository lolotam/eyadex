-- Finance F1 rules in the database itself (docs/specs/finance-design.md §3.2, R1, R2; plan Task 3).
-- One transaction that ROLLS BACK: safe on any database with the db/sql baseline.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/finance.sql

BEGIN;

INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000f000a','fin-alpha','أ','A','dermatology','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
INSERT INTO branches VALUES ('00000000-0000-7000-8000-0000000f000a','00000000-0000-7000-8000-0000000f0002','ف','B',true,now(),now());
INSERT INTO roles VALUES ('00000000-0000-7000-8000-0000000f000a','00000000-0000-7000-8000-0000000f0003','doctor','طبيب','Doctor',false,true,now(),now());
INSERT INTO memberships VALUES ('00000000-0000-7000-8000-0000000f000a','00000000-0000-7000-8000-0000000f0005','00000000-0000-7000-8000-0000000f0006','n','fin@example.com','00000000-0000-7000-8000-0000000f0003',false,'active','ar',null,now(),now());
INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
    civil_id_enc, civil_id_hmac, civil_id_last4, status, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-0000000f000a','00000000-0000-7000-8000-0000000f0009','1','x','+96500000001','1990-01-01','female',
    '00000000-0000-7000-8000-0000000f0002','f1.1.iv.body.tag',repeat('f',64),'0000','active',now(),now());
INSERT INTO clinic_services VALUES ('00000000-0000-7000-8000-0000000f000a','00000000-0000-7000-8000-0000000f000f','ليزر','Laser',30,'active',now(),now());

-- The catalogue holds exactly the 23 finance keys (F1 Task 2 and F2 §4.1) (an exact set, not a count), in the 0x34–0x4a ids.
DO $$
DECLARE expected text[] := ARRAY['view:invoices:clinic','view:invoices:branch','view:invoices:own',
  'create:invoices:clinic','create:invoices:branch','update:invoices:clinic','update:invoices:branch',
  'deactivate:invoices:clinic','deactivate:invoices:branch','create:discounts:clinic','create:discounts:branch',
  'view:prices:clinic','update:prices:clinic',
  'view:payments:clinic','view:payments:branch','create:payments:clinic','create:payments:branch',
  'create:refunds:clinic','create:refunds:branch',
  'view:cash_closings:clinic','view:cash_closings:branch','create:cash_closings:clinic','create:cash_closings:branch'];
  actual text[];
BEGIN
  SELECT array_agg(key ORDER BY id) INTO actual FROM permissions WHERE module = 'finance';
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FIN: finance keys are %, expected %', actual, expected;
  END IF;
  IF (SELECT min(id::text) FROM permissions WHERE module = 'finance') <> '00000000-0000-7000-8000-0000000c0034'
     OR (SELECT max(id::text) FROM permissions WHERE module = 'finance') <> '00000000-0000-7000-8000-0000000c004a' THEN
    RAISE EXCEPTION 'FIN: finance key ids are not 0x34–0x4a';
  END IF;
END $$;

-- Clinic money settings: existing clinics read KWD / 3 / 0 %; the exponent follows the currency.
DO $$
DECLARE c uuid := '00000000-0000-7000-8000-0000000f000a';
BEGIN
  IF (SELECT (currency, currency_exponent, tax_rate_bp) <> ('KWD', 3::smallint, 0) FROM clinics WHERE id = c) THEN
    RAISE EXCEPTION 'FIN: a clinic does not default to KWD / 3 / 0';
  END IF;
  BEGIN UPDATE clinics SET currency = 'USD' WHERE id = c; RAISE EXCEPTION 'FIN: USD accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE clinics SET currency = 'SAR' WHERE id = c; RAISE EXCEPTION 'FIN: SAR with exponent 3 accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE clinics SET tax_rate_bp = 10001 WHERE id = c; RAISE EXCEPTION 'FIN: a tax above 10000 basis points accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE branches SET invoice_prefix = 'ab' WHERE clinic_id = c; RAISE EXCEPTION 'FIN: a lower-case prefix accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000f000a';

DO $$
DECLARE c uuid := '00000000-0000-7000-8000-0000000f000a';
  br uuid := '00000000-0000-7000-8000-0000000f0002'; pt uuid := '00000000-0000-7000-8000-0000000f0009';
  sv uuid := '00000000-0000-7000-8000-0000000f000f'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  appt uuid := '00000000-0000-7000-8000-0000000f0101'; inv uuid := '00000000-0000-7000-8000-0000000f0201';
BEGIN
  -- Prices: one line is capped at 10¹² minor units (R1-2), for the base and the doctor price.
  UPDATE clinic_services SET price_minor = 1000000000000 WHERE id = sv;
  BEGIN UPDATE clinic_services SET price_minor = 1000000000001 WHERE id = sv; RAISE EXCEPTION 'FIN: a base price above the line cap accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO service_provider_prices VALUES (c, gen_random_uuid(), sv, mb, 1000000000001, now(), now());
    RAISE EXCEPTION 'FIN: a doctor price above the line cap accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO service_provider_prices VALUES (c, gen_random_uuid(), sv, mb, 12000, now(), now());
  BEGIN
    INSERT INTO service_provider_prices VALUES (c, gen_random_uuid(), sv, mb, 13000, now(), now());
    RAISE EXCEPTION 'FIN: two prices for one doctor and service accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- R1-9: a prefix used once in the clinic never goes to another branch.
  INSERT INTO used_invoice_prefixes VALUES (c, gen_random_uuid(), 'SAL', br, now());
  BEGIN
    INSERT INTO used_invoice_prefixes VALUES (c, gen_random_uuid(), 'SAL', br, now());
    RAISE EXCEPTION 'FIN: a used prefix was given again';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- Source rules: manual has no source id; an appointment or visit invoice has one.
  BEGIN
    INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status, source, source_id,
        issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp, tax_minor, total_minor,
        created_by, created_at, updated_at)
      VALUES (c, gen_random_uuid(), br, pt, 2026, 1, 'SAL-2026-000001', 'issued', 'manual', appt,
        now(), 'KWD', 3, 0, 0, 0, 0, 0, mb, now(), now());
    RAISE EXCEPTION 'FIN: a manual invoice with a source id accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status, source, source_id,
        issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp, tax_minor, total_minor,
        created_by, created_at, updated_at)
      VALUES (c, gen_random_uuid(), br, pt, 2026, 1, 'SAL-2026-000001', 'issued', 'visit', null,
        now(), 'KWD', 3, 0, 0, 0, 0, 0, mb, now(), now());
    RAISE EXCEPTION 'FIN: a visit invoice without a source id accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- One live invoice per appointment; a void frees the source and keeps the row and its number.
  INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status, source, source_id,
      issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp, tax_minor, total_minor,
      created_by, created_at, updated_at)
    VALUES (c, inv, br, pt, 2026, 1, 'SAL-2026-000001', 'issued', 'appointment', appt,
      now(), 'KWD', 3, 15000, 0, 0, 0, 15000, mb, now(), now());
  BEGIN
    INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status, source, source_id,
        issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp, tax_minor, total_minor,
        created_by, created_at, updated_at)
      VALUES (c, gen_random_uuid(), br, pt, 2026, 2, 'SAL-2026-000002', 'issued', 'appointment', appt,
        now(), 'KWD', 3, 0, 0, 0, 0, 0, mb, now(), now());
    RAISE EXCEPTION 'FIN: a second live invoice for one appointment accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status, source, source_id,
        issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp, tax_minor, total_minor,
        created_by, created_at, updated_at)
      VALUES (c, gen_random_uuid(), br, pt, 2026, 2, 'SAL-2026-000001', 'issued', 'manual', null,
        now(), 'KWD', 3, 0, 0, 0, 0, 0, mb, now(), now());
    RAISE EXCEPTION 'FIN: a duplicate invoice number accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN UPDATE invoices SET status = 'void' WHERE id = inv; RAISE EXCEPTION 'FIN: a void without a reason accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE invoices SET total_minor = -1 WHERE id = inv; RAISE EXCEPTION 'FIN: a negative total accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- Lines: one active line per position; archiving frees it (FIN-A5 edits); amounts within the line cap.
  INSERT INTO invoice_lines (clinic_id, id, invoice_id, position, kind, service_id, provider_id, description_ar,
      description_en, quantity, unit_price_minor, line_total_minor, created_at, updated_at)
    VALUES (c, '00000000-0000-7000-8000-0000000f0301', inv, 0, 'service', sv, mb, 'ليزر', 'Laser', 1, 15000, 15000, now(), now());
  BEGIN
    INSERT INTO invoice_lines (clinic_id, id, invoice_id, position, kind, description_ar, description_en, quantity,
        unit_price_minor, line_total_minor, created_at, updated_at)
      VALUES (c, gen_random_uuid(), inv, 0, 'free', 'x', 'x', 1, 0, 0, now(), now());
    RAISE EXCEPTION 'FIN: two active lines at one position accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  UPDATE invoice_lines SET archived_at = now() WHERE id = '00000000-0000-7000-8000-0000000f0301';
  INSERT INTO invoice_lines (clinic_id, id, invoice_id, position, kind, description_ar, description_en, quantity,
      unit_price_minor, line_total_minor, created_at, updated_at)
    VALUES (c, gen_random_uuid(), inv, 0, 'free', 'x', 'x', 1, 0, 0, now(), now());
  BEGIN
    INSERT INTO invoice_lines (clinic_id, id, invoice_id, position, kind, description_ar, description_en, quantity,
        unit_price_minor, line_total_minor, created_at, updated_at)
      VALUES (c, gen_random_uuid(), inv, 1, 'service', 'x', 'x', 1, 0, 0, now(), now());
    RAISE EXCEPTION 'FIN: a service line without a service accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO invoice_lines (clinic_id, id, invoice_id, position, kind, description_ar, description_en, quantity,
        unit_price_minor, line_total_minor, created_at, updated_at)
      VALUES (c, gen_random_uuid(), inv, 1, 'free', 'x', 'x', 1000, 0, 0, now(), now());
    RAISE EXCEPTION 'FIN: a quantity of 1000 accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO invoice_lines (clinic_id, id, invoice_id, position, kind, description_ar, description_en, quantity,
        unit_price_minor, line_total_minor, created_at, updated_at)
      VALUES (c, gen_random_uuid(), inv, 1, 'free', 'x', 'x', 1, 1000000000001, 0, now(), now());
    RAISE EXCEPTION 'FIN: a unit price above the line cap accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO invoice_lines (clinic_id, id, invoice_id, position, kind, description_ar, description_en, quantity,
        unit_price_minor, line_total_minor, created_at, updated_at)
      VALUES (c, gen_random_uuid(), inv, 1, 'free', 'x', 'x', 1, 0, 1000000000001, now(), now());
    RAISE EXCEPTION 'FIN: a line total above the line cap accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- The void frees the appointment for a new invoice; the voided row and its number stay.
  UPDATE invoices SET status = 'void', voided_at = now(), void_reason = 'wrong patient', version = version + 1 WHERE id = inv;
  INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status, source, source_id,
      issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp, tax_minor, total_minor,
      created_by, created_at, updated_at)
    VALUES (c, gen_random_uuid(), br, pt, 2026, 2, 'SAL-2026-000002', 'issued', 'appointment', appt,
      now(), 'KWD', 3, 0, 0, 0, 0, 0, mb, now(), now());
  IF (SELECT count(*) FROM invoices WHERE number = 'SAL-2026-000001' AND status = 'void') <> 1 THEN
    RAISE EXCEPTION 'FIN: the voided invoice did not keep its number';
  END IF;

  -- Spec §8 R1 rule 3: an invoice audit row is patient access, never administrative.
  BEGIN
    INSERT INTO audit_log VALUES (c, gen_random_uuid(), '00000000-0000-7000-8000-0000000f0006', 'invoice.issued',
      'administrative', 'invoice', inv, br, '{}', now());
    RAISE EXCEPTION 'FIN: an invoice audit row filed as administrative';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO audit_log VALUES (c, gen_random_uuid(), '00000000-0000-7000-8000-0000000f0006', 'invoice.issued',
    'patient_access', 'invoice', inv, br, '{}', now());
END $$;

RESET ROLE;
RESET app.clinic_id;
SET LOCAL ROLE eyadex_platform;

DO $$
DECLARE t text; n bigint;
BEGIN
  -- The platform has no privilege on any finance table (it reads totals only through 0061's function).
  FOREACH t IN ARRAY ARRAY['used_invoice_prefixes','service_provider_prices','invoice_sequences','invoices','invoice_lines'] LOOP
    IF has_table_privilege(t, 'SELECT') OR has_table_privilege(t, 'INSERT') OR has_table_privilege(t, 'UPDATE')
       OR has_table_privilege(t, 'DELETE') THEN
      RAISE EXCEPTION 'FIN: eyadex_platform has a privilege on %', t;
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM platform_clinic_admin_audit WHERE entity_type IN ('invoice', 'invoice_link');
  IF n <> 0 THEN RAISE EXCEPTION 'FIN: the platform audit view shows % invoice rows', n; END IF;
END $$;

RESET ROLE;

-- 0061 (plan Task 4): the platform's two functions and the closed direct path. Clinic T has invoices, U
-- has one, V has neither price nor invoice. Written by the owner role.
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000f001a','fin-t','ت','T','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000f001b','fin-u','ث','U','general','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-0000000f001c','fin-v','ج','V','general','ar','Asia/Riyadh','active',now()+interval '30 days',10,3,now(),now());
DO $$
DECLARE c uuid; s text;
BEGIN
  FOREACH c IN ARRAY ARRAY['00000000-0000-7000-8000-0000000f001a','00000000-0000-7000-8000-0000000f001b',
      '00000000-0000-7000-8000-0000000f001c']::uuid[] LOOP
    s := right(c::text, 1);
    INSERT INTO branches VALUES (c, ('00000000-0000-7000-8000-0000000f02'||s||'2')::uuid, 'ف', 'B', true, now(), now());
    INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
        civil_id_enc, civil_id_hmac, civil_id_last4, status, created_at, updated_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000f02'||s||'9')::uuid, '1', 'x', '+9650000002'||s, '1990-01-01', 'male',
        ('00000000-0000-7000-8000-0000000f02'||s||'2')::uuid, 'f1.1.iv.body.tag', repeat(s, 64), '0000', 'active', now(), now());
    INSERT INTO clinic_services VALUES (c, ('00000000-0000-7000-8000-0000000f02'||s||'f')::uuid, 'ليزر', 'Laser', 30, 'active', now(), now());
  END LOOP;
END $$;
-- T: 2026-10-31T22:30Z is 1 November in Kuwait; one October invoice; one void (excluded). U: one invoice.
INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status, source, source_id,
    issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp, tax_minor, total_minor,
    void_reason, voided_at, created_by, created_at, updated_at)
  VALUES
  ('00000000-0000-7000-8000-0000000f001a','00000000-0000-7000-8000-0000000f0a01','00000000-0000-7000-8000-0000000f02a2',
   '00000000-0000-7000-8000-0000000f02a9',2026,1,'T-2026-000001','issued','manual',null,'2026-10-31T22:30Z','KWD',3,
   1000,0,0,0,1000,null,null,gen_random_uuid(),now(),now()),
  ('00000000-0000-7000-8000-0000000f001a','00000000-0000-7000-8000-0000000f0a02','00000000-0000-7000-8000-0000000f02a2',
   '00000000-0000-7000-8000-0000000f02a9',2026,2,'T-2026-000002','issued','manual',null,'2026-10-15T10:00Z','KWD',3,
   2500,0,0,0,2500,null,null,gen_random_uuid(),now(),now()),
  ('00000000-0000-7000-8000-0000000f001a','00000000-0000-7000-8000-0000000f0a03','00000000-0000-7000-8000-0000000f02a2',
   '00000000-0000-7000-8000-0000000f02a9',2026,3,'T-2026-000003','void','manual',null,'2026-10-15T11:00Z','KWD',3,
   9999,0,0,0,9999,'wrong patient',now(),gen_random_uuid(),now(),now()),
  ('00000000-0000-7000-8000-0000000f001b','00000000-0000-7000-8000-0000000f0b01','00000000-0000-7000-8000-0000000f02b2',
   '00000000-0000-7000-8000-0000000f02b9',2026,1,'U-2026-000001','issued','manual',null,'2026-10-10T10:00Z','KWD',3,
   777,0,0,0,777,null,null,gen_random_uuid(),now(),now());

-- Grants and roles, read as the owner.
DO $$
BEGIN
  IF (SELECT bool_or(rolcanlogin OR rolbypassrls) FROM pg_roles
      WHERE rolname IN ('eyadex_finance_totals_owner', 'eyadex_finance_currency_owner'))
     OR (SELECT count(*) FROM pg_roles
      WHERE rolname IN ('eyadex_finance_totals_owner', 'eyadex_finance_currency_owner')) <> 2 THEN
    RAISE EXCEPTION 'FIN-0061: a finance owner role can log in or bypass RLS';
  END IF;
  IF has_function_privilege('eyadex_app', 'finance_set_currency(uuid, char)', 'EXECUTE')
     OR has_function_privilege('eyadex_app', 'finance_monthly_totals(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('eyadex_platform', 'finance_set_currency(uuid, char)', 'EXECUTE')
     OR NOT has_function_privilege('eyadex_platform', 'finance_monthly_totals(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FIN-0061: the functions run for the platform only';
  END IF;
  IF has_column_privilege('eyadex_finance_totals_owner', 'invoices', 'patient_id', 'SELECT')
     OR has_column_privilege('eyadex_finance_currency_owner', 'invoices', 'patient_id', 'SELECT') THEN
    RAISE EXCEPTION 'FIN-0061: a finance owner role can read a patient column';
  END IF;
  IF has_table_privilege('eyadex_platform', 'clinics', 'UPDATE')
     OR has_column_privilege('eyadex_platform', 'clinics', 'currency', 'UPDATE')
     OR has_column_privilege('eyadex_platform', 'clinics', 'currency_exponent', 'UPDATE')
     OR has_column_privilege('eyadex_platform', 'clinics', 'commercial_reg_no', 'UPDATE')
     OR NOT has_column_privilege('eyadex_platform', 'clinics', 'tax_rate_bp', 'UPDATE')
     OR NOT has_column_privilege('eyadex_platform', 'clinics', 'status', 'UPDATE')
     OR NOT has_table_privilege('eyadex_platform', 'clinics', 'SELECT')
     OR NOT has_table_privilege('eyadex_platform', 'clinics', 'INSERT') THEN
    RAISE EXCEPTION 'FIN-0061: the platform keeps the wrong clinics privileges';
  END IF;
  IF NOT has_column_privilege('eyadex_app', 'clinics', 'commercial_reg_no', 'UPDATE')
     OR NOT has_column_privilege('eyadex_app', 'clinics', 'logo_blob_key', 'UPDATE')
     OR has_column_privilege('eyadex_app', 'clinics', 'currency', 'UPDATE')
     OR has_column_privilege('eyadex_app', 'clinics', 'tax_rate_bp', 'UPDATE') THEN
    RAISE EXCEPTION 'FIN-0061: the clinic writes its CR number and logo only';
  END IF;
END $$;

SET LOCAL ROLE eyadex_platform;
DO $$
DECLARE t uuid := '00000000-0000-7000-8000-0000000f001a'; u uuid := '00000000-0000-7000-8000-0000000f001b';
  v uuid := '00000000-0000-7000-8000-0000000f001c'; got text; tb text;
BEGIN
  -- Totals by the clinic-timezone month; the void is excluded; each clinic sees its own only.
  SELECT string_agg(month || '=' || invoiced_minor || ' ' || currency, ', ' ORDER BY month) INTO got
    FROM finance_monthly_totals(t);
  IF got IS DISTINCT FROM '2026-10-01=2500 KWD, 2026-11-01=1000 KWD' THEN
    RAISE EXCEPTION 'FIN-0061: totals of T are %', got;
  END IF;
  SELECT string_agg(month || '=' || invoiced_minor, ', ') INTO got FROM finance_monthly_totals(u);
  IF got IS DISTINCT FROM '2026-10-01=777' THEN RAISE EXCEPTION 'FIN-0061: totals of U are %', got; END IF;

  -- No direct read of any finance or service table.
  FOREACH tb IN ARRAY ARRAY['invoices','invoice_lines','clinic_services','service_provider_prices'] LOOP
    BEGIN EXECUTE format('SELECT 1 FROM %I LIMIT 1', tb); RAISE EXCEPTION 'FIN-0061: platform reads %', tb;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;

  -- The guarded currency change.
  PERFORM finance_set_currency(v, 'SAR');
  IF (SELECT (currency, currency_exponent) <> ('SAR', 2::smallint) FROM clinics WHERE id = v) THEN
    RAISE EXCEPTION 'FIN-0061: V did not become SAR / 2';
  END IF;
  BEGIN PERFORM finance_set_currency(t, 'SAR'); RAISE EXCEPTION 'FIN-0061: T with invoices changed currency';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'currency_locked' THEN RAISE EXCEPTION 'FIN-0061: T raised %', SQLERRM; END IF;
  END;
  BEGIN PERFORM finance_set_currency(v, 'XXX'); RAISE EXCEPTION 'FIN-0061: an unsupported code accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'currency_unsupported' THEN RAISE EXCEPTION 'FIN-0061: XXX raised %', SQLERRM; END IF;
  END;

  -- The direct path is closed; the platform's other clinic writes still work.
  BEGIN UPDATE clinics SET currency = 'SAR' WHERE id = u; RAISE EXCEPTION 'FIN-0061: platform set a currency directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE clinics SET status = 'suspended', currency_exponent = 2 WHERE id = u;
    RAISE EXCEPTION 'FIN-0061: platform set an exponent directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE clinics SET tax_rate_bp = 500, status = 'suspended', max_users = 12, updated_at = now() WHERE id = u;
END $$;
RESET ROLE;

-- A price locks the currency too (as the owner: the platform has no access to services).
UPDATE clinic_services SET price_minor = 1000 WHERE clinic_id = '00000000-0000-7000-8000-0000000f001c';
SET LOCAL ROLE eyadex_platform;
DO $$
BEGIN
  PERFORM finance_set_currency('00000000-0000-7000-8000-0000000f001c', 'KWD');
  RAISE EXCEPTION 'FIN-0061: a priced clinic changed currency';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'currency_locked' THEN RAISE EXCEPTION 'FIN-0061: V raised %', SQLERRM; END IF;
END $$;
RESET ROLE;

-- R1-17: an edit restates its month.
UPDATE invoices SET total_minor = 3000 WHERE id = '00000000-0000-7000-8000-0000000f0a02';
SET LOCAL ROLE eyadex_platform;
DO $$
BEGIN
  IF (SELECT invoiced_minor FROM finance_monthly_totals('00000000-0000-7000-8000-0000000f001a')
      WHERE month = '2026-10-01') <> 3000 THEN
    RAISE EXCEPTION 'FIN-0061: an edited total did not restate its month';
  END IF;
END $$;
RESET ROLE;

-- 0062 (plan Task 5, R2-7, C1): the patient link's lookup function, its owner and the sealed copy.
DO $$
BEGIN
  IF (SELECT rolcanlogin OR rolbypassrls FROM pg_roles WHERE rolname = 'eyadex_invoice_link_owner') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FIN-0062: the link owner can log in, bypass RLS, or is missing';
  END IF;
  IF has_column_privilege('eyadex_invoice_link_owner', 'invoice_links', 'token_sealed', 'SELECT')
     OR has_column_privilege('eyadex_invoice_link_owner', 'invoice_links', 'notification_id', 'SELECT')
     OR NOT has_column_privilege('eyadex_invoice_link_owner', 'invoice_links', 'token_hash', 'SELECT') THEN
    RAISE EXCEPTION 'FIN-0062: the link owner reads the wrong columns';
  END IF;
  IF has_table_privilege('eyadex_platform', 'invoice_links', 'SELECT')
     OR has_table_privilege('eyadex_app', 'invoice_links', 'DELETE')
     OR NOT has_table_privilege('eyadex_app', 'invoice_links', 'UPDATE') THEN
    RAISE EXCEPTION 'FIN-0062: wrong invoice_links grants';
  END IF;
  IF NOT has_function_privilege('eyadex_app', 'invoice_link_lookup(bytea)', 'EXECUTE')
     OR has_function_privilege('eyadex_platform', 'invoice_link_lookup(bytea)', 'EXECUTE')
     OR has_function_privilege('eyadex_auth', 'invoice_link_lookup(bytea)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FIN-0062: the lookup runs for the clinic API only';
  END IF;
END $$;

-- A live link, an expired one and a revoked one for clinic T's invoice, written by the owner role. The
-- expired link is on a second send and is NOT revoked, so only its expiry can keep it from resolving
-- (PR #78 review: it was revoked too, and the test passed without the expiry filter).
INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id, subject_at,
    status, send_request_id, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-0000000f001a', '00000000-0000-7000-8000-0000000f0c01',
    '00000000-0000-7000-8000-0000000f02a9', 'invoice', 'email', 'invoice', '00000000-0000-7000-8000-0000000f0a01',
    NULL, 'queued', gen_random_uuid(), now(), now()),
  ('00000000-0000-7000-8000-0000000f001a', '00000000-0000-7000-8000-0000000f0c02',
    '00000000-0000-7000-8000-0000000f02a9', 'invoice', 'email', 'invoice', '00000000-0000-7000-8000-0000000f0a01',
    NULL, 'queued', gen_random_uuid(), now(), now());
INSERT INTO invoice_links VALUES
  ('00000000-0000-7000-8000-0000000f001a', '00000000-0000-7000-8000-0000000f0d01', '00000000-0000-7000-8000-0000000f0a01',
   '00000000-0000-7000-8000-0000000f0c01', sha256(convert_to('live', 'UTF8')), 'v1.iv.body.tag', now() + interval '14 days', null, now()),
  ('00000000-0000-7000-8000-0000000f001a', '00000000-0000-7000-8000-0000000f0d02', '00000000-0000-7000-8000-0000000f0a01',
   '00000000-0000-7000-8000-0000000f0c02', sha256(convert_to('expired', 'UTF8')), 'v1.iv.body.tag', now() - interval '1 minute', null, now()),
  ('00000000-0000-7000-8000-0000000f001a', '00000000-0000-7000-8000-0000000f0d03', '00000000-0000-7000-8000-0000000f0a01',
   '00000000-0000-7000-8000-0000000f0c01', sha256(convert_to('revoked', 'UTF8')), 'v1.iv.body.tag', now() + interval '14 days', now(), now());
DO $$
BEGIN
  -- One live link per notification: a second live one is refused; revoked ones never count.
  BEGIN
    INSERT INTO invoice_links VALUES ('00000000-0000-7000-8000-0000000f001a', gen_random_uuid(),
      '00000000-0000-7000-8000-0000000f0a01', '00000000-0000-7000-8000-0000000f0c01',
      sha256(convert_to('second', 'UTF8')), 'v1.iv.body.tag', now() + interval '14 days', null, now());
    RAISE EXCEPTION 'FIN-0062: two live links for one notification';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO invoice_links VALUES ('00000000-0000-7000-8000-0000000f001a', gen_random_uuid(),
      '00000000-0000-7000-8000-0000000f0a01', '00000000-0000-7000-8000-0000000f0c01',
      sha256(convert_to('plain', 'UTF8')), 'plain-token', now() + interval '14 days', now(), now());
    RAISE EXCEPTION 'FIN-0062: an unsealed token was stored';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO invoice_links VALUES ('00000000-0000-7000-8000-0000000f001a', gen_random_uuid(),
      '00000000-0000-7000-8000-0000000f0a01', '00000000-0000-7000-8000-0000000f0c01',
      convert_to('short', 'UTF8'), 'v1.iv.body.tag', now() + interval '14 days', now(), now());
    RAISE EXCEPTION 'FIN-0062: a token hash that is not 32 bytes was stored';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- The clinic API, before it knows the clinic (no app.clinic_id), finds only the live link.
SET LOCAL ROLE eyadex_app;
DO $$
DECLARE r record; n bigint;
BEGIN
  SELECT * INTO r FROM invoice_link_lookup(sha256(convert_to('live', 'UTF8')));
  IF r.clinic_id IS DISTINCT FROM '00000000-0000-7000-8000-0000000f001a'::uuid
     OR r.invoice_id IS DISTINCT FROM '00000000-0000-7000-8000-0000000f0a01'::uuid
     OR r.link_id IS DISTINCT FROM '00000000-0000-7000-8000-0000000f0d01'::uuid THEN
    RAISE EXCEPTION 'FIN-0062: the live link resolved to %', r;
  END IF;
  SELECT count(*) INTO n FROM invoice_link_lookup(sha256(convert_to('expired', 'UTF8')));
  IF n <> 0 THEN RAISE EXCEPTION 'FIN-0062: an expired link resolved'; END IF;
  SELECT count(*) INTO n FROM invoice_link_lookup(sha256(convert_to('revoked', 'UTF8')));
  IF n <> 0 THEN RAISE EXCEPTION 'FIN-0062: a revoked link resolved'; END IF;
  SELECT count(*) INTO n FROM invoice_link_lookup(sha256(convert_to('unknown', 'UTF8')));
  IF n <> 0 THEN RAISE EXCEPTION 'FIN-0062: an unknown token resolved'; END IF;
  -- Without a clinic context the table itself shows nothing.
  SELECT count(*) INTO n FROM invoice_links;
  IF n <> 0 THEN RAISE EXCEPTION 'FIN-0062: invoice_links visible without a clinic'; END IF;
END $$;
RESET ROLE;

-- Finance F2 (spec §4.2, §4.3, §4.4; 0064, 0066): the money rows, the schema's own rules and the
-- commit-time checks. The fixture is written by the owner role; the rules run as the clinic role.
INSERT INTO branches VALUES ('00000000-0000-7000-8000-0000000f000a','00000000-0000-7000-8000-0000000f0012','ف','B2',true,now(),now());
INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
    civil_id_enc, civil_id_hmac, civil_id_last4, status, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-0000000f000a','00000000-0000-7000-8000-0000000f0019','2','x','+96500000019','1990-01-01','male',
    '00000000-0000-7000-8000-0000000f0002','f1.1.iv.body.tag',repeat('e',64),'0000','active',now(),now());
INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status, source, source_id,
    issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp, tax_minor, total_minor,
    created_by, created_at, updated_at)
  VALUES
  ('00000000-0000-7000-8000-0000000f000a','00000000-0000-7000-8000-0000000f0401','00000000-0000-7000-8000-0000000f0002','00000000-0000-7000-8000-0000000f0009',2026,101,'SAL-2026-000101','issued','manual',null,
    now(),'KWD',3,10000,0,0,0,10000,'00000000-0000-7000-8000-0000000f0005',now(),now()),
  ('00000000-0000-7000-8000-0000000f000a','00000000-0000-7000-8000-0000000f0402','00000000-0000-7000-8000-0000000f0002','00000000-0000-7000-8000-0000000f0009',2026,102,'SAL-2026-000102','issued','manual',null,
    now(),'KWD',3,5000,0,0,0,5000,'00000000-0000-7000-8000-0000000f0005',now(),now()),
  ('00000000-0000-7000-8000-0000000f000a','00000000-0000-7000-8000-0000000f0403','00000000-0000-7000-8000-0000000f0002','00000000-0000-7000-8000-0000000f0019',2026,103,'SAL-2026-000103','issued','manual',null,
    now(),'KWD',3,5000,0,0,0,5000,'00000000-0000-7000-8000-0000000f0005',now(),now());

SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000f000a';

-- The schema's own rules on the F2 money rows (0064, spec §4.2). Every row that survives its own check is
-- undone, so 0066's commit-time checks never see it.
DO $$
DECLARE c uuid := '00000000-0000-7000-8000-0000000f000a';
  br uuid := '00000000-0000-7000-8000-0000000f0002'; br2 uuid := '00000000-0000-7000-8000-0000000f0012';
  pt uuid := '00000000-0000-7000-8000-0000000f0009';
  mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  i3 uuid := '00000000-0000-7000-8000-0000000f0403';
  p uuid := gen_random_uuid(); a1 uuid := gen_random_uuid(); c1 uuid := gen_random_uuid();
  k uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); k3 uuid := gen_random_uuid();
  k4 uuid := gen_random_uuid(); k5 uuid := gen_random_uuid();
BEGIN
  -- A payment cannot name another patient's invoice: the money carries the patient through its keys.
  BEGIN
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, gen_random_uuid(), br, pt, i3, 2026, 1, 'SAL-R-2026-000001', 'knet', 1000, 'KWD', 3, null, now(),
        current_date, null, mb, now());
    RAISE EXCEPTION 'FIN-F2: a payment named another patient''s invoice';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;

  -- Money is received in the invoice's branch (F2-Q8): a payment or a refund cannot name another one.
  BEGIN
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, gen_random_uuid(), br2, pt, i1, 2026, 21, 'SAL-R-2026-000021', 'knet', 1000, 'KWD', 3, null, now(),
        current_date, null, mb, now());
    RAISE EXCEPTION 'FIN-F2: a payment in another branch than its invoice accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
        amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
      VALUES (c, gen_random_uuid(), br2, pt, i1, 2026, 21, 'SAL-RF-2026-000021', 'knet', 1000, 'KWD', 3, 'x', now(),
        current_date, null, mb, now());
    RAISE EXCEPTION 'FIN-F2: a refund in another branch than its invoice accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;

  -- An allocation is funded by exactly one payment or one credit.
  BEGIN
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 1, 'SAL-R-2026-000002', 'knet', 1000, 'KWD', 3, null, now(), current_date, null, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a1, i1, pt, p, null, 1000, mb, now());
    INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
      VALUES (c, c1, pt, a1, 1000, 'refund', mb, now());
    BEGIN
      INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
        VALUES (c, gen_random_uuid(), i1, pt, p, c1, 1000, mb, now());
      RAISE EXCEPTION 'FIN-F2: an allocation with two funding sources was accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'EYT01';
  EXCEPTION WHEN SQLSTATE 'EYT01' THEN NULL; END;
  BEGIN
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, gen_random_uuid(), i1, pt, null, null, 1000, mb, now());
    RAISE EXCEPTION 'FIN-F2: an allocation with no funding source was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- Cash is exactly the cash movements: the number is there for cash and only for cash.
  BEGIN
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, gen_random_uuid(), br, pt, i1, 2026, 3, 'SAL-R-2026-000003', 'cash', 1000, 'KWD', 3, null, now(),
        current_date, null, mb, now());
    RAISE EXCEPTION 'FIN-F2: a cash payment without a cash number was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, gen_random_uuid(), br, pt, i1, 2026, 4, 'SAL-R-2026-000004', 'knet', 1000, 'KWD', 3, null, now(),
        current_date, 1, mb, now());
    RAISE EXCEPTION 'FIN-F2: a non-cash payment with a cash number was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
        amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
      VALUES (c, gen_random_uuid(), br, pt, i1, 2026, 3, 'SAL-RF-2026-000003', 'cash', 1000, 'KWD', 3, 'x', now(),
        current_date, null, mb, now());
    RAISE EXCEPTION 'FIN-F2: a cash refund without a cash number was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
        amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
      VALUES (c, gen_random_uuid(), br, pt, i1, 2026, 4, 'SAL-RF-2026-000004', 'knet', 1000, 'KWD', 3, 'x', now(),
        current_date, 1, mb, now());
    RAISE EXCEPTION 'FIN-F2: a non-cash refund with a cash number was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- One number per receipt and one per refund.
  BEGIN
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, gen_random_uuid(), br, pt, i1, 2026, 1, 'SAL-R-2026-000001', 'knet', 1000, 'KWD', 3, null, now(),
        current_date, null, mb, now());
    BEGIN
      INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
          amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
        VALUES (c, gen_random_uuid(), br, pt, i1, 2026, 2, 'SAL-R-2026-000001', 'knet', 1000, 'KWD', 3, null, now(),
          current_date, null, mb, now());
      RAISE EXCEPTION 'FIN-F2: a duplicate receipt number was accepted';
    EXCEPTION WHEN unique_violation THEN NULL; END;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'EYT01';
  EXCEPTION WHEN SQLSTATE 'EYT01' THEN NULL; END;
  BEGIN
    INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
        amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
      VALUES (c, gen_random_uuid(), br, pt, i1, 2026, 1, 'SAL-RF-2026-000001', 'knet', 1000, 'KWD', 3, 'x', now(),
        current_date, null, mb, now());
    BEGIN
      INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
          amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
        VALUES (c, gen_random_uuid(), br, pt, i1, 2026, 2, 'SAL-RF-2026-000001', 'knet', 1000, 'KWD', 3, 'x', now(),
          current_date, null, mb, now());
      RAISE EXCEPTION 'FIN-F2: a duplicate refund number was accepted';
    EXCEPTION WHEN unique_violation THEN NULL; END;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'EYT01';
  EXCEPTION WHEN SQLSTATE 'EYT01' THEN NULL; END;

  -- A cash number is handed out once per branch.
  BEGIN
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, gen_random_uuid(), br, pt, i1, 2026, 11, 'SAL-R-2026-000011', 'cash', 1000, 'KWD', 3, null, now(),
        current_date, 1, mb, now());
    BEGIN
      INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
          amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
        VALUES (c, gen_random_uuid(), br, pt, i1, 2026, 12, 'SAL-R-2026-000012', 'cash', 1000, 'KWD', 3, null, now(),
          current_date, 1, mb, now());
      RAISE EXCEPTION 'FIN-F2: a cash number was handed out twice in one branch';
    EXCEPTION WHEN unique_violation THEN NULL; END;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'EYT01';
  EXCEPTION WHEN SQLSTATE 'EYT01' THEN NULL; END;

  -- The difference is computed, and a count that differs from the expectation needs a note (F2-Q11).
  BEGIN
    INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
        counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
      VALUES (c, k, br, current_date, 0, 0, 1000, 900, '[]'::jsonb, 'short', null, 'KWD', 3, mb, now(), now());
    IF (SELECT difference_minor FROM cash_closings WHERE id = k) <> -100 THEN
      RAISE EXCEPTION 'FIN-F2: the difference is not the counted amount minus the expected one';
    END IF;
    BEGIN
      INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
          counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
        VALUES (c, gen_random_uuid(), br, current_date + 2, 0, 0, 1000, 900, '[]'::jsonb, null, k, 'KWD', 3, mb, now(), now());
      RAISE EXCEPTION 'FIN-F2: a difference without a note was accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
        counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
      VALUES (c, k2, br, current_date + 1, 0, 0, 1000, 1000, '[]'::jsonb, null, k, 'KWD', 3, mb, now(), now());
    RAISE EXCEPTION 'undo' USING ERRCODE = 'EYT01';
  EXCEPTION WHEN SQLSTATE 'EYT01' THEN NULL; END;

  -- The counted and expected amounts are bounded so the difference always fits a bigint (PR #89 review).
  BEGIN
    INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
        counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
      VALUES (c, k, br, current_date, 0, 0, -1000000000000000000, 1000000000000000000, '[]'::jsonb, 'wide', null, 'KWD', 3, mb, now(), now());
    IF (SELECT difference_minor FROM cash_closings WHERE id = k) <> 2000000000000000000 THEN
      RAISE EXCEPTION 'FIN-F2: the difference of the widest amounts is wrong';
    END IF;
    BEGIN
      INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
          counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
        VALUES (c, gen_random_uuid(), br, current_date + 1, 0, 0, 0, 1000000000000000001, '[]'::jsonb, 'x', k, 'KWD', 3, mb, now(), now());
      RAISE EXCEPTION 'FIN-F2: a counted amount above the bound was accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
      INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
          counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
        VALUES (c, gen_random_uuid(), br, current_date + 2, 0, 0, -1000000000000000001, 0, '[]'::jsonb, 'x', k, 'KWD', 3, mb, now(), now());
      RAISE EXCEPTION 'FIN-F2: an expected amount below the bound was accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
      INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
          counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
        VALUES (c, gen_random_uuid(), br, current_date + 3, 0, 0, 1000000000000000001, 0, '[]'::jsonb, 'x', k, 'KWD', 3, mb, now(), now());
      RAISE EXCEPTION 'FIN-F2: an expected amount above the bound was accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'EYT01';
  EXCEPTION WHEN SQLSTATE 'EYT01' THEN NULL; END;

  -- The closings of a branch chain by id (R3-3, F2-Q9): one chain, one day, one branch.
  BEGIN
    INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
        counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
      VALUES (c, k, br, current_date, 0, 0, 0, 0, '[]'::jsonb, null, null, 'KWD', 3, mb, now(), now());
    BEGIN
      INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
          counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
        VALUES (c, k2, br, current_date + 1, 0, 0, 0, 0, '[]'::jsonb, null, null, 'KWD', 3, mb, now(), now());
      RAISE EXCEPTION 'FIN-F2: a second closing without a previous one was accepted';
    EXCEPTION WHEN unique_violation THEN NULL; END;
    BEGIN
      INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
          counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
        VALUES (c, k3, br2, current_date + 2, 0, 0, 0, 0, '[]'::jsonb, null, k, 'KWD', 3, mb, now(), now());
      RAISE EXCEPTION 'FIN-F2: a closing chained to another branch''s closing was accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
        counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
      VALUES (c, k4, br, current_date + 3, 0, 0, 0, 0, '[]'::jsonb, null, k, 'KWD', 3, mb, now(), now());
    BEGIN
      INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
          counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
        VALUES (c, k5, br, current_date, 0, 0, 0, 0, '[]'::jsonb, null, k4, 'KWD', 3, mb, now(), now());
      RAISE EXCEPTION 'FIN-F2: two closings of one branch on one day were accepted';
    EXCEPTION WHEN unique_violation THEN NULL; END;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'EYT01';
  EXCEPTION WHEN SQLSTATE 'EYT01' THEN NULL; END;

  -- A closing's period cannot run backwards.
  BEGIN
    INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
        counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
      VALUES (c, k, br, current_date, 5, 4, 0, 0, '[]'::jsonb, null, null, 'KWD', 3, mb, now(), now());
    RAISE EXCEPTION 'FIN-F2: a closing period that runs backwards was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- 0066 (spec §4.3, §4.4; R3-1, R3-2, #91): the commit-time checks. The checks are deferred constraint
-- triggers, so each case fires them with SET CONSTRAINTS ALL IMMEDIATE — and the clinic context is cleared
-- first (R3-1: withTenant clears app.clinic_id before COMMIT, so the checks must not depend on it).
-- payment_released (#91) and conservation follow from the checks before them, so no case can make them the
-- first refusal; they stay as the spec's defence in depth.

-- M1 accepted: the worked example S1 + S2 (§4.3) — a cash payment and a KNET one fill the invoice.
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO branch_cash_drawers (clinic_id, id, branch_id, last_cash_seq, last_closed_seq, last_closing_id, created_at, updated_at)
      VALUES (c, gen_random_uuid(), br, 1, 0, null, now(), now());
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p1, br, pt, i1, 2026, 1, 'SAL-R-2026-000011', 'cash', 4000, 'KWD', 3, null, now(), current_date, 1, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a1, i1, pt, p1, null, 4000, mb, now());
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p2, br, pt, i1, 2026, 2, 'SAL-R-2026-000012', 'knet', 6000, 'KWD', 3, null, now(), current_date, null, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a2, i1, pt, p2, null, 6000, mb, now());
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'undo' USING ERRCODE = 'EYT01';
  EXCEPTION WHEN SQLSTATE 'EYT01' THEN NULL;
    WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      RAISE EXCEPTION 'FIN-0066: M1 was refused (% / %)', msg, det;
  END;
END $$;

-- M2 'payment_allocated': a payment is placed in full when it is written (§4.3 invariant 2, F2-Q1).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 1, 'SAL-R-2026-000021', 'knet', 4000, 'KWD', 3, null, now(), current_date, null, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i1, pt, p, null, 3000, mb, now());
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'FIN-0066: M2 was accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
    IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'payment_allocated' THEN
      RAISE EXCEPTION 'FIN-0066: M2 raised % / %, expected finance_invariant / payment_allocated', msg, det;
    END IF;
  END;
END $$;

-- M3 'invoice_paid': an issued invoice holds at most its total (§4.3 invariant 3).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i2 uuid := '00000000-0000-7000-8000-0000000f0402';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i2, 2026, 1, 'SAL-R-2026-000031', 'knet', 6000, 'KWD', 3, null, now(), current_date, null, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i2, pt, p, null, 6000, mb, now());
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'FIN-0066: M3 was accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
    IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'invoice_paid' THEN
      RAISE EXCEPTION 'FIN-0066: M3 raised % / %, expected finance_invariant / invoice_paid', msg, det;
    END IF;
  END;
END $$;

-- M4 'refund_sources': a refund is covered exactly by the credits it spent (R3-2).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); cr uuid := gen_random_uuid(); f uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 1, 'SAL-R-2026-000041', 'knet', 4000, 'KWD', 3, null, now(), current_date, null, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i1, pt, p, null, 4000, mb, now());
    INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
      VALUES (c, cr, pt, a, 1000, 'refund', mb, now());
    INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
        amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
      VALUES (c, f, br, pt, i1, 2026, 1, 'SAL-RF-2026-000041', 'knet', 1000, 'KWD', 3, 'x', now(), current_date, null, mb, now());
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'FIN-0066: M4 was accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
    IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'refund_sources' THEN
      RAISE EXCEPTION 'FIN-0066: M4 raised % / %, expected finance_invariant / refund_sources', msg, det;
    END IF;
  END;
END $$;

-- M5 'refund_sources': the sources of a refund do not sum to its amount (R3-2).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); cr uuid := gen_random_uuid();
  f uuid := gen_random_uuid(); s uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 1, 'SAL-R-2026-000051', 'knet', 4000, 'KWD', 3, null, now(), current_date, null, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i1, pt, p, null, 4000, mb, now());
    INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
      VALUES (c, cr, pt, a, 1000, 'refund', mb, now());
    INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
        amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
      VALUES (c, f, br, pt, i1, 2026, 1, 'SAL-RF-2026-000051', 'knet', 1000, 'KWD', 3, 'x', now(), current_date, null, mb, now());
    INSERT INTO refund_sources (clinic_id, id, refund_id, credit_id, patient_id, amount_minor, created_at)
      VALUES (c, s, f, cr, pt, 600, now());
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'FIN-0066: M5 was accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
    IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'refund_sources' THEN
      RAISE EXCEPTION 'FIN-0066: M5 raised % / %, expected finance_invariant / refund_sources', msg, det;
    END IF;
  END;
END $$;

-- M6 'allocation_live': a payment's allocations never release more than the payment (#91).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  cr1 uuid := gen_random_uuid(); cr2 uuid := gen_random_uuid();
  f1 uuid := gen_random_uuid(); f2 uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 1, 'SAL-R-2026-000061', 'knet', 1000, 'KWD', 3, null, now(), current_date, null, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i1, pt, p, null, 1000, mb, now());
    INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
      VALUES (c, cr1, pt, a, 1000, 'refund', mb, now());
    INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
        amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
      VALUES (c, f1, br, pt, i1, 2026, 1, 'SAL-RF-2026-000061', 'knet', 1000, 'KWD', 3, 'x', now(), current_date, null, mb, now());
    INSERT INTO refund_sources (clinic_id, id, refund_id, credit_id, patient_id, amount_minor, created_at)
      VALUES (c, s1, f1, cr1, pt, 1000, now());
    INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
      VALUES (c, cr2, pt, a, 500, 'refund', mb, now());
    INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
        amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
      VALUES (c, f2, br, pt, i1, 2026, 2, 'SAL-RF-2026-000062', 'knet', 500, 'KWD', 3, 'x', now(), current_date, null, mb, now());
    INSERT INTO refund_sources (clinic_id, id, refund_id, credit_id, patient_id, amount_minor, created_at)
      VALUES (c, s2, f2, cr2, pt, 500, now());
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'FIN-0066: M6 was accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
    IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'allocation_live' THEN
      RAISE EXCEPTION 'FIN-0066: M6 raised % / %, expected finance_invariant / allocation_live', msg, det;
    END IF;
  END;
END $$;

-- M7 'credit_remaining': a credit is never spent beyond its amount (§4.3 invariant 1).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401'; i2 uuid := '00000000-0000-7000-8000-0000000f0402';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); a2 uuid := gen_random_uuid();
  cr uuid := gen_random_uuid(); f uuid := gen_random_uuid(); s uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 1, 'SAL-R-2026-000071', 'knet', 1000, 'KWD', 3, null, now(), current_date, null, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i1, pt, p, null, 1000, mb, now());
    INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
      VALUES (c, cr, pt, a, 1000, 'invoice_edited', mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a2, i2, pt, null, cr, 800, mb, now());
    INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
        amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
      VALUES (c, f, br, pt, i1, 2026, 1, 'SAL-RF-2026-000071', 'knet', 300, 'KWD', 3, 'x', now(), current_date, null, mb, now());
    INSERT INTO refund_sources (clinic_id, id, refund_id, credit_id, patient_id, amount_minor, created_at)
      VALUES (c, s, f, cr, pt, 300, now());
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'FIN-0066: M7 was accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
    IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'credit_remaining' THEN
      RAISE EXCEPTION 'FIN-0066: M7 raised % / %, expected finance_invariant / credit_remaining', msg, det;
    END IF;
  END;
END $$;

-- M8 'invoice_paid': a lowered invoice releases the excess into credit, so the invoice cannot hold more.
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 1, 'SAL-R-2026-000081', 'knet', 4000, 'KWD', 3, null, now(), current_date, null, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i1, pt, p, null, 4000, mb, now());
    UPDATE invoices SET total_minor = 3000 WHERE id = i1;
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'FIN-0066: M8 was accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
    IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'invoice_paid' THEN
      RAISE EXCEPTION 'FIN-0066: M8 raised % / %, expected finance_invariant / invoice_paid', msg, det;
    END IF;
  END;
END $$;

-- M9 'invoice_paid': a void invoice holds nothing, so it must release its money first.
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 1, 'SAL-R-2026-000091', 'knet', 4000, 'KWD', 3, null, now(), current_date, null, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i1, pt, p, null, 4000, mb, now());
    UPDATE invoices SET status = 'void', voided_at = now(), void_reason = 'x' WHERE id = i1;
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'FIN-0066: M9 was accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
    IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'invoice_paid' THEN
      RAISE EXCEPTION 'FIN-0066: M9 raised % / %, expected finance_invariant / invoice_paid', msg, det;
    END IF;
  END;
END $$;

-- M10 accepted: as M9, plus the credit the void released (R2-2).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); cr uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 1, 'SAL-R-2026-000101', 'knet', 4000, 'KWD', 3, null, now(), current_date, null, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i1, pt, p, null, 4000, mb, now());
    UPDATE invoices SET status = 'void', voided_at = now(), void_reason = 'x' WHERE id = i1;
    INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
      VALUES (c, cr, pt, a, 4000, 'invoice_voided', mb, now());
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'undo' USING ERRCODE = 'EYT01';
  EXCEPTION WHEN SQLSTATE 'EYT01' THEN NULL;
    WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      RAISE EXCEPTION 'FIN-0066: M10 was refused (% / %)', msg, det;
  END;
END $$;

-- M11 accepted: the worked example S8 (§4.3) — a refund out of a released allocation, in cash.
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); cr uuid := gen_random_uuid();
  f uuid := gen_random_uuid(); s uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO branch_cash_drawers (clinic_id, id, branch_id, last_cash_seq, last_closed_seq, last_closing_id, created_at, updated_at)
      VALUES (c, gen_random_uuid(), br, 1, 0, null, now(), now());
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 1, 'SAL-R-2026-000011', 'knet', 4000, 'KWD', 3, null, now(), current_date, null, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i1, pt, p, null, 4000, mb, now());
    INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
      VALUES (c, cr, pt, a, 1000, 'refund', mb, now());
    INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
        amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
      VALUES (c, f, br, pt, i1, 2026, 1, 'SAL-RF-2026-000011', 'cash', 1000, 'KWD', 3, 'x', now(), current_date, 1, mb, now());
    INSERT INTO refund_sources (clinic_id, id, refund_id, credit_id, patient_id, amount_minor, created_at)
      VALUES (c, s, f, cr, pt, 1000, now());
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'undo' USING ERRCODE = 'EYT01';
  EXCEPTION WHEN SQLSTATE 'EYT01' THEN NULL;
    WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      RAISE EXCEPTION 'FIN-0066: M11 was refused (% / %)', msg, det;
  END;
END $$;

-- M12 'cash_seq_taken': a cash number is held by one movement only (PR #89 review).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); cr uuid := gen_random_uuid();
  f uuid := gen_random_uuid(); s uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO branch_cash_drawers (clinic_id, id, branch_id, last_cash_seq, last_closed_seq, last_closing_id, created_at, updated_at)
      VALUES (c, gen_random_uuid(), br, 1, 0, null, now(), now());
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 1, 'SAL-R-2026-000121', 'cash', 1000, 'KWD', 3, null, now(), current_date, 1, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i1, pt, p, null, 1000, mb, now());
    INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
      VALUES (c, cr, pt, a, 1000, 'refund', mb, now());
    INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
        amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
      VALUES (c, f, br, pt, i1, 2026, 1, 'SAL-RF-2026-000121', 'cash', 1000, 'KWD', 3, 'x', now(), current_date, 1, mb, now());
    INSERT INTO refund_sources (clinic_id, id, refund_id, credit_id, patient_id, amount_minor, created_at)
      VALUES (c, s, f, cr, pt, 1000, now());
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'FIN-0066: M12 was accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
    IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'cash_seq_taken' THEN
      RAISE EXCEPTION 'FIN-0066: M12 raised % / %, expected finance_invariant / cash_seq_taken', msg, det;
    END IF;
  END;
END $$;

-- M13 'cash_seq_gap': a cash number leaves a hole (PR #89 review).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO branch_cash_drawers (clinic_id, id, branch_id, last_cash_seq, last_closed_seq, last_closing_id, created_at, updated_at)
      VALUES (c, gen_random_uuid(), br, 2, 0, null, now(), now());
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 1, 'SAL-R-2026-000131', 'cash', 1000, 'KWD', 3, null, now(), current_date, 2, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i1, pt, p, null, 1000, mb, now());
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'FIN-0066: M13 was accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
    IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'cash_seq_gap' THEN
      RAISE EXCEPTION 'FIN-0066: M13 raised % / %, expected finance_invariant / cash_seq_gap', msg, det;
    END IF;
  END;
END $$;

-- M14 'cash_seq_drawer': a cash number comes from the drawer (PR #89 review).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO branch_cash_drawers (clinic_id, id, branch_id, last_cash_seq, last_closed_seq, last_closing_id, created_at, updated_at)
      VALUES (c, gen_random_uuid(), br, 0, 0, null, now(), now());
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 1, 'SAL-R-2026-000141', 'cash', 1000, 'KWD', 3, null, now(), current_date, 1, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i1, pt, p, null, 1000, mb, now());
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'FIN-0066: M14 was accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
    IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'cash_seq_drawer' THEN
      RAISE EXCEPTION 'FIN-0066: M14 raised % / %, expected finance_invariant / cash_seq_drawer', msg, det;
    END IF;
  END;
END $$;

-- M15 'cash_closing_expected': the expected amount is the cash received minus the cash refunded (F2-Q10).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); k uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 1, 'SAL-R-2026-000151', 'cash', 1000, 'KWD', 3, null, now(), current_date, 1, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i1, pt, p, null, 1000, mb, now());
    INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
        counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
      VALUES (c, k, br, current_date, 0, 1, 900, 900, '[]'::jsonb, null, null, 'KWD', 3, mb, now(), now());
    INSERT INTO branch_cash_drawers (clinic_id, id, branch_id, last_cash_seq, last_closed_seq, last_closing_id, created_at, updated_at)
      VALUES (c, gen_random_uuid(), br, 1, 1, k, now(), now());
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'FIN-0066: M15 was accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
    IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'cash_closing_expected' THEN
      RAISE EXCEPTION 'FIN-0066: M15 raised % / %, expected finance_invariant / cash_closing_expected', msg, det;
    END IF;
  END;
END $$;

-- M16 'cash_closing_period': a closing starts where the previous one ended (R3-3, §4.4).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); k uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 1, 'SAL-R-2026-000161', 'cash', 1000, 'KWD', 3, null, now(), current_date, 1, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i1, pt, p, null, 1000, mb, now());
    INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
        counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
      VALUES (c, k, br, current_date, 1, 1, 0, 0, '[]'::jsonb, null, null, 'KWD', 3, mb, now(), now());
    INSERT INTO branch_cash_drawers (clinic_id, id, branch_id, last_cash_seq, last_closed_seq, last_closing_id, created_at, updated_at)
      VALUES (c, gen_random_uuid(), br, 1, 1, k, now(), now());
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'FIN-0066: M16 was accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
    IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'cash_closing_period' THEN
      RAISE EXCEPTION 'FIN-0066: M16 raised % / %, expected finance_invariant / cash_closing_period', msg, det;
    END IF;
  END;
END $$;

-- M17 'cash_closing_drawer': the drawer records the closing as its last.
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); k uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 1, 'SAL-R-2026-000171', 'cash', 1000, 'KWD', 3, null, now(), current_date, 1, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i1, pt, p, null, 1000, mb, now());
    INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
        counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
      VALUES (c, k, br, current_date, 0, 1, 1000, 1000, '[]'::jsonb, null, null, 'KWD', 3, mb, now(), now());
    INSERT INTO branch_cash_drawers (clinic_id, id, branch_id, last_cash_seq, last_closed_seq, last_closing_id, created_at, updated_at)
      VALUES (c, gen_random_uuid(), br, 1, 0, null, now(), now());
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'FIN-0066: M17 was accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
    IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'cash_closing_drawer' THEN
      RAISE EXCEPTION 'FIN-0066: M17 raised % / %, expected finance_invariant / cash_closing_drawer', msg, det;
    END IF;
  END;
END $$;

-- M18 accepted: two closings in a row with no cash between them (R3-3). They are two transactions in real
-- use, and a closing's check needs the drawer to name it as its last, so the checks fire after each one.
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 1, 'SAL-R-2026-000181', 'cash', 1000, 'KWD', 3, null, now(), current_date, 1, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i1, pt, p, null, 1000, mb, now());
    INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
        counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
      VALUES (c, k1, br, current_date, 0, 1, 1000, 1000, '[]'::jsonb, null, null, 'KWD', 3, mb, now(), now());
    INSERT INTO branch_cash_drawers (clinic_id, id, branch_id, last_cash_seq, last_closed_seq, last_closing_id, created_at, updated_at)
      VALUES (c, gen_random_uuid(), br, 1, 1, k1, now(), now());
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
        counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
      VALUES (c, k2, br, current_date + 1, 1, 1, 0, 0, '[]'::jsonb, null, k1, 'KWD', 3, mb, now(), now());
    UPDATE branch_cash_drawers SET last_closing_id = k2, updated_at = now() WHERE branch_id = br;
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'undo' USING ERRCODE = 'EYT01';
  EXCEPTION WHEN SQLSTATE 'EYT01' THEN NULL;
    WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      RAISE EXCEPTION 'FIN-0066: M18 was refused (% / %)', msg, det;
  END;
END $$;

-- M19 'cash_drawer_closing': the drawer's closed position is its last closing's end, and no closing
-- follows that one (R3-3). The drawer's own check is the only one that can refuse here, so the case
-- pins it alone: step 1 is a correct cash payment, its allocation, a valid closing and the drawer
-- that names it; step 2 moves the drawer's closed position back without moving the closing.
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); k uuid := gen_random_uuid();
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, p, br, pt, i1, 2026, 19, 'SAL-R-2026-000219', 'cash', 1000, 'KWD', 3, null, now(), current_date, 1, mb, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, a, i1, pt, p, null, 1000, mb, now());
    INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
        counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
      VALUES (c, k, br, current_date, 0, 1, 1000, 1000, '[]'::jsonb, null, null, 'KWD', 3, mb, now(), now());
    INSERT INTO branch_cash_drawers (clinic_id, id, branch_id, last_cash_seq, last_closed_seq, last_closing_id, created_at, updated_at)
      VALUES (c, gen_random_uuid(), br, 1, 1, k, now(), now());
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
    EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
    UPDATE branch_cash_drawers SET last_closed_seq = 0, updated_at = now() WHERE branch_id = br;
    PERFORM set_config('app.clinic_id', '', true);
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    RAISE EXCEPTION 'FIN-0066: M19 was accepted';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
    IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'cash_drawer_closing' THEN
      RAISE EXCEPTION 'FIN-0066: M19 raised % / %, expected finance_invariant / cash_drawer_closing', msg, det;
    END IF;
  END;
END $$;

-- 0066, one trigger at a time (FIN-0066-ONE): a check is only pinned when the trigger that carries it
-- is the only one that can fire. Each case writes a correct set of rows first and fires them (that must
-- pass), then writes ONE row of ONE table that breaks an invariant, and fires again: only the trigger of
-- that table is pending, so only that check can refuse. The rows of the first step stay (they are the
-- patient's money the second step breaks), so every case builds on the ones before it.
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid();
BEGIN
  BEGIN
    BEGIN
      EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
      PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
      INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
          amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
        VALUES (c, p1, br, pt, i1, 2026, 11, 'SAL-R-2026-000211', 'knet', 1000, 'KWD', 3, null, now(), current_date, null, mb, now());
      INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
        VALUES (c, a1, i1, pt, p1, null, 1000, mb, now());
      PERFORM set_config('app.clinic_id', '', true);
      EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      RAISE EXCEPTION 'FIN-0066-ONE: T1 step 1 was refused: % / %', msg, det;
    END;
    BEGIN
      PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
      EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
      INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
          amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
        VALUES (c, p2, br, pt, i1, 2026, 12, 'SAL-R-2026-000212', 'knet', 500, 'KWD', 3, null, now(), current_date, null, mb, now());
      PERFORM set_config('app.clinic_id', '', true);
      EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
      RAISE EXCEPTION 'FIN-0066-ONE: T1 was accepted';
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      IF msg = 'FIN-0066-ONE: T1 was accepted' THEN
        RAISE EXCEPTION 'FIN-0066-ONE: T1 was accepted';
      END IF;
      IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'payment_allocated' THEN
        RAISE EXCEPTION 'FIN-0066-ONE: T1 raised % / %, expected finance_invariant / payment_allocated', msg, det;
      END IF;
    END;
  END;
END $$;

-- T2 payment_allocations_money_check: an allocation funded by a credit spends it, and a credit is never
-- spent beyond its amount (§4.3 invariant 1).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401'; i2 uuid := '00000000-0000-7000-8000-0000000f0402';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); cr uuid := gen_random_uuid(); a2 uuid := gen_random_uuid();
BEGIN
  BEGIN
    BEGIN
      EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
      PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
      INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
          amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
        VALUES (c, p, br, pt, i1, 2026, 13, 'SAL-R-2026-000213', 'knet', 1000, 'KWD', 3, null, now(), current_date, null, mb, now());
      INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
        VALUES (c, a, i1, pt, p, null, 1000, mb, now());
      INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
        VALUES (c, cr, pt, a, 1000, 'invoice_edited', mb, now());
      PERFORM set_config('app.clinic_id', '', true);
      EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      RAISE EXCEPTION 'FIN-0066-ONE: T2 step 1 was refused: % / %', msg, det;
    END;
    BEGIN
      PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
      EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
      INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
        VALUES (c, a2, i2, pt, null, cr, 1500, mb, now());
      PERFORM set_config('app.clinic_id', '', true);
      EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
      RAISE EXCEPTION 'FIN-0066-ONE: T2 was accepted';
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      IF msg = 'FIN-0066-ONE: T2 was accepted' THEN
        RAISE EXCEPTION 'FIN-0066-ONE: T2 was accepted';
      END IF;
      IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'credit_remaining' THEN
        RAISE EXCEPTION 'FIN-0066-ONE: T2 raised % / %, expected finance_invariant / credit_remaining', msg, det;
      END IF;
    END;
  END;
END $$;

-- T3 patient_credits_money_check: a credit never releases more than the allocation it came from
-- (§4.3 invariant 1).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); cr uuid := gen_random_uuid();
BEGIN
  BEGIN
    BEGIN
      EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
      PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
      INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
          amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
        VALUES (c, p, br, pt, i1, 2026, 14, 'SAL-R-2026-000214', 'knet', 1000, 'KWD', 3, null, now(), current_date, null, mb, now());
      INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
        VALUES (c, a, i1, pt, p, null, 1000, mb, now());
      PERFORM set_config('app.clinic_id', '', true);
      EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      RAISE EXCEPTION 'FIN-0066-ONE: T3 step 1 was refused: % / %', msg, det;
    END;
    BEGIN
      PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
      EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
      INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
        VALUES (c, cr, pt, a, 1500, 'refund', mb, now());
      PERFORM set_config('app.clinic_id', '', true);
      EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
      RAISE EXCEPTION 'FIN-0066-ONE: T3 was accepted';
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      IF msg = 'FIN-0066-ONE: T3 was accepted' THEN
        RAISE EXCEPTION 'FIN-0066-ONE: T3 was accepted';
      END IF;
      IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'allocation_live' THEN
        RAISE EXCEPTION 'FIN-0066-ONE: T3 raised % / %, expected finance_invariant / allocation_live', msg, det;
      END IF;
    END;
  END;
END $$;

-- T4 refunds_money_check: a refund is covered exactly by the credits it spent (R3-2).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); cr uuid := gen_random_uuid(); f uuid := gen_random_uuid();
BEGIN
  BEGIN
    BEGIN
      EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
      PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
      INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
          amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
        VALUES (c, p, br, pt, i1, 2026, 15, 'SAL-R-2026-000215', 'knet', 1000, 'KWD', 3, null, now(), current_date, null, mb, now());
      INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
        VALUES (c, a, i1, pt, p, null, 1000, mb, now());
      INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
        VALUES (c, cr, pt, a, 400, 'refund', mb, now());
      PERFORM set_config('app.clinic_id', '', true);
      EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      RAISE EXCEPTION 'FIN-0066-ONE: T4 step 1 was refused: % / %', msg, det;
    END;
    BEGIN
      PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
      EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
      INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
          amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
        VALUES (c, f, br, pt, i1, 2026, 11, 'SAL-RF-2026-000211', 'knet', 400, 'KWD', 3, 'x', now(), current_date, null, mb, now());
      PERFORM set_config('app.clinic_id', '', true);
      EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
      RAISE EXCEPTION 'FIN-0066-ONE: T4 was accepted';
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      IF msg = 'FIN-0066-ONE: T4 was accepted' THEN
        RAISE EXCEPTION 'FIN-0066-ONE: T4 was accepted';
      END IF;
      IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'refund_sources' THEN
        RAISE EXCEPTION 'FIN-0066-ONE: T4 raised % / %, expected finance_invariant / refund_sources', msg, det;
      END IF;
    END;
  END;
END $$;

-- T5 refund_sources_money_check: the sources of a refund must add up to its amount (R3-2).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  cr uuid := gen_random_uuid(); cr2 uuid := gen_random_uuid();
  f uuid := gen_random_uuid(); s uuid := gen_random_uuid(); s2 uuid := gen_random_uuid();
BEGIN
  BEGIN
    BEGIN
      EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
      PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
      INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
          amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
        VALUES (c, p, br, pt, i1, 2026, 16, 'SAL-R-2026-000216', 'knet', 1000, 'KWD', 3, null, now(), current_date, null, mb, now());
      INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
        VALUES (c, a, i1, pt, p, null, 1000, mb, now());
      INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
        VALUES (c, cr, pt, a, 400, 'refund', mb, now());
      INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
          amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
        VALUES (c, f, br, pt, i1, 2026, 12, 'SAL-RF-2026-000212', 'knet', 400, 'KWD', 3, 'x', now(), current_date, null, mb, now());
      INSERT INTO refund_sources (clinic_id, id, refund_id, credit_id, patient_id, amount_minor, created_at)
        VALUES (c, s, f, cr, pt, 400, now());
      INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
        VALUES (c, cr2, pt, a, 100, 'refund', mb, now());
      PERFORM set_config('app.clinic_id', '', true);
      EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      RAISE EXCEPTION 'FIN-0066-ONE: T5 step 1 was refused: % / %', msg, det;
    END;
    BEGIN
      PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
      EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
      INSERT INTO refund_sources (clinic_id, id, refund_id, credit_id, patient_id, amount_minor, created_at)
        VALUES (c, s2, f, cr2, pt, 100, now());
      PERFORM set_config('app.clinic_id', '', true);
      EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
      RAISE EXCEPTION 'FIN-0066-ONE: T5 was accepted';
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      IF msg = 'FIN-0066-ONE: T5 was accepted' THEN
        RAISE EXCEPTION 'FIN-0066-ONE: T5 was accepted';
      END IF;
      IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'refund_sources' THEN
        RAISE EXCEPTION 'FIN-0066-ONE: T5 raised % / %, expected finance_invariant / refund_sources', msg, det;
      END IF;
    END;
  END;
END $$;

-- T6 invoices_money_check: a lowered invoice releases the excess into credit, so it cannot hold more
-- than it was paid (§4.3 invariant 3).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid();
BEGIN
  BEGIN
    BEGIN
      EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
      PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
      INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
          amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
        VALUES (c, p, br, pt, i1, 2026, 17, 'SAL-R-2026-000217', 'knet', 4000, 'KWD', 3, null, now(), current_date, null, mb, now());
      INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
        VALUES (c, a, i1, pt, p, null, 4000, mb, now());
      PERFORM set_config('app.clinic_id', '', true);
      EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      RAISE EXCEPTION 'FIN-0066-ONE: T6 step 1 was refused: % / %', msg, det;
    END;
    BEGIN
      PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
      EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
      UPDATE invoices SET total_minor = 3000 WHERE id = i1;
      PERFORM set_config('app.clinic_id', '', true);
      EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
      RAISE EXCEPTION 'FIN-0066-ONE: T6 was accepted';
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      IF msg = 'FIN-0066-ONE: T6 was accepted' THEN
        RAISE EXCEPTION 'FIN-0066-ONE: T6 was accepted';
      END IF;
      IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'invoice_paid' THEN
        RAISE EXCEPTION 'FIN-0066-ONE: T6 raised % / %, expected finance_invariant / invoice_paid', msg, det;
      END IF;
    END;
  END;
END $$;

-- T7 refunds_cash_check: a cash number is held by one movement only (PR #89 review).
DO $$
DECLARE msg text; det text;
  c uuid := '00000000-0000-7000-8000-0000000f000a'; br uuid := '00000000-0000-7000-8000-0000000f0002';
  pt uuid := '00000000-0000-7000-8000-0000000f0009'; mb uuid := '00000000-0000-7000-8000-0000000f0005';
  i1 uuid := '00000000-0000-7000-8000-0000000f0401';
  p uuid := gen_random_uuid(); a uuid := gen_random_uuid(); cr uuid := gen_random_uuid();
  f uuid := gen_random_uuid(); s uuid := gen_random_uuid();
BEGIN
  BEGIN
    BEGIN
      EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
      PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
      INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
          amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
        VALUES (c, p, br, pt, i1, 2026, 18, 'SAL-R-2026-000218', 'cash', 1000, 'KWD', 3, null, now(), current_date, 1, mb, now());
      INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
        VALUES (c, a, i1, pt, p, null, 1000, mb, now());
      INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
        VALUES (c, cr, pt, a, 1000, 'refund', mb, now());
      INSERT INTO branch_cash_drawers (clinic_id, id, branch_id, last_cash_seq, last_closed_seq, last_closing_id, created_at, updated_at)
        VALUES (c, gen_random_uuid(), br, 1, 0, null, now(), now());
      PERFORM set_config('app.clinic_id', '', true);
      EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      RAISE EXCEPTION 'FIN-0066-ONE: T7 step 1 was refused: % / %', msg, det;
    END;
    BEGIN
      PERFORM set_config('app.clinic_id', '00000000-0000-7000-8000-0000000f000a', true);
      EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
      INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
          amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
        VALUES (c, f, br, pt, i1, 2026, 13, 'SAL-RF-2026-000213', 'cash', 1000, 'KWD', 3, 'x', now(), current_date, 1, mb, now());
      INSERT INTO refund_sources (clinic_id, id, refund_id, credit_id, patient_id, amount_minor, created_at)
        VALUES (c, s, f, cr, pt, 1000, now());
      PERFORM set_config('app.clinic_id', '', true);
      EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
      RAISE EXCEPTION 'FIN-0066-ONE: T7 was accepted';
    EXCEPTION WHEN raise_exception THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, det = PG_EXCEPTION_DETAIL;
      IF msg = 'FIN-0066-ONE: T7 was accepted' THEN
        RAISE EXCEPTION 'FIN-0066-ONE: T7 was accepted';
      END IF;
      IF msg IS DISTINCT FROM 'finance_invariant' OR det IS DISTINCT FROM 'cash_seq_taken' THEN
        RAISE EXCEPTION 'FIN-0066-ONE: T7 raised % / %, expected finance_invariant / cash_seq_taken', msg, det;
      END IF;
    END;
  END;
END $$;

RESET ROLE;
RESET app.clinic_id;

\echo 'Finance tests: all passed'
ROLLBACK;


