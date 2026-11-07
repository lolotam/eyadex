-- PDF ledger rows for both clinics; retained only inside the caller rollback.
DO $$
DECLARE c uuid; suffix text; job uuid; upload uuid; inv uuid;
BEGIN
  FOREACH suffix IN ARRAY ARRAY['a','b'] LOOP
    c := ('00000000-0000-7000-8000-00000000000'||suffix)::uuid;
    job := ('00000000-0000-7000-8000-0000000007'||suffix||'1')::uuid;
    upload := ('00000000-0000-7000-8000-0000000007'||suffix||'2')::uuid;
    inv := ('00000000-0000-7000-8000-0000000004'||suffix||'4')::uuid;
    INSERT INTO invoice_pdf_jobs(clinic_id,id,invoice_id,invoice_version,render_revision,clinic_slot,created_at,updated_at)
      VALUES(c,job,inv,1,'v1:1:1:1',1,now(),now());
    UPDATE invoice_pdf_jobs SET status='running',attempt=1,fence=1,lease_token=gen_random_uuid(),
      lease_until=clock_timestamp()+interval '20 seconds',deadline_at=clock_timestamp()+interval '40 seconds'
      WHERE clinic_id=c AND id=job;
    INSERT INTO invoice_pdf_upload_attempts(clinic_id,id,job_id,attempt,fence,state,storage_key,upload_deadline_at,created_at,updated_at)
      VALUES(c,upload,job,1,1,'allocated','clinic/'||c||'/invoice-pdfs/'||job||'/'||upload,
        clock_timestamp()+interval '10 seconds',now(),now());
    INSERT INTO invoice_pdf_artifacts(clinic_id,id,job_id,upload_id,state,cipher_key_version,byte_length,published_at,expires_at)
      VALUES(c,upload,job,upload,'ready',1,1,now(),now()+interval '24 hours');
  END LOOP;
END $$;
