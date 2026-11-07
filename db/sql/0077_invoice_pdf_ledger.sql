-- Forward-only PDF ledger foundation. LOCAL-TESTED ONLY; release HOLD.
ALTER TABLE clinics ADD COLUMN pdf_display_revision bigint NOT NULL DEFAULT 1
  CHECK (pdf_display_revision > 0);
ALTER TABLE branches ADD COLUMN pdf_display_revision bigint NOT NULL DEFAULT 1
  CHECK (pdf_display_revision > 0);
ALTER TABLE patients ADD COLUMN pdf_display_revision bigint NOT NULL DEFAULT 1
  CHECK (pdf_display_revision > 0);
-- No runtime direct UPDATE grant on these columns; trigger increments atomically.
CREATE FUNCTION pdf_display_revision_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE changed boolean;
BEGIN
  IF TG_OP='INSERT' THEN NEW.pdf_display_revision := 1; RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'clinics' THEN
    changed := (NEW.name_ar,NEW.name_en,NEW.timezone,NEW.commercial_reg_no,NEW.logo_blob_key)
      IS DISTINCT FROM
      (OLD.name_ar,OLD.name_en,OLD.timezone,OLD.commercial_reg_no,OLD.logo_blob_key);
  ELSIF TG_TABLE_NAME = 'branches' THEN
    changed := (NEW.name_ar,NEW.name_en,NEW.address,NEW.phone)
      IS DISTINCT FROM (OLD.name_ar,OLD.name_en,OLD.address,OLD.phone);
  ELSIF TG_TABLE_NAME = 'patients' THEN
    changed := NEW.full_name IS DISTINCT FROM OLD.full_name;
  ELSE RAISE EXCEPTION 'pdf_revision_table';
  END IF;
  NEW.pdf_display_revision := OLD.pdf_display_revision + CASE WHEN changed THEN 1 ELSE 0 END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION pdf_display_revision_change() FROM PUBLIC;
CREATE TRIGGER clinics_pdf_display_revision BEFORE INSERT OR UPDATE ON clinics
  FOR EACH ROW EXECUTE FUNCTION pdf_display_revision_change();
CREATE TRIGGER branches_pdf_display_revision BEFORE INSERT OR UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION pdf_display_revision_change();
CREATE TRIGGER patients_pdf_display_revision BEFORE INSERT OR UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION pdf_display_revision_change();

CREATE TABLE invoice_pdf_jobs (
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  invoice_version integer NOT NULL CHECK (invoice_version > 0),
  render_revision varchar(256) NOT NULL CHECK (render_revision ~ '^[A-Za-z0-9_.-]+:[1-9][0-9]*:[1-9][0-9]*:[1-9][0-9]*$'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN
    ('queued','running','retry_wait','ready','failed','cancelled','superseded','expired')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 3),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 2),
  fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
  lease_token uuid,
  lease_until timestamptz,
  deadline_at timestamptz,
  next_attempt_at timestamptz,
  clinic_slot smallint CHECK (clinic_slot BETWEEN 1 AND 10),
  ready_until timestamptz,
  cleanup_due_at timestamptz,
  error_code text CHECK (error_code IN
    ('store_unavailable','db_unavailable','lease_expired','invalid_model','size_limit','cancelled','superseded')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (clinic_id,id),
  FOREIGN KEY (clinic_id,invoice_id) REFERENCES invoices(clinic_id,id) ON DELETE RESTRICT,
  CHECK ((status IN ('queued','running','retry_wait')) =
    (clinic_slot IS NOT NULL)),
  CHECK ((status = 'running') =
    (lease_token IS NOT NULL AND lease_until IS NOT NULL AND deadline_at IS NOT NULL)),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  CHECK ((lease_token IS NULL) = (deadline_at IS NULL)),
  CHECK ((status = 'retry_wait') = (next_attempt_at IS NOT NULL)),
  CHECK (status <> 'running' OR (attempt > 0 AND fence > 0 AND lease_until <= deadline_at)),
  CHECK ((status = 'ready') = (ready_until IS NOT NULL))
);
CREATE UNIQUE INDEX invoice_pdf_clinic_capacity ON invoice_pdf_jobs(clinic_id,clinic_slot)
  WHERE clinic_slot IS NOT NULL;
