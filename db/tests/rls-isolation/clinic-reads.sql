-- ISO-01 as the runtime role scoped to clinic A.
SET LOCAL ROLE eyadex_app;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-00000000000a';

DO $$
DECLARE t text; n bigint; other uuid := '00000000-0000-7000-8000-00000000000b';
BEGIN
  -- Every clinic table: clinic A sees zero rows of clinic B.
  FOREACH t IN ARRAY ARRAY['clinic_features','branches','roles','role_permissions','memberships',
      'membership_branches','invitations','invitation_branches','patients','audit_log','clinic_counters',
      'clinic_idempotency_keys','clinic_mail_providers','clinic_expiry_reminders','clinic_services',
      'provider_schedules','provider_time_off','appointments','visits','visit_notes','visit_addenda',
      'patient_medical_profiles','visit_diagnoses','visit_prescription_items','clinic_medicines',
      'patient_attachments','clinic_notification_settings','patient_notifications',
      'clinic_whatsapp_channels','used_invoice_prefixes','service_provider_prices','invoice_sequences',
      'invoices','invoice_lines','invoice_links','clinic_payment_methods','receipt_sequences','payments',
      'payment_allocations','patient_credits','refunds','refund_sources','cash_closings','branch_cash_drawers',
      'finance_report_exports','finance_report_export_blobs','finance_report_export_patients','invoice_pdf_jobs','invoice_pdf_upload_attempts','invoice_pdf_artifacts'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE clinic_id = $1', t) INTO n USING other;
    IF n <> 0 THEN RAISE EXCEPTION 'ISO-01 read leak: % shows % rows of another clinic', t, n; END IF;
    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
    IF n = 0 THEN RAISE EXCEPTION 'ISO-01 setup: % shows no rows of its own clinic', t; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM clinics;
  IF n <> 1 THEN RAISE EXCEPTION 'ISO-01: clinics shows % rows, expected only its own', n; END IF;
END $$;

-- Spec §5.1, §8: the invoker view and the report functions run under the caller's RLS. Clinic A sees
-- nothing of clinic B even when it names B's branch, and its own seed rows are there.
DO $$
DECLARE n bigint; mine uuid[] := ARRAY['00000000-0000-7000-8000-0000000001a2']::uuid[];
  theirs uuid[] := ARRAY['00000000-0000-7000-8000-0000000001b2']::uuid[];
  d0 date := current_date - 5; d1 date := current_date + 5;
BEGIN
  SELECT count(*) INTO n FROM finance_invoice_balances WHERE clinic_id = '00000000-0000-7000-8000-00000000000b';
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01 read leak: finance_invoice_balances shows % rows of another clinic', n; END IF;
  SELECT count(*) INTO n FROM finance_invoice_balances;
  IF n = 0 THEN RAISE EXCEPTION 'ISO-01 setup: finance_invoice_balances shows no rows of its own clinic'; END IF;
  SELECT (SELECT count(*) FROM finance_report_daily_takings(d0, d1, theirs))
    + (SELECT count(*) FROM finance_report_period_summary(d0, d1, theirs))
    + (SELECT count(*) FROM finance_report_by_service(d0, d1, theirs))
    + (SELECT count(*) FROM finance_report_by_doctor(d0, d1, theirs))
    + (SELECT count(*) FROM finance_report_cash_closings(d0, d1, theirs)) INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01 read leak: the report functions show % rows of another clinic', n; END IF;
  SELECT count(*) INTO n FROM finance_report_daily_takings(d0, d1, mine);
  IF n = 0 THEN RAISE EXCEPTION 'ISO-01 setup: finance_report_daily_takings shows no own rows'; END IF;
  SELECT count(*) INTO n FROM finance_report_period_summary(d0, d1, mine);
  IF n = 0 THEN RAISE EXCEPTION 'ISO-01 setup: finance_report_period_summary shows no own rows'; END IF;
  SELECT count(*) INTO n FROM finance_report_by_service(d0, d1, mine);
  IF n = 0 THEN RAISE EXCEPTION 'ISO-01 setup: finance_report_by_service shows no own rows'; END IF;
  SELECT count(*) INTO n FROM finance_report_by_doctor(d0, d1, mine);
  IF n = 0 THEN RAISE EXCEPTION 'ISO-01 setup: finance_report_by_doctor shows no own rows'; END IF;
  SELECT count(*) INTO n FROM finance_report_cash_closings(d0, d1, mine);
  IF n = 0 THEN RAISE EXCEPTION 'ISO-01 setup: finance_report_cash_closings shows no own rows'; END IF;
END $$;

-- CLAUDE.md §5: with no clinic context the view and the functions return zero rows and no error.
SET LOCAL app.clinic_id = '';
DO $$
DECLARE n bigint;
  both_branches uuid[] := ARRAY['00000000-0000-7000-8000-0000000001a2', '00000000-0000-7000-8000-0000000001b2']::uuid[];
  d0 date := current_date - 5; d1 date := current_date + 5;
BEGIN
  SELECT (SELECT count(*) FROM finance_invoice_balances)
    + (SELECT count(*) FROM finance_report_daily_takings(d0, d1, both_branches))
    + (SELECT count(*) FROM finance_report_period_summary(d0, d1, both_branches))
    + (SELECT count(*) FROM finance_report_by_service(d0, d1, both_branches))
    + (SELECT count(*) FROM finance_report_by_doctor(d0, d1, both_branches))
    + (SELECT count(*) FROM finance_report_cash_closings(d0, d1, both_branches)) INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01: with no clinic context the reports show % rows', n; END IF;
END $$;
SET LOCAL app.clinic_id = '00000000-0000-7000-8000-00000000000a';
