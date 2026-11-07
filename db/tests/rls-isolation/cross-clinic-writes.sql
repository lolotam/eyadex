-- Writes into another clinic must fail (RLS WITH CHECK), one probe per writable table.
DO $$
DECLARE b uuid := '00000000-0000-7000-8000-00000000000b'; n bigint; m text;
BEGIN
  BEGIN
    INSERT INTO branches VALUES (b, gen_random_uuid(), 'x', 'x', true, now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: branches';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO invitation_branches VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b7', '00000000-0000-7000-8000-0000000001b2');
    RAISE EXCEPTION 'ISO-01 write leak: invitation_branches';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO patients (clinic_id, id, file_number, full_name, phone, birth_date, gender, registration_branch_id,
        status, created_at, updated_at)
      VALUES (b, gen_random_uuid(), '9', 'z', '+96500000099', '1990-01-01', 'male', '00000000-0000-7000-8000-0000000001b2',
        'active', now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: patients';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO clinic_counters VALUES (b, 'patient_file_number', 99, now())
      ON CONFLICT (clinic_id, name) DO UPDATE SET value = clinic_counters.value + 1;
    RAISE EXCEPTION 'ISO-01 write leak: clinic_counters';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO roles VALUES (b, gen_random_uuid(), null, 'x', 'x', false, true, now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: roles';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO role_permissions VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b3', (SELECT id FROM permissions WHERE key = 'view:patients:branch'), now());
    RAISE EXCEPTION 'ISO-01 write leak: role_permissions';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO memberships VALUES (b, gen_random_uuid(), gen_random_uuid(), 'x', 'x@example.com', '00000000-0000-7000-8000-0000000001b3', true, 'active', 'ar', null, now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: memberships';
  -- RLS or the email-hold trigger (0017) rejects it; either way the write is refused.
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
  BEGIN
    INSERT INTO membership_branches VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b5', '00000000-0000-7000-8000-0000000001b2', now());
    RAISE EXCEPTION 'ISO-01 write leak: membership_branches';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO invitations VALUES (b, gen_random_uuid(), 'x@example.com', 'x', '00000000-0000-7000-8000-0000000001b3', true, 'pending', now() + interval '7 days', gen_random_uuid(), 'hash-probe', now(), null);
    RAISE EXCEPTION 'ISO-01 write leak: invitations';
  -- RLS or the email-hold trigger (0017) rejects it; either way the write is refused.
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
  BEGIN
    INSERT INTO clinic_idempotency_keys VALUES (b, gen_random_uuid(), 'branch:create', 'probe', repeat('a', 64), NULL, now());
    RAISE EXCEPTION 'ISO-01 write leak: clinic_idempotency_keys';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO clinic_mail_providers (clinic_id, id, kind, from_name, from_email, sealed_credentials, created_at, updated_at)
      VALUES (b, gen_random_uuid(), 'resend', 'x', 'x@example.com', 'v1', now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: clinic_mail_providers';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO clinic_expiry_reminders VALUES (b, gen_random_uuid(), now() + interval '1 day', now());
    RAISE EXCEPTION 'ISO-01 write leak: clinic_expiry_reminders';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO clinic_services VALUES (b, gen_random_uuid(), 'x', 'x', 30, 'active', now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: clinic_services';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO provider_schedules VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b5', '00000000-0000-7000-8000-0000000001b2', 1, '08:00', '09:00', now());
    RAISE EXCEPTION 'ISO-01 write leak: provider_schedules';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO provider_time_off VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b5', now(), now() + interval '1 hour', null, null, now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: provider_time_off';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO appointments VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b2', '00000000-0000-7000-8000-0000000001b9', '00000000-0000-7000-8000-0000000001b5', null, now(), now() + interval '30 minutes', 'booked', false, null, null, gen_random_uuid(), now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: appointments';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO visits VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b2', '00000000-0000-7000-8000-0000000001b9', '00000000-0000-7000-8000-0000000001b5', null, 'draft', now(), null, null, null, null, now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: visits';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO visit_notes VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000003b5', null, null, null, null, gen_random_uuid(), now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: visit_notes';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO visit_addenda VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000003b5', gen_random_uuid(), 'f1.1.iv.ct.tag', now());
    RAISE EXCEPTION 'ISO-01 write leak: visit_addenda';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO patient_medical_profiles VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b9', null, null, null, null, null, gen_random_uuid(), now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: patient_medical_profiles';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO visit_diagnoses VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000003b5', 1, 'text', null, 'f1.1.iv.ct.tag', now(), null);
    RAISE EXCEPTION 'ISO-01 write leak: visit_diagnoses';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO visit_prescription_items VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000003b5', 1, 'f1.1.iv.ct.tag', 'f1.1.iv.ct.tag', 'f1.1.iv.ct.tag', 'f1.1.iv.ct.tag', null, now(), null);
    RAISE EXCEPTION 'ISO-01 write leak: visit_prescription_items';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO clinic_medicines VALUES (b, gen_random_uuid(), 'probe', null, null, 'active', now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: clinic_medicines';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO patient_attachments VALUES (b, '00000000-0000-7000-8000-0000000003bf', '00000000-0000-7000-8000-0000000001b9', null, 'clinic/00000000-0000-7000-8000-00000000000b/00000000-0000-7000-8000-0000000003bf', 'application/pdf', 1, repeat('b', 64), 'f1.1.iv.ct.tag', 'active', gen_random_uuid(), now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: patient_attachments';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO clinic_notification_settings VALUES (b, gen_random_uuid(), false, false, false, false, false, false, false, now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: clinic_notification_settings';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO patient_notifications (clinic_id, id, patient_id, kind, channel, subject_type, subject_id, subject_at, status, created_at, updated_at)
      VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b9', 'reminder_day', 'email', 'appointment', '00000000-0000-7000-8000-0000000003b3', now() + interval '1 day', 'queued', now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: patient_notifications';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO clinic_whatsapp_channels (clinic_id, id, status, created_at, updated_at)
      VALUES (b, gen_random_uuid(), 'disconnected', now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: clinic_whatsapp_channels';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO used_invoice_prefixes VALUES (b, gen_random_uuid(), 'ZZ', '00000000-0000-7000-8000-0000000001b2', now());
    RAISE EXCEPTION 'ISO-01 write leak: used_invoice_prefixes';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO service_provider_prices VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001bf', '00000000-0000-7000-8000-0000000001b5', 1, now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: service_provider_prices';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO invoice_sequences VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b2', 2027, 1, now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: invoice_sequences';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO invoices (clinic_id, id, branch_id, patient_id, year, number_seq, number, status, source, source_id,
        issued_at, currency, currency_exponent, subtotal_minor, discount_minor, tax_rate_bp, tax_minor, total_minor,
        created_by, created_at, updated_at)
      VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000001b2', '00000000-0000-7000-8000-0000000001b9', 2026, 9, 'PB-2026-000009', 'issued', 'manual', null,
        now(), 'KWD', 3, 0, 0, 0, 0, 0, gen_random_uuid(), now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: invoices';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO invoice_lines (clinic_id, id, invoice_id, position, kind, description_ar, description_en, quantity,
        unit_price_minor, line_total_minor, created_at, updated_at)
      VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000004b4', 1, 'free', 'x', 'x', 1, 0, 0, now(), now());
    RAISE EXCEPTION 'ISO-01 write leak: invoice_lines';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO invoice_links VALUES (b, gen_random_uuid(), '00000000-0000-7000-8000-0000000004b4',
      '00000000-0000-7000-8000-0000000003be', sha256(convert_to('probe', 'UTF8')), 'v1.x', now(), null, now());
    RAISE EXCEPTION 'ISO-01 write leak: invoice_links';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
