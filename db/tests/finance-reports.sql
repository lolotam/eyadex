-- Finance F3 report SQL (docs/specs/finance-f3-reports-design.md §5, §8; 0068): the balance view agrees with
-- packages/contracts/src/settlement.ts on the worked examples S1–S11 of finance spec §4.3, the report
-- functions add up, and R2 equals the platform's monthly totals. Seeds as the migration owner and reads
-- as eyadex_app under the clinic's context. One transaction that ROLLS BACK, so 0066's commit-time
-- checks never fire and the file is safe on any database with the db/sql baseline.
-- Usage: psql -v ON_ERROR_STOP=1 -f db/tests/finance-reports.sql

BEGIN;

INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-0000000f300a','fin-reports','ت','R','dermatology','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
INSERT INTO branches VALUES ('00000000-0000-7000-8000-0000000f300a','00000000-0000-7000-8000-0000000f3002','ف','B',true,now(),now());
INSERT INTO roles VALUES ('00000000-0000-7000-8000-0000000f300a','00000000-0000-7000-8000-0000000f3003','doctor','طبيب','Doctor',false,true,now(),now());
INSERT INTO memberships VALUES ('00000000-0000-7000-8000-0000000f300a','00000000-0000-7000-8000-0000000f3005','00000000-0000-7000-8000-0000000f3006','n','fin-reports@example.com','00000000-0000-7000-8000-0000000f3003',false,'active','ar',null,now(),now());
INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
    civil_id_enc, civil_id_hmac, civil_id_last4, status, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-0000000f300a','00000000-0000-7000-8000-0000000f3009','1','x','+96500000002','1990-01-01','female',
    '00000000-0000-7000-8000-0000000f3002','f1.1.iv.body.tag',repeat('f',64),'0000','active',now(),now());
INSERT INTO clinic_services VALUES ('00000000-0000-7000-8000-0000000f300a','00000000-0000-7000-8000-0000000f300f','ليزر','Laser',30,'active',now(),now());

-- The invoices of the worked examples, all issued on 2026-10-20 in Kuwait: I1 (10000), I2 (5000), I3 (5000)
-- and I4 (0, S11). Each has one service line of its total.
INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status, source, source_id,
    issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp, tax_minor, total_minor,
    created_by, created_at, updated_at)
SELECT '00000000-0000-7000-8000-0000000f300a', v.id::uuid, '00000000-0000-7000-8000-0000000f3002',
    '00000000-0000-7000-8000-0000000f3009', 2026, v.seq, 'PR-2026-00000'||v.seq, 'issued', 'manual', null,
    '2026-10-20 08:00:00+00', 'KWD', 3, v.total, 0, 0, 0, v.total, '00000000-0000-7000-8000-0000000f3005', now(), now()
  FROM (VALUES ('00000000-0000-7000-8000-0000000f3101', 1, 10000::bigint),
               ('00000000-0000-7000-8000-0000000f3102', 2, 5000::bigint),
               ('00000000-0000-7000-8000-0000000f3103', 3, 5000::bigint),
               ('00000000-0000-7000-8000-0000000f3104', 4, 0::bigint)) AS v (id, seq, total);
INSERT INTO invoice_lines (clinic_id, id, invoice_id, position, kind, service_id, provider_id, description_ar,
    description_en, quantity, unit_price_minor, line_total_minor, created_at, updated_at)
SELECT i.clinic_id, gen_random_uuid(), i.id, 0, 'service', '00000000-0000-7000-8000-0000000f300f',
    '00000000-0000-7000-8000-0000000f3005', 'ليزر', 'Laser', 1, i.total_minor, i.total_minor, now(), now()
  FROM invoices i WHERE i.clinic_id = '00000000-0000-7000-8000-0000000f300a';

SET LOCAL app.clinic_id = '00000000-0000-7000-8000-0000000f300a';

-- S1: paying 4000 in cash on I1 leaves it partly paid.
INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
    amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
  VALUES ('00000000-0000-7000-8000-0000000f300a', '00000000-0000-7000-8000-0000000f3201', '00000000-0000-7000-8000-0000000f3002',
    '00000000-0000-7000-8000-0000000f3009', '00000000-0000-7000-8000-0000000f3101', 2026, 1, 'PR-R-2026-000001', 'cash',
    4000, 'KWD', 3, null, '2026-10-20 08:01:00+00', '2026-10-20', 1, '00000000-0000-7000-8000-0000000f3005', now());
INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
  VALUES ('00000000-0000-7000-8000-0000000f300a', '00000000-0000-7000-8000-0000000f3301', '00000000-0000-7000-8000-0000000f3101',
    '00000000-0000-7000-8000-0000000f3009', '00000000-0000-7000-8000-0000000f3201', null, 4000,
    '00000000-0000-7000-8000-0000000f3005', '2026-10-20 08:01:00+00');
SET LOCAL ROLE eyadex_app;
DO $$
DECLARE r record;
BEGIN
  SELECT paid_minor, owed_minor INTO r FROM finance_invoice_balances WHERE id = '00000000-0000-7000-8000-0000000f3101';
  IF (r.paid_minor, r.owed_minor) IS DISTINCT FROM (4000::bigint, 6000::bigint) THEN
    RAISE EXCEPTION 'F3-VIEW S1: I1 paid/owed %/%, expected 4000/6000', r.paid_minor, r.owed_minor;
  END IF;
END $$;
RESET ROLE;

-- S2: paying the rest by KNET closes I1.
INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
    amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
  VALUES ('00000000-0000-7000-8000-0000000f300a', '00000000-0000-7000-8000-0000000f3202', '00000000-0000-7000-8000-0000000f3002',
    '00000000-0000-7000-8000-0000000f3009', '00000000-0000-7000-8000-0000000f3101', 2026, 2, 'PR-R-2026-000002', 'knet',
    6000, 'KWD', 3, null, '2026-10-20 08:02:00+00', '2026-10-20', null, '00000000-0000-7000-8000-0000000f3005', now());
INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
  VALUES ('00000000-0000-7000-8000-0000000f300a', '00000000-0000-7000-8000-0000000f3302', '00000000-0000-7000-8000-0000000f3101',
    '00000000-0000-7000-8000-0000000f3009', '00000000-0000-7000-8000-0000000f3202', null, 6000,
    '00000000-0000-7000-8000-0000000f3005', '2026-10-20 08:02:00+00');
SET LOCAL ROLE eyadex_app;
DO $$
DECLARE r record;
BEGIN
  SELECT paid_minor, owed_minor INTO r FROM finance_invoice_balances WHERE id = '00000000-0000-7000-8000-0000000f3101';
  IF (r.paid_minor, r.owed_minor) IS DISTINCT FROM (10000::bigint, 0::bigint) THEN
    RAISE EXCEPTION 'F3-VIEW S2: I1 paid/owed %/%, expected 10000/0', r.paid_minor, r.owed_minor;
  END IF;
END $$;
RESET ROLE;

-- S3: lowering I1 to 7000 releases 3000 of A2 into credit C1; S4: raising it to 9000 leaves 2000 owed.
INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
  VALUES ('00000000-0000-7000-8000-0000000f300a', '00000000-0000-7000-8000-0000000f3401', '00000000-0000-7000-8000-0000000f3009',
    '00000000-0000-7000-8000-0000000f3302', 3000, 'invoice_edited', '00000000-0000-7000-8000-0000000f3005', '2026-10-20 08:03:00+00');
UPDATE invoices SET subtotal_minor = 7000, total_minor = 7000 WHERE id = '00000000-0000-7000-8000-0000000f3101';
SET LOCAL ROLE eyadex_app;
DO $$
DECLARE r record;
BEGIN
  SELECT paid_minor, owed_minor INTO r FROM finance_invoice_balances WHERE id = '00000000-0000-7000-8000-0000000f3101';
  IF (r.paid_minor, r.owed_minor) IS DISTINCT FROM (7000::bigint, 0::bigint) THEN
    RAISE EXCEPTION 'F3-VIEW S3: I1 paid/owed %/%, expected 7000/0', r.paid_minor, r.owed_minor;
  END IF;
END $$;
RESET ROLE;
UPDATE invoices SET subtotal_minor = 9000, total_minor = 9000 WHERE id = '00000000-0000-7000-8000-0000000f3101';
UPDATE invoice_lines SET unit_price_minor = 9000, line_total_minor = 9000
  WHERE invoice_id = '00000000-0000-7000-8000-0000000f3101';
SET LOCAL ROLE eyadex_app;
DO $$
DECLARE r record;
BEGIN
  SELECT paid_minor, owed_minor INTO r FROM finance_invoice_balances WHERE id = '00000000-0000-7000-8000-0000000f3101';
  IF (r.paid_minor, r.owed_minor) IS DISTINCT FROM (7000::bigint, 2000::bigint) THEN
    RAISE EXCEPTION 'F3-VIEW S4: I1 paid/owed %/%, expected 7000/2000', r.paid_minor, r.owed_minor;
  END IF;
END $$;
RESET ROLE;

