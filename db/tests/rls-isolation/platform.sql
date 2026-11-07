-- PLAT-01: the platform role sees every clinic, never patients or patient-access audit rows.
-- The view must cross clinics without relying on a clinic context or a superuser owner.
RESET app.clinic_id;
SET LOCAL ROLE eyadex_platform;
DO $$
DECLARE n bigint; t text;
BEGIN
  SELECT count(*) INTO n FROM clinics;
  IF n < 2 THEN RAISE EXCEPTION 'PLAT: platform sees % clinics', n; END IF;
  BEGIN PERFORM 1 FROM patients LIMIT 1; RAISE EXCEPTION 'PLAT-01: platform can read patients';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM clinic_counters LIMIT 1; RAISE EXCEPTION 'PLAT-01: platform can read clinic_counters';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM clinic_idempotency_keys LIMIT 1; RAISE EXCEPTION 'PLAT: platform can read clinic_idempotency_keys';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM clinic_mail_providers LIMIT 1; RAISE EXCEPTION 'PLAT: platform can read clinic_mail_providers';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM clinic_expiry_reminders LIMIT 1; RAISE EXCEPTION 'PLAT: platform can read clinic_expiry_reminders';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM clinic_services LIMIT 1; RAISE EXCEPTION 'PLAT: platform can read clinic_services';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM provider_schedules LIMIT 1; RAISE EXCEPTION 'PLAT: platform can read provider_schedules';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM provider_time_off LIMIT 1; RAISE EXCEPTION 'PLAT: platform can read provider_time_off';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM appointments LIMIT 1; RAISE EXCEPTION 'PLAT-01: platform can read appointments';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM clinic_medicines LIMIT 1; RAISE EXCEPTION 'PLAT: platform can read clinic_medicines';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM clinic_notification_settings LIMIT 1; RAISE EXCEPTION 'PLAT: platform can read clinic_notification_settings';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM patient_notifications LIMIT 1; RAISE EXCEPTION 'PLAT-01: platform can read patient_notifications';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM clinic_whatsapp_channels LIMIT 1; RAISE EXCEPTION 'PLAT: platform can read clinic_whatsapp_channels';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Finance (0060): no platform privilege on any finance table.
  FOREACH t IN ARRAY ARRAY['used_invoice_prefixes','service_provider_prices','invoice_sequences','invoices','invoice_lines','invoice_links',
      'clinic_payment_methods','receipt_sequences','payments','payment_allocations','patient_credits','refunds',
      'refund_sources','cash_closings','branch_cash_drawers','finance_report_exports',
      'finance_report_export_blobs','finance_report_export_patients','finance_invoice_balances','invoice_pdf_jobs','invoice_pdf_upload_attempts','invoice_pdf_artifacts'] LOOP
    BEGIN EXECUTE format('SELECT 1 FROM %I LIMIT 1', t); RAISE EXCEPTION 'PLAT-01: platform can read %', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  BEGIN PERFORM 1 FROM finance_report_daily_takings(current_date, current_date, ARRAY[]::uuid[]);
    RAISE EXCEPTION 'PLAT-01: platform can run the report functions';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT count(*) INTO n FROM platform_clinic_admin_audit WHERE entity_type = 'finance_report_export';
  IF n <> 0 THEN RAISE EXCEPTION 'PLAT-01: admin audit view exposes report exports'; END IF;
  -- 0059: the pre-tenant routing of Meta's webhook is the clinic API's only.
  BEGIN PERFORM whatsapp_clinic_for_phone_number('12345'); RAISE EXCEPTION 'PLAT: platform can route a Meta number';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM audit_log LIMIT 1; RAISE EXCEPTION 'PLAT-01: platform can read audit_log';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT count(*) INTO n FROM platform_clinic_admin_audit WHERE action = 'patient.opened';
  IF n <> 0 THEN RAISE EXCEPTION 'PLAT-01: admin audit view exposes patient access'; END IF;
  SELECT count(*) INTO n FROM platform_clinic_admin_audit WHERE entity_type = 'appointment';
  IF n <> 0 THEN RAISE EXCEPTION 'PLAT-01: admin audit view exposes appointments'; END IF;
  SELECT count(*) INTO n FROM platform_clinic_admin_audit
    WHERE clinic_id IN ('00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-00000000000b');
  IF n <> 2 THEN RAISE EXCEPTION 'PLAT: admin audit view shows %, expected 2', n; END IF;
END $$;

RESET ROLE;
