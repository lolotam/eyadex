DO $$
DECLARE b uuid := '00000000-0000-7000-8000-00000000000b'; n bigint; m text;
BEGIN
  -- Finance F2 (0064): every money row must satisfy its own checks, so the refusal is the clinic's, not the row's.
  BEGIN
    INSERT INTO clinic_payment_methods (clinic_id, id, method, enabled, created_at, updated_at)
      VALUES (b, gen_random_uuid(), 'other', true, now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: clinic_payment_methods';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO receipt_sequences (clinic_id, id, branch_id, series, year, next_number, created_at, updated_at)
      VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b2', 'receipt', 2027, 1, now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: receipt_sequences';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b2', '00000000-0000-7000-8000-0000000001b9',
        '00000000-0000-7000-8000-0000000004b4', 2026, 9, 'PB-R-2026-000009', 'knet', 100, 'KWD', 3, null, now(),
        current_date, null, '00000000-0000-7000-8000-0000000002b5', now());
    RAISE EXCEPTION 'ISO-01 write leak: payments';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000004b4', '00000000-0000-7000-8000-0000000001b9',
        '00000000-0000-7000-8000-0000000005b3', null, 100, '00000000-0000-7000-8000-0000000002b5', now());
    RAISE EXCEPTION 'ISO-01 write leak: payment_allocations';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
      VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b9', '00000000-0000-7000-8000-0000000005b4',
        100, 'refund', '00000000-0000-7000-8000-0000000002b5', now());
    RAISE EXCEPTION 'ISO-01 write leak: patient_credits';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
        amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
      VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b2', '00000000-0000-7000-8000-0000000001b9',
        '00000000-0000-7000-8000-0000000004b4', 2026, 9, 'PB-RF-2026-000009', 'knet', 100, 'KWD', 3, 'x', now(),
        current_date, null, '00000000-0000-7000-8000-0000000002b5', now());
    RAISE EXCEPTION 'ISO-01 write leak: refunds';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO refund_sources (clinic_id, id, refund_id, credit_id, patient_id, amount_minor, created_at)
      VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000005b6', '00000000-0000-7000-8000-0000000005b5',
        '00000000-0000-7000-8000-0000000001b9', 100, now());
    RAISE EXCEPTION 'ISO-01 write leak: refund_sources';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
        counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
      VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b2', current_date + 5, 0, 0, 0, 0, '[]'::jsonb, null,
        '00000000-0000-7000-8000-0000000005b7', 'KWD', 3, '00000000-0000-7000-8000-0000000002b5', now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: cash_closings';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO branch_cash_drawers (clinic_id, id, branch_id, last_cash_seq, last_closed_seq, last_closing_id, created_at, updated_at)
      VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b2', 0, 0, null, now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: branch_cash_drawers';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO finance_report_exports (clinic_id, id, requested_by, report, params, format, scope, status, created_at)
      VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b5', 'daily_takings', '{}'::jsonb, 'csv', 'clinic',
        'queued', now());
    RAISE EXCEPTION 'ISO-01 write leak: finance_report_exports';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO finance_report_export_blobs (clinic_id, id, export_id, attempt, storage_key, state, created_at, updated_at)
      VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000006b1', 2,
        'clinic/00000000-0000-7000-8000-00000000000b/finance-exports/00000000-0000-7000-8000-0000000006b1/2.csv',
        'allocated', now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: finance_report_export_blobs';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO audit_log VALUES (b, gen_random_uuid(), gen_random_uuid(), 'user.invited', 'administrative', 'user', null, null, '{}', now());
    RAISE EXCEPTION 'ISO-01 write leak: audit_log';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
