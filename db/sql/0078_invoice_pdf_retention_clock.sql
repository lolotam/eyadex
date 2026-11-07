-- Server-owned retention ages; local schema candidate, release HOLD remains.
CREATE FUNCTION invoice_pdf_job_clock() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN NEW.created_at := statement_timestamp(); END IF;
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION invoice_pdf_job_clock() FROM PUBLIC;
CREATE TRIGGER invoice_pdf_job_clock BEFORE INSERT OR UPDATE ON invoice_pdf_jobs
FOR EACH ROW EXECUTE FUNCTION invoice_pdf_job_clock();

CREATE FUNCTION invoice_pdf_evidence_clock() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.state='deleted' THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN NEW.deleted_at := NULL;
  ELSIF NEW.state='deleted' THEN NEW.deleted_at := statement_timestamp();
  ELSE NEW.deleted_at := OLD.deleted_at; END IF;
  IF TG_TABLE_NAME='invoice_pdf_upload_attempts' THEN
    NEW.updated_at := statement_timestamp();
    IF TG_OP='INSERT' THEN
      NEW.created_at := statement_timestamp(); NEW.terminal_at := NULL;
    ELSIF OLD.terminal_at IS NULL AND NEW.state IN ('unknown','published','deleting','deleted') THEN
      NEW.terminal_at := statement_timestamp();
    ELSE NEW.terminal_at := OLD.terminal_at; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION invoice_pdf_evidence_clock() FROM PUBLIC;
CREATE TRIGGER invoice_pdf_upload_clock BEFORE INSERT OR UPDATE ON invoice_pdf_upload_attempts
FOR EACH ROW EXECUTE FUNCTION invoice_pdf_evidence_clock();
CREATE TRIGGER invoice_pdf_artifact_clock BEFORE INSERT OR UPDATE ON invoice_pdf_artifacts
FOR EACH ROW EXECUTE FUNCTION invoice_pdf_evidence_clock();

-- Publication and cleanup serialize through the same upload row.
CREATE FUNCTION invoice_pdf_artifact_upload_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  PERFORM 1 FROM public.invoice_pdf_upload_attempts u
    WHERE u.clinic_id=NEW.clinic_id AND u.job_id=NEW.job_id AND u.id=NEW.upload_id
      AND u.state NOT IN ('deleting','deleted') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pdf_artifact_upload'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION invoice_pdf_artifact_upload_guard() FROM PUBLIC;
CREATE TRIGGER invoice_pdf_artifact_upload_guard BEFORE INSERT ON invoice_pdf_artifacts
FOR EACH ROW EXECUTE FUNCTION invoice_pdf_artifact_upload_guard();

CREATE FUNCTION invoice_pdf_upload_cleanup_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.state IN ('deleting','deleted') AND EXISTS
    (SELECT 1 FROM public.invoice_pdf_artifacts a
     WHERE a.clinic_id=NEW.clinic_id AND a.upload_id=NEW.id AND a.state='ready') THEN
    RAISE EXCEPTION 'pdf_upload_live_artifact';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION invoice_pdf_upload_cleanup_guard() FROM PUBLIC;
CREATE TRIGGER invoice_pdf_upload_cleanup_guard BEFORE UPDATE OF state ON invoice_pdf_upload_attempts
FOR EACH ROW EXECUTE FUNCTION invoice_pdf_upload_cleanup_guard();
