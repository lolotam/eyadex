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

-- The catalogue holds exactly the 13 finance keys of Task 2 (an exact set, not a count), in the 0x34–0x40 ids.
DO $$
DECLARE expected text[] := ARRAY['view:invoices:clinic','view:invoices:branch','view:invoices:own',
  'create:invoices:clinic','create:invoices:branch','update:invoices:clinic','update:invoices:branch',
  'deactivate:invoices:clinic','deactivate:invoices:branch','create:discounts:clinic','create:discounts:branch',
  'view:prices:clinic','update:prices:clinic'];
  actual text[];
BEGIN
  SELECT array_agg(key ORDER BY id) INTO actual FROM permissions WHERE module = 'finance';
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FIN: finance keys are %, expected %', actual, expected;
  END IF;
  IF (SELECT min(id::text) FROM permissions WHERE module = 'finance') <> '00000000-0000-7000-8000-0000000c0034'
     OR (SELECT max(id::text) FROM permissions WHERE module = 'finance') <> '00000000-0000-7000-8000-0000000c0040' THEN
    RAISE EXCEPTION 'FIN: finance key ids are not 0x34–0x40';
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

\echo 'Finance tests: all passed'
ROLLBACK;