-- S5: applying 3000 of credit C1 to I2 leaves it partly paid.
INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
  VALUES ('00000000-0000-7000-8000-0000000f300a', '00000000-0000-7000-8000-0000000f3303', '00000000-0000-7000-8000-0000000f3102',
    '00000000-0000-7000-8000-0000000f3009', null, '00000000-0000-7000-8000-0000000f3401', 3000,
    '00000000-0000-7000-8000-0000000f3005', '2026-10-20 08:04:00+00');
SET LOCAL ROLE eyadex_app;
DO $$
DECLARE r record;
BEGIN
  SELECT paid_minor, owed_minor INTO r FROM finance_invoice_balances WHERE id = '00000000-0000-7000-8000-0000000f3102';
  IF (r.paid_minor, r.owed_minor) IS DISTINCT FROM (3000::bigint, 2000::bigint) THEN
    RAISE EXCEPTION 'F3-VIEW S5: I2 paid/owed %/%, expected 3000/2000', r.paid_minor, r.owed_minor;
  END IF;
END $$;
RESET ROLE;

-- S6: voiding I2 releases A3 into credit C2; a void invoice owes nothing and holds nothing.
INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
  VALUES ('00000000-0000-7000-8000-0000000f300a', '00000000-0000-7000-8000-0000000f3402', '00000000-0000-7000-8000-0000000f3009',
    '00000000-0000-7000-8000-0000000f3303', 3000, 'invoice_voided', '00000000-0000-7000-8000-0000000f3005', '2026-10-20 08:05:00+00');
UPDATE invoices SET status = 'void', voided_at = '2026-10-20 08:05:00+00', void_reason = 'x'
  WHERE id = '00000000-0000-7000-8000-0000000f3102';
SET LOCAL ROLE eyadex_app;
DO $$
DECLARE r record;
BEGIN
  SELECT paid_minor, owed_minor INTO r FROM finance_invoice_balances WHERE id = '00000000-0000-7000-8000-0000000f3102';
  IF (r.paid_minor, r.owed_minor) IS DISTINCT FROM (0::bigint, 0::bigint) THEN
    RAISE EXCEPTION 'F3-VIEW S6: I2 paid/owed %/%, expected 0/0', r.paid_minor, r.owed_minor;
  END IF;
END $$;
RESET ROLE;

-- S7: refunding 3000 by KNET from credit C2; S8: refunding 1000 by KNET from P1 releases 1000 of A1 (C3).
INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
    amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
  VALUES ('00000000-0000-7000-8000-0000000f300a', '00000000-0000-7000-8000-0000000f3501', '00000000-0000-7000-8000-0000000f3002',
    '00000000-0000-7000-8000-0000000f3009', '00000000-0000-7000-8000-0000000f3102', 2026, 1, 'PR-RF-2026-000001', 'knet',
    3000, 'KWD', 3, 'x', '2026-10-20 08:06:00+00', '2026-10-20', null, '00000000-0000-7000-8000-0000000f3005', now());
INSERT INTO refund_sources (clinic_id, id, refund_id, credit_id, patient_id, amount_minor, created_at)
  VALUES ('00000000-0000-7000-8000-0000000f300a', gen_random_uuid(), '00000000-0000-7000-8000-0000000f3501',
    '00000000-0000-7000-8000-0000000f3402', '00000000-0000-7000-8000-0000000f3009', 3000, now());
INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
  VALUES ('00000000-0000-7000-8000-0000000f300a', '00000000-0000-7000-8000-0000000f3403', '00000000-0000-7000-8000-0000000f3009',
    '00000000-0000-7000-8000-0000000f3301', 1000, 'refund', '00000000-0000-7000-8000-0000000f3005', '2026-10-20 08:07:00+00');
INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
    amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
  VALUES ('00000000-0000-7000-8000-0000000f300a', '00000000-0000-7000-8000-0000000f3502', '00000000-0000-7000-8000-0000000f3002',
    '00000000-0000-7000-8000-0000000f3009', '00000000-0000-7000-8000-0000000f3101', 2026, 2, 'PR-RF-2026-000002', 'knet',
    1000, 'KWD', 3, 'x', '2026-10-20 08:07:00+00', '2026-10-20', null, '00000000-0000-7000-8000-0000000f3005', now());
INSERT INTO refund_sources (clinic_id, id, refund_id, credit_id, patient_id, amount_minor, created_at)
  VALUES ('00000000-0000-7000-8000-0000000f300a', gen_random_uuid(), '00000000-0000-7000-8000-0000000f3502',
    '00000000-0000-7000-8000-0000000f3403', '00000000-0000-7000-8000-0000000f3009', 1000, now());

