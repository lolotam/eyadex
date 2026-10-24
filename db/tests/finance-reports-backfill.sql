-- Finance F3 backfills (docs/specs/finance-f3-reports-design.md §8 step 3): the two scripts in db/maintenance fill
-- the NULL business days from the clinic's timezone, keep every day the writers already stored, and change nothing
-- on a second run. One transaction that ROLLS BACK, so 0066's commit-time checks never fire.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/finance-reports-backfill.sql

BEGIN;

INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000f320a','fin-backfill','ت','B','dermatology','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
INSERT INTO branches VALUES ('00000000-0000-7000-8000-0000000f320a','00000000-0000-7000-8000-0000000f3202','ف','B',true,now(),now());
INSERT INTO roles VALUES ('00000000-0000-7000-8000-0000000f320a','00000000-0000-7000-8000-0000000f3203','doctor','طبيب','Doctor',false,true,now(),now());
INSERT INTO memberships VALUES ('00000000-0000-7000-8000-0000000f320a','00000000-0000-7000-8000-0000000f3205','00000000-0000-7000-8000-0000000f3206','n','fin-backfill@example.com','00000000-0000-7000-8000-0000000f3203',false,'active','ar',null,now(),now());
INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
    civil_id_enc, civil_id_hmac, civil_id_last4, status, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-0000000f320a','00000000-0000-7000-8000-0000000f3209','1','x','+96500000005','1990-01-01','female',
    '00000000-0000-7000-8000-0000000f3202','f1.1.iv.body.tag',repeat('f',64),'0000','active',now(),now());

-- I1 is issued at 22:30 UTC on 2026-10-20, which is already 2026-10-21 in Kuwait, and has no stored day yet.
-- I2 already holds a day written by the issue path; the backfill must keep it.
INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status, source, source_id,
    issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp, tax_minor, total_minor,
    business_date, created_by, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-0000000f320a', '00000000-0000-7000-8000-0000000f3301', '00000000-0000-7000-8000-0000000f3202',
    '00000000-0000-7000-8000-0000000f3209', 2026, 1, 'PB-2026-000001', 'issued', 'manual', null, '2026-10-20 22:30:00+00',
    'KWD', 3, 5000, 0, 0, 0, 5000, null, '00000000-0000-7000-8000-0000000f3205', now(), now()),
    ('00000000-0000-7000-8000-0000000f320a', '00000000-0000-7000-8000-0000000f3302', '00000000-0000-7000-8000-0000000f3202',
    '00000000-0000-7000-8000-0000000f3209', 2026, 2, 'PB-2026-000002', 'issued', 'manual', null, '2026-10-20 08:00:00+00',
    'KWD', 3, 5000, 0, 0, 0, 5000, '2026-10-19', '00000000-0000-7000-8000-0000000f3205', now(), now());

-- A payment stored on 2026-10-21 funds A1; C1 is released from A1 and funds A2, written at 21:30 UTC on 2026-10-20
-- (2026-10-21 in Kuwait). Neither allocation has a stored day yet.
INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
    amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
  VALUES ('00000000-0000-7000-8000-0000000f320a', '00000000-0000-7000-8000-0000000f3401', '00000000-0000-7000-8000-0000000f3202',
    '00000000-0000-7000-8000-0000000f3209', '00000000-0000-7000-8000-0000000f3301', 2026, 1, 'PB-R-2026-000001', 'knet',
    5000, 'KWD', 3, null, '2026-10-20 22:35:00+00', '2026-10-21', null, '00000000-0000-7000-8000-0000000f3205', now());
INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
  VALUES ('00000000-0000-7000-8000-0000000f320a', '00000000-0000-7000-8000-0000000f3501', '00000000-0000-7000-8000-0000000f3301',
    '00000000-0000-7000-8000-0000000f3209', '00000000-0000-7000-8000-0000000f3401', null, 5000,
    '00000000-0000-7000-8000-0000000f3205', '2026-10-20 22:35:00+00');
INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
  VALUES ('00000000-0000-7000-8000-0000000f320a', '00000000-0000-7000-8000-0000000f3601', '00000000-0000-7000-8000-0000000f3209',
    '00000000-0000-7000-8000-0000000f3501', 1000, 'invoice_edited', '00000000-0000-7000-8000-0000000f3205', '2026-10-20 21:00:00+00');
INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
  VALUES ('00000000-0000-7000-8000-0000000f320a', '00000000-0000-7000-8000-0000000f3502', '00000000-0000-7000-8000-0000000f3302',
    '00000000-0000-7000-8000-0000000f3209', null, '00000000-0000-7000-8000-0000000f3601', 1000,
    '00000000-0000-7000-8000-0000000f3205', '2026-10-20 21:30:00+00');

\ir ../maintenance/invoice-business-date-backfill.sql
\ir ../maintenance/allocation-business-date-backfill.sql

DO $$
DECLARE got text;
BEGIN
  SELECT string_agg(number || '=' || business_date, ',' ORDER BY number) INTO got
    FROM invoices WHERE clinic_id = '00000000-0000-7000-8000-0000000f320a';
  IF got IS DISTINCT FROM 'PB-2026-000001=2026-10-21,PB-2026-000002=2026-10-19' THEN
    RAISE EXCEPTION 'F3-BACKFILL: invoice days are %', got;
  END IF;
  SELECT string_agg(id::text || '=' || business_date, ',' ORDER BY id) INTO got
    FROM payment_allocations WHERE clinic_id = '00000000-0000-7000-8000-0000000f320a';
  IF got IS DISTINCT FROM '00000000-0000-7000-8000-0000000f3501=2026-10-21,00000000-0000-7000-8000-0000000f3502=2026-10-21' THEN
    RAISE EXCEPTION 'F3-BACKFILL: allocation days are %', got;
  END IF;
  PERFORM set_config('f3_backfill.rows', (SELECT string_agg(business_date::text, ',' ORDER BY id)
    FROM payment_allocations WHERE clinic_id = '00000000-0000-7000-8000-0000000f320a'), true);
END $$;

-- A second run finds nothing to fill and changes nothing.
\ir ../maintenance/invoice-business-date-backfill.sql
\ir ../maintenance/allocation-business-date-backfill.sql

DO $$
BEGIN
  IF (SELECT string_agg(business_date::text, ',' ORDER BY id) FROM payment_allocations
       WHERE clinic_id = '00000000-0000-7000-8000-0000000f320a') IS DISTINCT FROM current_setting('f3_backfill.rows') THEN
    RAISE EXCEPTION 'F3-BACKFILL: a second run changed the allocation days';
  END IF;
  IF (SELECT business_date FROM invoices WHERE id = '00000000-0000-7000-8000-0000000f3302') <> '2026-10-19' THEN
    RAISE EXCEPTION 'F3-BACKFILL: a second run overwrote a stored invoice day';
  END IF;
END $$;

\echo 'Finance report backfill tests: all passed'
ROLLBACK;
