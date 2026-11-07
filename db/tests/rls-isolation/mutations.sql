DO $$
DECLARE b uuid := '00000000-0000-7000-8000-00000000000b'; n bigint; m text;
BEGIN
  -- Moving an own row into another clinic must fail on WITH CHECK, for every writable table.
  DECLARE t text;
  BEGIN
    FOREACH t IN ARRAY ARRAY['branches','roles','role_permissions','memberships','membership_branches',
        'invitations','invitation_branches','patients','clinic_counters','clinic_mail_providers',
        'clinic_services','provider_schedules','provider_time_off','appointments','visits',
        'visit_notes','patient_medical_profiles','visit_diagnoses','visit_prescription_items',
        'clinic_medicines','patient_attachments','clinic_notification_settings',
        'patient_notifications','clinic_whatsapp_channels','service_provider_prices','invoice_sequences',
        'invoices','invoice_lines','invoice_links','used_invoice_prefixes','clinic_payment_methods',
        'receipt_sequences','branch_cash_drawers','finance_report_exports','finance_report_export_blobs','finance_report_export_patients'] LOOP
      BEGIN
        EXECUTE format('UPDATE %I SET clinic_id = $1', t) USING b;
        RAISE EXCEPTION 'ISO-01 write leak: % rows can be moved to another clinic', t;
      EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL; END;
    END LOOP;
  END;
  BEGIN
    INSERT INTO finance_report_export_patients (clinic_id, id, export_id, attempt, patient_id, created_at)
      VALUES (b, '00000000-0000-7000-8000-0000000006bf', '00000000-0000-7000-8000-0000000006b1',
        1, '00000000-0000-7000-8000-0000000001b9', now());
    RAISE EXCEPTION 'ISO-01 write leak: finance_report_export_patients';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Updating another clinic's rows silently affects nothing (rows are invisible).
  UPDATE patients SET full_name = 'hacked' WHERE clinic_id = b;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01 write leak: updated % patients of another clinic', n; END IF;
  -- Append-only audit and no deletes anywhere.
  BEGIN DELETE FROM audit_log; RAISE EXCEPTION 'audit_log is deletable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE audit_log SET action = 'x'; RAISE EXCEPTION 'audit_log is updatable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM patients; RAISE EXCEPTION 'patients are hard-deletable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Appointments configuration (ADR-0026): services and time off are never deleted; a schedule row is
  -- replaced, and replacing never reaches another clinic's rows.
  BEGIN DELETE FROM clinic_services; RAISE EXCEPTION 'clinic_services are hard-deletable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM provider_time_off; RAISE EXCEPTION 'provider_time_off is hard-deletable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE provider_schedules SET weekday = 1; RAISE EXCEPTION 'provider_schedules are updatable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  DELETE FROM provider_schedules WHERE clinic_id = b;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01 write leak: deleted % schedule rows of another clinic', n; END IF;
  -- Appointments (0043) are cancelled, never deleted; another clinic's are invisible to updates.
  BEGIN DELETE FROM appointments; RAISE EXCEPTION 'appointments are hard-deletable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE appointments SET status = 'arrived' WHERE clinic_id = b;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01 write leak: updated % appointments of another clinic', n; END IF;
  -- The medical tables (0046–0049) are never deleted, and an addendum is never edited (P2-6).
  FOREACH m IN ARRAY ARRAY['visits','visit_notes','visit_addenda','patient_medical_profiles',
      'visit_diagnoses','visit_prescription_items','clinic_medicines','patient_attachments'] LOOP
    BEGIN EXECUTE format('DELETE FROM %I', m); RAISE EXCEPTION '% are hard-deletable', m;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  BEGIN UPDATE visit_addenda SET body_enc = body_enc; RAISE EXCEPTION 'visit_addenda are updatable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Notification settings are switched off, never deleted; the message ledger is history (0054, 0056);
  -- a WhatsApp channel is unlinked to `disconnected`, never deleted (0057).
  FOREACH m IN ARRAY ARRAY['clinic_notification_settings','patient_notifications',
      'clinic_whatsapp_channels'] LOOP
    BEGIN EXECUTE format('DELETE FROM %I', m); RAISE EXCEPTION '% are hard-deletable', m;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  -- Finance (0060): invoices and lines are never deleted (a void keeps them; a removed line is archived), and
  -- a used prefix is history that is neither edited nor removed.
  FOREACH m IN ARRAY ARRAY['invoices','invoice_lines','invoice_sequences','used_invoice_prefixes','invoice_links'] LOOP
    BEGIN EXECUTE format('DELETE FROM %I', m); RAISE EXCEPTION '% are hard-deletable', m;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  BEGIN UPDATE used_invoice_prefixes SET prefix = prefix; RAISE EXCEPTION 'used_invoice_prefixes are updatable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Finance F2 (0064, spec §4.2): money rows are append-only — never updated, never deleted; the counters and the
  -- payment-methods row are updated, never deleted.
  FOREACH m IN ARRAY ARRAY['payments','payment_allocations','patient_credits','refunds','refund_sources','cash_closings'] LOOP
    BEGIN EXECUTE format('UPDATE %I SET created_at = created_at', m); RAISE EXCEPTION '% are updatable', m;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN EXECUTE format('DELETE FROM %I', m); RAISE EXCEPTION '% are hard-deletable', m;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  FOREACH m IN ARRAY ARRAY['clinic_payment_methods','receipt_sequences','branch_cash_drawers'] LOOP
    BEGIN EXECUTE format('DELETE FROM %I', m); RAISE EXCEPTION '% are hard-deletable', m;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  -- Finance F3 (0068, pipeline §8): the export rows and their blob keys are the trail, never deleted.
  FOREACH m IN ARRAY ARRAY['finance_report_exports','finance_report_export_blobs','finance_report_export_patients'] LOOP
    BEGIN EXECUTE format('DELETE FROM %I', m); RAISE EXCEPTION '% are hard-deletable', m;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  UPDATE finance_report_exports SET status = 'failed' WHERE clinic_id = b;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01 write leak: updated % exports of another clinic', n; END IF;
  UPDATE branch_cash_drawers SET last_cash_seq = last_cash_seq WHERE clinic_id = b;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01 write leak: updated % cash drawers of another clinic', n; END IF;
  UPDATE invoices SET status = 'void', voided_at = now(), void_reason = 'x' WHERE clinic_id = b;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01 write leak: voided % invoices of another clinic', n; END IF;
  UPDATE invoice_links SET revoked_at = now() WHERE clinic_id = b;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01 write leak: revoked % links of another clinic', n; END IF;
  DELETE FROM service_provider_prices WHERE clinic_id = b;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01 write leak: deleted % doctor prices of another clinic', n; END IF;
  UPDATE patient_notifications SET status = 'failed' WHERE clinic_id = b;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01 write leak: updated % notifications of another clinic', n; END IF;
  UPDATE clinic_whatsapp_channels SET status = 'disconnected' WHERE clinic_id = b;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01 write leak: updated % WhatsApp channels of another clinic', n; END IF;
  -- 0059: a delivery status never reaches another clinic's ledger, even by its provider message id.
  UPDATE patient_notifications SET status = 'failed', last_error = 'coexistence:meta_rejected'
    WHERE clinic_id = b OR provider_message_id IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'ISO-01 write leak: a delivery status reached % rows', n; END IF;
  -- R1-13: one active row per place in a visit's list; archiving frees the place.
  BEGIN
    INSERT INTO visit_diagnoses VALUES ('00000000-0000-7000-8000-00000000000a', gen_random_uuid(), '00000000-0000-7000-8000-0000000003a5', 0, 'text', null, 'f1.1.iv.ct.tag', now(), null);
    RAISE EXCEPTION 'a second active diagnosis at one position was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  UPDATE visit_diagnoses SET archived_at = now() WHERE id = '00000000-0000-7000-8000-0000000003a9';
  INSERT INTO visit_diagnoses VALUES ('00000000-0000-7000-8000-00000000000a', gen_random_uuid(), '00000000-0000-7000-8000-0000000003a5', 0, 'text', null, 'f1.1.iv.ct.tag', now(), null);
  BEGIN
    INSERT INTO visit_diagnoses VALUES ('00000000-0000-7000-8000-00000000000a', gen_random_uuid(), '00000000-0000-7000-8000-0000000003a5', 1, 'icd10', null, 'f1.1.iv.ct.tag', now(), null);
    RAISE EXCEPTION 'an ICD-10 diagnosis without a code was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO visit_prescription_items VALUES ('00000000-0000-7000-8000-00000000000a', gen_random_uuid(), '00000000-0000-7000-8000-0000000003a5', 0, 'f1.1.iv.ct.tag', 'f1.1.iv.ct.tag', 'f1.1.iv.ct.tag', 'f1.1.iv.ct.tag', null, now(), null);
    RAISE EXCEPTION 'a second active prescription item at one position was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO visit_prescription_items VALUES ('00000000-0000-7000-8000-00000000000a', gen_random_uuid(), '00000000-0000-7000-8000-0000000003a5', 1, 'Paracetamol', 'f1.1.iv.ct.tag', 'f1.1.iv.ct.tag', 'f1.1.iv.ct.tag', null, now(), null);
    RAISE EXCEPTION 'a plaintext medicine was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- P2-F2: one name per clinic, compared trimmed and case-folded.
  BEGIN
    INSERT INTO clinic_medicines VALUES ('00000000-0000-7000-8000-00000000000a', gen_random_uuid(), ' paracetamol A ', null, null, 'active', now(), now());
    RAISE EXCEPTION 'a duplicate medicine name was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  -- D-15 and D-11 in the table itself.
  BEGIN UPDATE appointments SET ends_at = starts_at + interval '4 minutes'; RAISE EXCEPTION 'a 4-minute appointment was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE appointments SET status = 'cancelled'; RAISE EXCEPTION 'a cancel without a reason was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- The booking columns are clinic data like the rest of the membership (D-1, D-15).
  BEGIN UPDATE memberships SET default_duration_minutes = 4; RAISE EXCEPTION 'a 4-minute default was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- Feature flags are platform-controlled (PRD 4.8): the clinic can read but not write them.
  BEGIN UPDATE clinic_features SET enabled = false; RAISE EXCEPTION 'clinic_features writable by eyadex_app';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

RESET ROLE;