-- S8–S11 end state: I1 9000 with 6000 paid, I2 void, I3 untouched (S9, S10 write nothing), I4 settled at 0.
SET LOCAL ROLE eyadex_app;
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT b.id, b.paid_minor, b.owed_minor, w.paid, w.owed
      FROM (VALUES ('00000000-0000-7000-8000-0000000f3101'::uuid, 6000::bigint, 3000::bigint),
                   ('00000000-0000-7000-8000-0000000f3102'::uuid, 0::bigint, 0::bigint),
                   ('00000000-0000-7000-8000-0000000f3103'::uuid, 0::bigint, 5000::bigint),
                   ('00000000-0000-7000-8000-0000000f3104'::uuid, 0::bigint, 0::bigint)) AS w (id, paid, owed)
      LEFT JOIN finance_invoice_balances b ON b.id = w.id
  LOOP
    IF (r.paid_minor, r.owed_minor) IS DISTINCT FROM (r.paid, r.owed) THEN
      RAISE EXCEPTION 'F3-VIEW S8-S11: invoice % paid/owed %/%, expected %/%', r.id, r.paid_minor, r.owed_minor,
        r.paid, r.owed;
    END IF;
  END LOOP;
  IF (SELECT business_date FROM finance_invoice_balances WHERE id = '00000000-0000-7000-8000-0000000f3101')
     IS DISTINCT FROM '2026-10-20'::date THEN
    RAISE EXCEPTION 'F3-VIEW: the invoice day is not issued_at in the clinic timezone';
  END IF;
END $$;
RESET ROLE;

-- R1 (spec §4): per day, branch and method — cash in 4000; KNET in 6000 and out 4000.
INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
    counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
  VALUES ('00000000-0000-7000-8000-0000000f300a', '00000000-0000-7000-8000-0000000f3601', '00000000-0000-7000-8000-0000000f3002',
    '2026-10-20', 0, 1, 4000, 4000, '[]'::jsonb, null, null, 'KWD', 3, '00000000-0000-7000-8000-0000000f3005',
    '2026-10-20 15:00:00+00', now());
SET LOCAL ROLE eyadex_app;
DO $$
DECLARE got text; branch uuid[] := ARRAY['00000000-0000-7000-8000-0000000f3002']::uuid[];
BEGIN
  SELECT string_agg(t.method||':'||t.in_minor||':'||t.out_minor||':'||t.net_minor, ',' ORDER BY t.method) INTO got
    FROM finance_report_daily_takings('2026-10-01', '2026-10-31', branch) t;
  IF got IS DISTINCT FROM 'cash:4000:0:4000,knet:6000:4000:2000' THEN
    RAISE EXCEPTION 'F3-R1: daily takings are %', got;
  END IF;
  IF (SELECT count(*) FROM finance_report_daily_takings('2026-10-01', '2026-10-31', NULL)) <> 0 THEN
    RAISE EXCEPTION 'F3-R1: a NULL branch list reached a branch';
  END IF;
  SELECT string_agg(k.expected_minor||':'||k.counted_minor||':'||k.difference_minor||':'||k.note_present, ',') INTO got
    FROM finance_report_cash_closings('2026-10-01', '2026-10-31', branch) k;
  IF got IS DISTINCT FROM '4000:4000:0:false' THEN
    RAISE EXCEPTION 'F3-R9: cash closings are %', got;
  END IF;
END $$;

-- R2 (spec §4, R1-17): October holds I1 9000, I3 5000 and I4 0 (I2 is void), 10000 collected, 4000
-- refunded and 3000 of credit applied (information only); the month equals the platform's totals (F3-Q13 a).
DO $$
DECLARE r record; branch uuid[] := ARRAY['00000000-0000-7000-8000-0000000f3002']::uuid[];
BEGIN
  SELECT sum(s.invoiced_minor) AS invoiced, sum(s.collected_minor) AS collected, sum(s.refunded_minor) AS refunded,
      sum(s.credit_applied_minor) AS credit, sum(s.void_count) AS voids
    INTO r FROM finance_report_period_summary('2026-10-01', '2026-10-31', branch) s;
  IF (r.invoiced, r.collected, r.refunded, r.credit, r.voids)
     IS DISTINCT FROM (14000::numeric, 10000::numeric, 4000::numeric, 3000::numeric, 1::numeric) THEN
    RAISE EXCEPTION 'F3-R2: October is % / % / % / % / %', r.invoiced, r.collected, r.refunded, r.credit, r.voids;
  END IF;
