-- Two clinics (A, B) with one row in every clinic-owned table, written by the owner role.
INSERT INTO clinics VALUES
  ('00000000-0000-7000-8000-00000000000a','alpha','أ','A','dermatology','ar','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now()),
  ('00000000-0000-7000-8000-00000000000b','beta','ب','B','obgyn','en','Asia/Kuwait','active',now()+interval '30 days',10,3,now(),now());
-- The permission catalogue is seeded by db/sql/0026; tests look it up by key.

DO $$
DECLARE c uuid; s text;
BEGIN
  FOREACH c IN ARRAY ARRAY['00000000-0000-7000-8000-00000000000a','00000000-0000-7000-8000-00000000000b']::uuid[] LOOP
    s := right(c::text, 1);
    INSERT INTO clinic_features VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'1')::uuid, 'patients', true, now());
    INSERT INTO branches VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid, 'ف', 'B', true, now(), now());
    INSERT INTO roles VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'3')::uuid, 'doctor', 'طبيب', 'Doctor', false, true, now(), now());
    INSERT INTO role_permissions VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'4')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'3')::uuid, (SELECT id FROM permissions WHERE key = 'view:patients:branch'), now());
    INSERT INTO memberships VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid, ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, 'n', s||'@example.com', ('00000000-0000-7000-8000-0000000001'||s||'3')::uuid, false, 'active', 'ar', null, now(), now());
    INSERT INTO membership_branches VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'6')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid, now());
    INSERT INTO invitations VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'7')::uuid, 'i'||s||'@example.com', 'n', ('00000000-0000-7000-8000-0000000001'||s||'3')::uuid, false, 'pending', now()+interval '7 days', ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, 'hash-'||s, now(), null);
    INSERT INTO invitation_branches VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'8')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'7')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid);
    -- The civil ID as 0045 stores it (a shaped placeholder, not a real envelope): never the plain column.
    INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
        civil_id_enc, civil_id_hmac, civil_id_last4, status, created_at, updated_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'9')::uuid, '1', 'x', '+9650000000'||s, '1990-01-01', 'female',
        ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid, 'f1.1.iv.body.tag', repeat(s, 64), '0000', 'active', now(), now());
    INSERT INTO clinic_counters VALUES (c, 'patient_file_number', 1, now());
    INSERT INTO clinic_idempotency_keys VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'c')::uuid, 'branch:create', 'k', repeat('a', 64), '{}', now());
    INSERT INTO clinic_mail_providers (clinic_id, id, kind, from_name, from_email, sealed_credentials, created_at, updated_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'d')::uuid, 'resend', 'n', s||'@example.com', 'v1.x.y.z', now(), now());
    INSERT INTO clinic_expiry_reminders VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'e')::uuid, now()+interval '30 days', now());
    INSERT INTO clinic_services VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'f')::uuid, 'ليزر', 'Laser '||s, 30, 'active', now(), now());
    INSERT INTO provider_schedules VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'1')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid, 0, '08:00', '12:00', now());
    INSERT INTO provider_time_off VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'2')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid, now() + interval '1 day', now() + interval '2 days', null, null, now(), now());
    INSERT INTO appointments VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'3')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'9')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'f')::uuid, now() + interval '1 day', now() + interval '1 day 30 minutes', 'booked', false, null, null, ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, now(), now());
    -- The medical tables (0046): a walk-in visit, its note and addendum, and the patient's medical file.
    INSERT INTO visits VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'5')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'9')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid, null, 'draft', now(), null, null, null, null, now(), now());
    INSERT INTO visit_notes VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'6')::uuid, ('00000000-0000-7000-8000-0000000003'||s||'5')::uuid, 'f1.1.iv.ct.tag', null, null, null, ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid, now(), now());
    INSERT INTO visit_addenda VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'7')::uuid, ('00000000-0000-7000-8000-0000000003'||s||'5')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid, 'f1.1.iv.ct.tag', now());
    INSERT INTO patient_medical_profiles VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'8')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'9')::uuid, 'f1.1.iv.ct.tag', null, null, null, null, ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid, now(), now());
    -- 0047 and 0048: a diagnosis and a prescription item of that visit, and the clinic's medicines list.
    INSERT INTO visit_diagnoses VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'9')::uuid, ('00000000-0000-7000-8000-0000000003'||s||'5')::uuid, 0, 'icd10', 'f1.1.iv.ct.tag', 'f1.1.iv.ct.tag', now(), null);
    INSERT INTO visit_prescription_items VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'a')::uuid, ('00000000-0000-7000-8000-0000000003'||s||'5')::uuid, 0, 'f1.1.iv.ct.tag', 'f1.1.iv.ct.tag', 'f1.1.iv.ct.tag', 'f1.1.iv.ct.tag', null, now(), null);
    INSERT INTO clinic_medicines VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'b')::uuid, 'Paracetamol '||s, '500 mg', null, 'active', now(), now());
    -- An attachment on the visit (0049); its storage key is the row's own clinic and id.
    INSERT INTO patient_attachments VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'c')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'9')::uuid, ('00000000-0000-7000-8000-0000000003'||s||'5')::uuid, 'clinic/'||c||'/00000000-0000-7000-8000-0000000003'||s||'c', 'image/png', 1024, repeat('a', 64), 'f1.1.iv.ct.tag', 'active', ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid, now(), now());
    -- Patient notifications (0054, 0056): the clinic's message switches and one queued booking email.
    INSERT INTO clinic_notification_settings VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'d')::uuid, true, true, true, true, true, true, true, now(), now());
    INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id, subject_at, status, created_at, updated_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'e')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'9')::uuid, 'booked', 'email', 'appointment', ('00000000-0000-7000-8000-0000000003'||s||'3')::uuid, now() + interval '1 day', 'queued', now(), now());
    -- The clinic's WhatsApp channel (0057): an Evolution link in progress after the risk was accepted.
    INSERT INTO clinic_whatsapp_channels (clinic_id, id, transport, status, instance_name, risk_accepted_at, risk_accepted_by, risk_version, created_at, updated_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'f')::uuid, 'evolution', 'pending', 'eyadex-'||c, now(), ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, 1, now(), now());
    -- Finance F1 (0060): a used prefix, a doctor price, a sequence, one issued invoice and its line.
    INSERT INTO used_invoice_prefixes VALUES (c, ('00000000-0000-7000-8000-0000000004'||s||'1')::uuid, 'P'||upper(s), ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid, now());
    INSERT INTO service_provider_prices VALUES (c, ('00000000-0000-7000-8000-0000000004'||s||'2')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'f')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid, 15000, now(), now());
    INSERT INTO invoice_sequences VALUES (c, ('00000000-0000-7000-8000-0000000004'||s||'3')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid, 2026, 2, now(), now());
    INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status, source, source_id,
        issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp, tax_minor, total_minor,
        created_by, created_at, updated_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000004'||s||'4')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'9')::uuid, 2026, 1, 'P'||upper(s)||'-2026-000001', 'issued', 'manual', null,
        now(), 'KWD', 3, 15000, 0, 0, 0, 15000, ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, now(), now());
    INSERT INTO invoice_lines (clinic_id, id, invoice_id, position, kind, service_id, provider_id, description_ar,
        description_en, quantity, unit_price_minor, line_total_minor, created_at, updated_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000004'||s||'5')::uuid, ('00000000-0000-7000-8000-0000000004'||s||'4')::uuid, 0, 'service', ('00000000-0000-7000-8000-0000000001'||s||'f')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid, 'ليزر', 'Laser', 1, 15000, 15000, now(), now());
    INSERT INTO invoice_links VALUES (c, ('00000000-0000-7000-8000-0000000004'||s||'6')::uuid, ('00000000-0000-7000-8000-0000000004'||s||'4')::uuid, ('00000000-0000-7000-8000-0000000003'||s||'e')::uuid, sha256(convert_to('link-'||s, 'UTF8')),
      'v1.iv.body.tag', now() + interval '14 days', null, now());
    -- Finance F2 (0064): one row in each money table; the rows roll back, so 0066's commit-time checks never fire here.
    INSERT INTO clinic_payment_methods (clinic_id, id, method, enabled, created_at, updated_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000005'||s||'1')::uuid, 'cash', true, now(), now());
    INSERT INTO receipt_sequences (clinic_id, id, branch_id, series, year, next_number, created_at, updated_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000005'||s||'2')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid, 'receipt', 2026, 2, now(), now());
    INSERT INTO payments (clinic_id, id, branch_id, patient_id, invoice_id, year, receipt_seq, receipt_number, method,
        amount_minor, currency, currency_exponent, reference, received_at, business_date, cash_seq, received_by, created_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000005'||s||'3')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid,
        ('00000000-0000-7000-8000-0000000001'||s||'9')::uuid, ('00000000-0000-7000-8000-0000000004'||s||'4')::uuid, 2026, 1,
        'P'||upper(s)||'-R-2026-000001', 'cash', 15000, 'KWD', 3, null, now(), current_date, 1,
        ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, now());
    INSERT INTO payment_allocations (clinic_id, id, invoice_id, patient_id, payment_id, credit_id, amount_minor, created_by, created_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000005'||s||'4')::uuid, ('00000000-0000-7000-8000-0000000004'||s||'4')::uuid,
        ('00000000-0000-7000-8000-0000000001'||s||'9')::uuid, ('00000000-0000-7000-8000-0000000005'||s||'3')::uuid, null, 15000,
        ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, now());
    INSERT INTO patient_credits (clinic_id, id, patient_id, origin_allocation_id, amount_minor, cause, created_by, created_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000005'||s||'5')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'9')::uuid,
        ('00000000-0000-7000-8000-0000000005'||s||'4')::uuid, 1000, 'refund', ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, now());
    INSERT INTO refunds (clinic_id, id, branch_id, patient_id, invoice_id, year, refund_seq, refund_number, method,
        amount_minor, currency, currency_exponent, reason, refunded_at, business_date, cash_seq, refunded_by, created_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000005'||s||'6')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid,
        ('00000000-0000-7000-8000-0000000001'||s||'9')::uuid, ('00000000-0000-7000-8000-0000000004'||s||'4')::uuid, 2026, 1,
        'P'||upper(s)||'-RF-2026-000001', 'knet', 1000, 'KWD', 3, 'x', now(), current_date, null,
        ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, now());
    INSERT INTO refund_sources (clinic_id, id, refund_id, credit_id, patient_id, amount_minor, created_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000005'||s||'8')::uuid, ('00000000-0000-7000-8000-0000000005'||s||'6')::uuid,
        ('00000000-0000-7000-8000-0000000005'||s||'5')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'9')::uuid, 1000, now());
    INSERT INTO cash_closings (clinic_id, id, branch_id, business_date, from_cash_seq, to_cash_seq, expected_minor,
        counted_minor, method_totals, note, previous_closing_id, currency, currency_exponent, closed_by, closed_at, created_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000005'||s||'7')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid,
        current_date, 0, 1, 15000, 15000, '[]'::jsonb, null, null, 'KWD', 3,
        ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, now(), now());
    INSERT INTO branch_cash_drawers (clinic_id, id, branch_id, last_cash_seq, last_closed_seq, last_closing_id, created_at, updated_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000005'||s||'9')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'2')::uuid, 1, 1,
        ('00000000-0000-7000-8000-0000000005'||s||'7')::uuid, now(), now());
    -- Finance F3 (0068): one export request and the blob key of its first attempt.
    INSERT INTO finance_report_exports (clinic_id, id, requested_by, report, params, format, scope, status, created_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000006'||s||'1')::uuid, ('00000000-0000-7000-8000-0000000001'||s||'5')::uuid,
        'daily_takings', '{}'::jsonb, 'csv', 'clinic', 'queued', now());
    INSERT INTO finance_report_export_blobs (clinic_id, id, export_id, attempt, storage_key, state, created_at, updated_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000006'||s||'2')::uuid, ('00000000-0000-7000-8000-0000000006'||s||'1')::uuid, 1,
        'clinic/'||c||'/finance-exports/00000000-0000-7000-8000-0000000006'||s||'1/1.csv', 'allocated', now(), now());
    -- An export of an aggregate report is administrative, yet never the platform's (0068).
    INSERT INTO finance_report_export_patients (clinic_id, id, export_id, attempt, patient_id, created_at)
      VALUES (c, ('00000000-0000-7000-8000-0000000006'||s||'4')::uuid,
        ('00000000-0000-7000-8000-0000000006'||s||'1')::uuid, 1,
        ('00000000-0000-7000-8000-0000000001'||s||'9')::uuid, now());
    INSERT INTO audit_log VALUES (c, ('00000000-0000-7000-8000-0000000006'||s||'3')::uuid, ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, 'finance_report.exported', 'administrative', 'finance_report_export', ('00000000-0000-7000-8000-0000000006'||s||'1')::uuid, null, '{"report":"daily_takings"}', now());
    -- An appointment's audit row names a patient's booking: administrative, yet never the platform's (0043).
    INSERT INTO audit_log VALUES (c, ('00000000-0000-7000-8000-0000000003'||s||'4')::uuid, ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, 'appointment.booked', 'administrative', 'appointment', ('00000000-0000-7000-8000-0000000003'||s||'3')::uuid, null, '{}', now());
    INSERT INTO audit_log VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'a')::uuid, ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, 'user.invited', 'administrative', 'user', null, null, '{}', now());
    INSERT INTO audit_log VALUES (c, ('00000000-0000-7000-8000-0000000001'||s||'b')::uuid, ('00000000-0000-7000-8000-0000000002'||s||'5')::uuid, 'patient.opened', 'patient_access', 'patient', null, null, '{}', now());
  END LOOP;