-- Terminal evidence never prevents a later authorized generation of the same current revision.
CREATE UNIQUE INDEX invoice_pdf_current_generation ON invoice_pdf_jobs(clinic_id,invoice_id,invoice_version,render_revision)
  WHERE status IN ('queued','running','retry_wait','ready');
CREATE INDEX invoice_pdf_invoice ON invoice_pdf_jobs(clinic_id,invoice_id);
CREATE INDEX invoice_pdf_due ON invoice_pdf_jobs(clinic_id,status,next_attempt_at,created_at);
CREATE INDEX invoice_pdf_cleanup ON invoice_pdf_jobs(clinic_id,cleanup_due_at);
CREATE INDEX invoice_pdf_job_purge ON invoice_pdf_jobs(clinic_id,updated_at) WHERE status IN ('failed','cancelled','superseded','expired');

CREATE TABLE invoice_pdf_upload_attempts (
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  fence bigint NOT NULL CHECK (fence > 0),
  state text NOT NULL CHECK (state IN
    ('allocated','unknown','uploaded','published','deleting','deleted')),
  storage_key text NOT NULL CHECK (storage_key =
    'clinic/' || clinic_id::text || '/invoice-pdfs/' || job_id::text || '/' || id::text),
  upload_deadline_at timestamptz NOT NULL,
  writer_stopped_at timestamptz,
  cleanup_due_at timestamptz,
  deleted_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (clinic_id,id),
  FOREIGN KEY (clinic_id,job_id) REFERENCES invoice_pdf_jobs(clinic_id,id) ON DELETE RESTRICT,
  UNIQUE (clinic_id,job_id,attempt),
  UNIQUE (clinic_id,job_id,id),
  UNIQUE (clinic_id,storage_key),
  CHECK (state <> 'deleted' OR deleted_at IS NOT NULL),
  CHECK (state NOT IN ('deleting','deleted') OR writer_stopped_at IS NOT NULL)
);
CREATE INDEX invoice_pdf_upload_cleanup ON invoice_pdf_upload_attempts(clinic_id,state,cleanup_due_at);
CREATE INDEX invoice_pdf_upload_purge ON invoice_pdf_upload_attempts(clinic_id,deleted_at,terminal_at) WHERE state='deleted';

CREATE TABLE invoice_pdf_artifacts (
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  job_id uuid NOT NULL,
  upload_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('ready','expired','deleting','deleted')),
  cipher_key_version integer NOT NULL CHECK (cipher_key_version > 0),
  byte_length bigint NOT NULL CHECK (byte_length BETWEEN 1 AND 5242880),
  published_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (clinic_id,id),
  FOREIGN KEY (clinic_id,job_id) REFERENCES invoice_pdf_jobs(clinic_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (clinic_id,job_id,upload_id)
    REFERENCES invoice_pdf_upload_attempts(clinic_id,job_id,id) ON DELETE RESTRICT,
  UNIQUE (clinic_id,upload_id),
  CHECK (expires_at = published_at + interval '24 hours'),
  CHECK (state <> 'deleted' OR deleted_at IS NOT NULL)
);
CREATE UNIQUE INDEX invoice_pdf_one_ready ON invoice_pdf_artifacts(clinic_id,job_id)
  WHERE state = 'ready';
CREATE INDEX invoice_pdf_artifact_expiry ON invoice_pdf_artifacts(clinic_id,state,expires_at);
CREATE INDEX invoice_pdf_artifact_purge ON invoice_pdf_artifacts(clinic_id,deleted_at) WHERE state='deleted';
CREATE INDEX invoice_pdf_artifact_attempt ON invoice_pdf_artifacts(clinic_id,job_id,upload_id);