END $$;
RESET ROLE;
DO $$
DECLARE r record;
BEGIN
  SELECT invoiced_minor, collected_minor, refunded_minor INTO r
    FROM finance_monthly_totals('00000000-0000-7000-8000-0000000f300a') WHERE month = '2026-10-01';
  IF (r.invoiced_minor, r.collected_minor, r.refunded_minor) IS DISTINCT FROM (14000::bigint, 10000::bigint, 4000::bigint) THEN
    RAISE EXCEPTION 'F3-R2: the platform totals for October are % / % / %', r.invoiced_minor, r.collected_minor,
      r.refunded_minor;
  END IF;
END $$;

-- R3/R4 (spec §4, F3-Q3 a): a September invoice with a discounted service line, a free line, an archived
-- line and tax, and a void invoice in the same month. line_total_minor is net of both discounts, so the
-- rows plus the tax row equal the invoice's total; archived lines and void invoices are never counted.
INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status, source, source_id,
    issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp, tax_minor, total_minor,
    void_reason, voided_at, created_by, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-0000000f300a', '00000000-0000-7000-8000-0000000f3105', '00000000-0000-7000-8000-0000000f3002',
    '00000000-0000-7000-8000-0000000f3009', 2026, 5, 'PR-2026-000005', 'issued', 'manual', null, '2026-09-10 08:00:00+00',
    'KWD', 3, 11000, 2000, 500, 450, 9450, null, null, '00000000-0000-7000-8000-0000000f3005', now(), now()),
    ('00000000-0000-7000-8000-0000000f300a', '00000000-0000-7000-8000-0000000f3106', '00000000-0000-7000-8000-0000000f3002',
    '00000000-0000-7000-8000-0000000f3009', 2026, 6, 'PR-2026-000006', 'void', 'manual', null, '2026-09-11 08:00:00+00',
    'KWD', 3, 7000, 0, 0, 0, 7000, 'x', '2026-09-11 09:00:00+00', '00000000-0000-7000-8000-0000000f3005', now(), now());
INSERT INTO invoice_lines (clinic_id, id, invoice_id, position, kind, service_id, provider_id, description_ar,
    description_en, quantity, unit_price_minor, line_total_minor, archived_at, created_at, updated_at)
  VALUES ('00000000-0000-7000-8000-0000000f300a', gen_random_uuid(), '00000000-0000-7000-8000-0000000f3105', 0, 'service',
    '00000000-0000-7000-8000-0000000f300f', '00000000-0000-7000-8000-0000000f3005', 'ليزر', 'Laser', 2, 5000, 8100, null, now(), now()),
    ('00000000-0000-7000-8000-0000000f300a', gen_random_uuid(), '00000000-0000-7000-8000-0000000f3105', 1, 'free',
    null, null, 'حر', 'Free', 1, 1000, 900, null, now(), now()),
    ('00000000-0000-7000-8000-0000000f300a', gen_random_uuid(), '00000000-0000-7000-8000-0000000f3105', 1, 'free',
    null, null, 'قديم', 'Old', 1, 5000, 5000, '2026-09-10 09:00:00+00', now(), now()),
    ('00000000-0000-7000-8000-0000000f300a', gen_random_uuid(), '00000000-0000-7000-8000-0000000f3106', 0, 'service',
    '00000000-0000-7000-8000-0000000f300f', '00000000-0000-7000-8000-0000000f3005', 'ليزر', 'Laser', 1, 7000, 7000, null, now(), now());
SET LOCAL ROLE eyadex_app;
DO $$
DECLARE got text; total bigint; branch uuid[] := ARRAY['00000000-0000-7000-8000-0000000f3002']::uuid[];
BEGIN
  SELECT string_agg(s.kind||':'||s.line_count||':'||s.quantity||':'||s.amount_minor, ',' ORDER BY s.kind), sum(s.amount_minor)
    INTO got, total FROM finance_report_by_service('2026-09-01', '2026-09-30', branch) s;
  IF got IS DISTINCT FROM 'free:1:1:900,service:1:2:8100,tax:0:0:450' OR total <> 9450 THEN
    RAISE EXCEPTION 'F3-R3: by service is % (sum %), expected the total 9450', got, total;
  END IF;
  SELECT string_agg(d.kind||':'||d.line_count||':'||d.amount_minor, ',' ORDER BY d.kind), sum(d.amount_minor)
    INTO got, total FROM finance_report_by_doctor('2026-09-01', '2026-09-30', branch) d;
  IF got IS DISTINCT FROM 'doctor:1:8100,none:1:900,tax:0:450' OR total <> 9450 THEN
    RAISE EXCEPTION 'F3-R4: by doctor is % (sum %), expected the total 9450', got, total;
  END IF;
END $$;
RESET ROLE;
RESET app.clinic_id;

\echo 'Finance report tests: all passed'
ROLLBACK;