END $$;

-- A patient event can never be filed as administrative (keeps the platform view patient-free).
DO $$
BEGIN
  BEGIN
    INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-00000000000a', gen_random_uuid(),
      '00000000-0000-7000-8000-0000000002a5', 'patient.updated', 'administrative', 'patient',
      null, null, '{}', now());
    RAISE EXCEPTION 'PLAT-01: a patient event was accepted as administrative';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- Spec §7.4, EY-9.15 a: an export of R5–R8 holds patient names, so its audit row is patient access.
  BEGIN
    INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-00000000000a', gen_random_uuid(),
      '00000000-0000-7000-8000-0000000002a5', 'finance_report.exported', 'administrative', 'finance_report_export',
      '00000000-0000-7000-8000-0000000006a1', null, '{"report":"outstanding"}', now());
    RAISE EXCEPTION 'PLAT-01: a patient-named export was accepted as administrative';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO audit_log VALUES ('00000000-0000-7000-8000-00000000000a', gen_random_uuid(),
      '00000000-0000-7000-8000-0000000002a5', 'finance_report.exported', 'administrative', 'finance_report_export',
      '00000000-0000-7000-8000-0000000006a1', null, '{}', now());
    RAISE EXCEPTION 'PLAT-01: an export with no report was accepted as administrative';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- PR #124 review: an export row names only its own object, in its own clinic.
  BEGIN
    UPDATE finance_report_exports SET storage_key =
      'clinic/00000000-0000-7000-8000-00000000000b/finance-exports/00000000-0000-7000-8000-0000000006a1/0.csv'
      WHERE id = '00000000-0000-7000-8000-0000000006a1';
    RAISE EXCEPTION 'ISO-01: an export accepted another clinic''s storage key';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO finance_report_export_blobs (clinic_id, id, export_id, attempt, storage_key, state, created_at, updated_at)
      VALUES ('00000000-0000-7000-8000-00000000000a', gen_random_uuid(), '00000000-0000-7000-8000-0000000006a1', 2,
        'clinic/00000000-0000-7000-8000-00000000000a/finance-exports/00000000-0000-7000-8000-0000000006a1/3.csv',
        'allocated', now(), now());
    RAISE EXCEPTION 'ISO-01: a blob row accepted another attempt''s key';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
