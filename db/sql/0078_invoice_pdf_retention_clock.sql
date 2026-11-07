DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='eyadex_pdf_retention') THEN
    CREATE ROLE eyadex_pdf_retention NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_roles r WHERE r.rolname='eyadex_pdf_retention' AND
    (r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication
      OR EXISTS (SELECT FROM pg_auth_members m WHERE m.roleid=r.oid OR m.member=r.oid))) THEN
    RAISE EXCEPTION 'pdf_private_role_unsafe: eyadex_pdf_retention';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO eyadex_pdf_retention;
GRANT SELECT,DELETE ON invoice_pdf_jobs,invoice_pdf_upload_attempts,invoice_pdf_artifacts TO eyadex_pdf_retention;
CREATE POLICY retention ON invoice_pdf_jobs TO eyadex_pdf_retention
USING (clinic_id = NULLIF(current_setting('app.clinic_id',true),'')::uuid);
CREATE POLICY retention ON invoice_pdf_upload_attempts TO eyadex_pdf_retention
USING (clinic_id = NULLIF(current_setting('app.clinic_id',true),'')::uuid);
CREATE POLICY retention ON invoice_pdf_artifacts TO eyadex_pdf_retention
USING (clinic_id = NULLIF(current_setting('app.clinic_id',true),'')::uuid);
CREATE FUNCTION purge_invoice_pdf_evidence() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  -- Bounded tenant batches. Unknown/published objects are never retention candidates.
  DELETE FROM public.invoice_pdf_artifacts WHERE (clinic_id,id) IN
    (SELECT clinic_id,id FROM public.invoice_pdf_artifacts WHERE state='deleted'
     AND deleted_at < statement_timestamp()-interval '7 days' ORDER BY deleted_at LIMIT 100);
  DELETE FROM public.invoice_pdf_upload_attempts WHERE (clinic_id,id) IN
    (SELECT u.clinic_id,u.id FROM public.invoice_pdf_upload_attempts u
     WHERE state='deleted' AND deleted_at < statement_timestamp()-interval '7 days'
     AND terminal_at < statement_timestamp()-interval '7 days'
     AND NOT EXISTS (SELECT 1 FROM public.invoice_pdf_artifacts a WHERE a.clinic_id=u.clinic_id AND a.upload_id=u.id)
     ORDER BY deleted_at LIMIT 100);
  DELETE FROM public.invoice_pdf_jobs WHERE (clinic_id,id) IN
    (SELECT j.clinic_id,j.id FROM public.invoice_pdf_jobs j
     WHERE status IN ('failed','cancelled','superseded','expired')
     AND updated_at < statement_timestamp()-interval '7 days'
     AND NOT EXISTS (SELECT 1 FROM public.invoice_pdf_upload_attempts u WHERE u.clinic_id=j.clinic_id AND u.job_id=j.id)
     AND NOT EXISTS (SELECT 1 FROM public.invoice_pdf_artifacts a WHERE a.clinic_id=j.clinic_id AND a.job_id=j.id)
     ORDER BY updated_at LIMIT 100);
END $$;
ALTER FUNCTION purge_invoice_pdf_evidence() OWNER TO eyadex_pdf_retention;
REVOKE ALL ON FUNCTION purge_invoice_pdf_evidence() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_invoice_pdf_evidence() TO eyadex_dispatcher;

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