ALTER TABLE invoice_pdf_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_pdf_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON invoice_pdf_jobs TO eyadex_app
  USING (clinic_id = NULLIF(current_setting('app.clinic_id',true),'')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id',true),'')::uuid);
ALTER TABLE invoice_pdf_upload_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_pdf_upload_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON invoice_pdf_upload_attempts TO eyadex_app
  USING (clinic_id = NULLIF(current_setting('app.clinic_id',true),'')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id',true),'')::uuid);
ALTER TABLE invoice_pdf_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_pdf_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON invoice_pdf_artifacts TO eyadex_app
  USING (clinic_id = NULLIF(current_setting('app.clinic_id',true),'')::uuid)
  WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id',true),'')::uuid);
REVOKE ALL ON invoice_pdf_jobs,invoice_pdf_upload_attempts,invoice_pdf_artifacts
  FROM PUBLIC,eyadex_auth,eyadex_platform,eyadex_dispatcher;
GRANT SELECT,INSERT ON invoice_pdf_jobs,invoice_pdf_upload_attempts,invoice_pdf_artifacts TO eyadex_app;
GRANT UPDATE (status,attempt,retry_count,fence,lease_token,lease_until,deadline_at,next_attempt_at,
  clinic_slot,ready_until,cleanup_due_at,error_code,updated_at)
  ON invoice_pdf_jobs TO eyadex_app;
GRANT UPDATE (state,writer_stopped_at,cleanup_due_at,deleted_at,terminal_at,updated_at)
  ON invoice_pdf_upload_attempts TO eyadex_app;
GRANT UPDATE (state,deleted_at) ON invoice_pdf_artifacts TO eyadex_app;
-- Direct DELETE is denied to all login runtime roles.
-- Dispatcher can invoke only the tenant-scoped retention function below; no table access.

-- App has no membership in this NOLOGIN infrastructure role.
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='eyadex_pdf_capacity') THEN CREATE ROLE eyadex_pdf_capacity NOLOGIN NOBYPASSRLS; END IF; END $$;
CREATE TABLE invoice_pdf_capacity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  admitted integer NOT NULL CHECK (admitted BETWEEN 0 AND 100)
);
INSERT INTO invoice_pdf_capacity VALUES (true,0);
REVOKE ALL ON invoice_pdf_capacity FROM PUBLIC,eyadex_app,eyadex_platform,eyadex_auth,eyadex_dispatcher;
GRANT USAGE ON SCHEMA public TO eyadex_pdf_capacity;
GRANT SELECT,UPDATE (admitted) ON invoice_pdf_capacity TO eyadex_pdf_capacity;
CREATE FUNCTION invoice_pdf_capacity_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE delta integer := 0;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.status IN ('queued','running','retry_wait') THEN delta := delta - 1; END IF;
  IF TG_OP <> 'DELETE' AND NEW.status IN ('queued','running','retry_wait') THEN delta := delta + 1; END IF;
  IF delta <> 0 THEN
    UPDATE public.invoice_pdf_capacity SET admitted = admitted + delta WHERE singleton;
    IF NOT FOUND THEN RAISE EXCEPTION 'pdf_capacity_missing'; END IF;
  END IF;
  RETURN NULL;
END $$;
ALTER FUNCTION invoice_pdf_capacity_change() OWNER TO eyadex_pdf_capacity;
REVOKE ALL ON FUNCTION invoice_pdf_capacity_change() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER invoice_pdf_capacity_change AFTER INSERT OR UPDATE OR DELETE ON invoice_pdf_jobs
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION invoice_pdf_capacity_change();

-- Immutable caller-supplied identities are also checked on INSERT and state changes.
CREATE FUNCTION invoice_pdf_job_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' OR NEW.attempt <> 0 OR NEW.fence <> 0 OR NEW.retry_count <> 0 THEN
      RAISE EXCEPTION 'pdf_initial_state';
    END IF;
  ELSE
    IF NEW.retry_count < OLD.retry_count OR NEW.retry_count > OLD.retry_count+1 THEN RAISE EXCEPTION 'pdf_retry_monotonic'; END IF;
    IF NEW.status='queued' AND OLD.status<>'queued' THEN RAISE EXCEPTION 'pdf_no_requeue'; END IF;
    IF NEW.status='retry_wait' AND OLD.status NOT IN ('running','retry_wait') THEN RAISE EXCEPTION 'pdf_retry_source'; END IF;
    IF NEW.status='ready' AND OLD.status NOT IN ('running','ready') THEN RAISE EXCEPTION 'pdf_ready_source'; END IF;
    IF (NEW.clinic_id,NEW.id,NEW.invoice_id,NEW.invoice_version,NEW.render_revision,NEW.created_at)
      IS DISTINCT FROM (OLD.clinic_id,OLD.id,OLD.invoice_id,OLD.invoice_version,OLD.render_revision,OLD.created_at) THEN
      RAISE EXCEPTION 'pdf_identity_immutable';
    END IF;
    IF OLD.status IN ('ready','failed','cancelled','superseded','expired')
      AND NEW.status IN ('queued','running','retry_wait') THEN RAISE EXCEPTION 'pdf_terminal'; END IF;
    IF NEW.status = 'running' AND OLD.status <> 'running' THEN
      IF NEW.deadline_at > clock_timestamp()+interval '60 seconds' THEN RAISE EXCEPTION 'pdf_deadline'; END IF;
      IF OLD.status NOT IN ('queued','retry_wait') OR NEW.attempt <> OLD.attempt+1 OR NEW.fence <> OLD.fence+1 THEN
        RAISE EXCEPTION 'pdf_claim_identity';
      END IF;
    ELSIF NEW.attempt <> OLD.attempt OR NEW.fence < OLD.fence THEN RAISE EXCEPTION 'pdf_fence';
    END IF;
    IF OLD.status = 'running' AND NEW.status = 'running' AND
      (NEW.fence,NEW.lease_token,NEW.deadline_at) IS DISTINCT FROM (OLD.fence,OLD.lease_token,OLD.deadline_at) THEN
      RAISE EXCEPTION 'pdf_lease_identity';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION invoice_pdf_job_guard() FROM PUBLIC;
