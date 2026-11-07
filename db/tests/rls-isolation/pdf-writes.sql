-- The runtime identity stays scoped to A while targeting B's known seeded rows.
DO $$
DECLARE t text; n bigint; b uuid := '00000000-0000-7000-8000-00000000000b';
BEGIN
  FOREACH t IN ARRAY ARRAY['invoice_pdf_jobs','invoice_pdf_upload_attempts','invoice_pdf_artifacts'] LOOP
    EXECUTE format('UPDATE %I SET %I=%I WHERE clinic_id=$1', t,
      CASE WHEN t='invoice_pdf_jobs' THEN 'status' ELSE 'state' END,
      CASE WHEN t='invoice_pdf_jobs' THEN 'status' ELSE 'state' END) USING b;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'PDF write isolation: % updated another clinic',t; END IF;
  END LOOP;
  BEGIN
    INSERT INTO invoice_pdf_jobs(clinic_id,id,invoice_id,invoice_version,render_revision,clinic_slot,created_at,updated_at)
      VALUES(b,gen_random_uuid(),'00000000-0000-7000-8000-0000000004b4',1,'other',2,now(),now());
    RAISE EXCEPTION 'PDF write isolation: inserted a job for another clinic';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO invoice_pdf_upload_attempts(clinic_id,id,job_id,attempt,fence,state,storage_key,upload_deadline_at,created_at,updated_at)
      VALUES(b,gen_random_uuid(),'00000000-0000-7000-8000-0000000007b1',1,1,'allocated','other',now(),now(),now());
    RAISE EXCEPTION 'PDF write isolation: inserted an upload for another clinic';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN raise_exception THEN IF SQLERRM <> 'pdf_upload_fence' THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO invoice_pdf_artifacts(clinic_id,id,job_id,upload_id,state,cipher_key_version,byte_length,published_at,expires_at)
      VALUES(b,gen_random_uuid(),'00000000-0000-7000-8000-0000000007b1',
        '00000000-0000-7000-8000-0000000007b2','ready',1,1,now(),now()+interval '24 hours');
    RAISE EXCEPTION 'PDF write isolation: inserted an artifact for another clinic';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
