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
\echo 'Finance tests: all passed'
ROLLBACK;