CREATE TRIGGER invoice_pdf_job_guard BEFORE INSERT OR UPDATE ON invoice_pdf_jobs
FOR EACH ROW EXECUTE FUNCTION invoice_pdf_job_guard();

DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='eyadex_pdf_retention') THEN CREATE ROLE eyadex_pdf_retention NOLOGIN NOBYPASSRLS; END IF; END $$;
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

CREATE FUNCTION invoice_pdf_upload_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' AND NOT EXISTS (SELECT 1 FROM public.invoice_pdf_jobs j
    WHERE j.clinic_id=NEW.clinic_id AND j.id=NEW.job_id AND j.status='running'
    AND j.attempt=NEW.attempt AND j.fence=NEW.fence AND j.lease_until>clock_timestamp()
    AND j.deadline_at>=NEW.upload_deadline_at AND j.lease_until>=NEW.upload_deadline_at FOR UPDATE) THEN RAISE EXCEPTION 'pdf_upload_fence'; END IF;
  IF TG_OP='INSERT' AND NEW.state<>'allocated' THEN RAISE EXCEPTION 'pdf_upload_initial'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION invoice_pdf_upload_guard() FROM PUBLIC;
CREATE TRIGGER invoice_pdf_upload_guard BEFORE INSERT ON invoice_pdf_upload_attempts
FOR EACH ROW EXECUTE FUNCTION invoice_pdf_upload_guard();

-- Deletion evidence is terminal for both storage ledgers.
CREATE FUNCTION invoice_pdf_deleted_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.state='deleted' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'pdf_deleted_terminal'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION invoice_pdf_deleted_guard() FROM PUBLIC;
CREATE TRIGGER invoice_pdf_upload_deleted BEFORE UPDATE ON invoice_pdf_upload_attempts
FOR EACH ROW EXECUTE FUNCTION invoice_pdf_deleted_guard();
CREATE TRIGGER invoice_pdf_artifact_deleted BEFORE UPDATE ON invoice_pdf_artifacts
FOR EACH ROW EXECUTE FUNCTION invoice_pdf_deleted_guard();


DO $$
DECLARE grant_row record; writable text;
BEGIN
  FOR grant_row IN SELECT grantee,table_name FROM information_schema.table_privileges
    WHERE table_schema='public' AND table_name IN ('clinics','branches','patients')
      AND privilege_type='UPDATE' AND grantee IN
      ('eyadex_app','eyadex_platform','eyadex_auth','eyadex_dispatcher') LOOP
    SELECT string_agg(quote_ident(column_name),',') INTO writable FROM information_schema.columns
      WHERE table_schema='public' AND table_name=grant_row.table_name AND column_name<>'pdf_display_revision';
    EXECUTE format('REVOKE UPDATE ON public.%I FROM %I',grant_row.table_name,grant_row.grantee);
    EXECUTE format('GRANT UPDATE (%s) ON public.%I TO %I',writable,grant_row.table_name,grant_row.grantee);
  END LOOP;
END $$;
