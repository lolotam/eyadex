-- Prototype proof for plan Tasks 4 and 5 on the real 0001–0059 schema. One transaction, rolled back.
\set ON_ERROR_STOP on
BEGIN;

-- ---- minimal 0060 shape needed by the functions ----
ALTER TABLE clinics ADD COLUMN currency char(3) NOT NULL DEFAULT 'KWD',
  ADD COLUMN currency_exponent smallint NOT NULL DEFAULT 3, ADD COLUMN tax_rate_bp int NOT NULL DEFAULT 0;
ALTER TABLE clinic_services ADD COLUMN price_minor bigint NULL;
CREATE TABLE service_provider_prices (clinic_id uuid NOT NULL, id uuid NOT NULL, service_id uuid NOT NULL,
  member_id uuid NOT NULL, price_minor bigint NOT NULL, PRIMARY KEY (clinic_id, id));
CREATE TABLE invoices (clinic_id uuid NOT NULL, id uuid NOT NULL, status text NOT NULL, issued_at timestamptz NOT NULL,
  total_minor bigint NOT NULL, currency char(3) NOT NULL, patient_id uuid NULL, PRIMARY KEY (clinic_id, id));
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['service_provider_prices','invoices'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY %I ON %I TO eyadex_app USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)$p$, t || '_clinic', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO eyadex_app', t);
    EXECUTE format('REVOKE ALL ON %I FROM eyadex_platform', t);
  END LOOP; END $$;

-- ---- 0061 as planned (Task 4) ----
CREATE ROLE eyadex_finance_totals_owner NOLOGIN NOBYPASSRLS;
CREATE ROLE eyadex_finance_currency_owner NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO eyadex_finance_totals_owner, eyadex_finance_currency_owner;
GRANT SELECT (id, timezone) ON clinics TO eyadex_finance_totals_owner;
GRANT SELECT (clinic_id, status, issued_at, total_minor, currency) ON invoices TO eyadex_finance_totals_owner;
CREATE POLICY clinics_finance_totals ON clinics FOR SELECT TO eyadex_finance_totals_owner USING (true);
CREATE POLICY invoices_finance_totals ON invoices FOR SELECT TO eyadex_finance_totals_owner USING (true);
CREATE FUNCTION finance_monthly_totals(p_clinic uuid)
  RETURNS TABLE (month date, invoiced_minor bigint, currency char(3))
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT date_trunc('month', i.issued_at AT TIME ZONE c.timezone)::date, sum(i.total_minor)::bigint, i.currency
  FROM invoices i JOIN clinics c ON c.id = i.clinic_id
  WHERE i.clinic_id = p_clinic AND i.status <> 'void' GROUP BY 1, 3 ORDER BY 1 $$;
ALTER FUNCTION finance_monthly_totals(uuid) OWNER TO eyadex_finance_totals_owner;
REVOKE ALL ON FUNCTION finance_monthly_totals(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance_monthly_totals(uuid) TO eyadex_platform;

GRANT SELECT (id, currency) ON clinics TO eyadex_finance_currency_owner;
GRANT UPDATE (currency, currency_exponent, updated_at) ON clinics TO eyadex_finance_currency_owner;
GRANT SELECT (clinic_id, price_minor) ON clinic_services TO eyadex_finance_currency_owner;
GRANT SELECT (clinic_id) ON service_provider_prices TO eyadex_finance_currency_owner;
GRANT SELECT (clinic_id) ON invoices TO eyadex_finance_currency_owner;
CREATE POLICY clinics_finance_currency_read ON clinics FOR SELECT TO eyadex_finance_currency_owner USING (true);
CREATE POLICY clinics_finance_currency_write ON clinics FOR UPDATE TO eyadex_finance_currency_owner USING (true) WITH CHECK (true);
CREATE POLICY services_finance_currency ON clinic_services FOR SELECT TO eyadex_finance_currency_owner USING (true);
CREATE POLICY provider_prices_finance_currency ON service_provider_prices FOR SELECT TO eyadex_finance_currency_owner USING (true);
CREATE POLICY invoices_finance_currency ON invoices FOR SELECT TO eyadex_finance_currency_owner USING (true);
CREATE FUNCTION finance_set_currency(p_clinic uuid, p_currency char(3)) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('finance:' || p_clinic::text, 0));
  IF p_currency NOT IN ('KWD','BHD','OMR','SAR','AED','QAR') THEN
    RAISE EXCEPTION 'currency_unsupported' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM clinic_services WHERE clinic_id = p_clinic AND price_minor IS NOT NULL)
     OR EXISTS (SELECT 1 FROM service_provider_prices WHERE clinic_id = p_clinic)
     OR EXISTS (SELECT 1 FROM invoices WHERE clinic_id = p_clinic) THEN
    RAISE EXCEPTION 'currency_locked' USING ERRCODE = 'P0001'; END IF;
  UPDATE clinics SET currency = p_currency,
    currency_exponent = CASE WHEN p_currency IN ('KWD','BHD','OMR') THEN 3 ELSE 2 END, updated_at = now()
  WHERE id = p_clinic;
END $$;
ALTER FUNCTION finance_set_currency(uuid, char) OWNER TO eyadex_finance_currency_owner;
REVOKE ALL ON FUNCTION finance_set_currency(uuid, char) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance_set_currency(uuid, char) TO eyadex_platform;

-- ---- data: clinics A (Kuwait) and B ----
INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language, timezone, status, expires_at, max_users, max_branches, created_at, updated_at)
VALUES ('00000000-0000-7000-8000-0000000f00a1','fin-a','أ','A','general','ar','Asia/Kuwait','active',now()+interval '1 year',10,3,now(),now()),
       ('00000000-0000-7000-8000-0000000f00b1','fin-b','ب','B','general','ar','Asia/Kuwait','active',now()+interval '1 year',10,3,now(),now());
INSERT INTO invoices VALUES
  ('00000000-0000-7000-8000-0000000f00a1','00000000-0000-7000-8000-0000000f0a01','issued','2026-10-31T22:30Z',1000,'KWD',NULL),
  ('00000000-0000-7000-8000-0000000f00a1','00000000-0000-7000-8000-0000000f0a02','issued','2026-10-15T10:00Z',2500,'KWD',NULL),
  ('00000000-0000-7000-8000-0000000f00a1','00000000-0000-7000-8000-0000000f0a03','void','2026-10-15T11:00Z',9999,'KWD',NULL),
  ('00000000-0000-7000-8000-0000000f00b1','00000000-0000-7000-8000-0000000f0b01','issued','2026-10-10T10:00Z',777,'KWD',NULL);

SET LOCAL ROLE eyadex_platform;
SELECT 'totals A: ' || string_agg(month || '=' || invoiced_minor, ', ' ORDER BY month) AS proof FROM finance_monthly_totals('00000000-0000-7000-8000-0000000f00a1');
SELECT 'totals B: ' || string_agg(month || '=' || invoiced_minor, ', ' ORDER BY month) AS proof FROM finance_monthly_totals('00000000-0000-7000-8000-0000000f00b1');
DO $$ BEGIN
  BEGIN PERFORM 1 FROM invoices; RAISE EXCEPTION 'FAIL: platform read invoices';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: direct invoices read refused'; END;
  BEGIN PERFORM 1 FROM service_provider_prices; RAISE EXCEPTION 'FAIL: platform read provider prices';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok: direct provider prices read refused'; END;
  BEGIN PERFORM finance_set_currency('00000000-0000-7000-8000-0000000f00a1', 'SAR'); RAISE EXCEPTION 'FAIL: A has invoices';
  -- The function raises raise_exception too, so the check re-raises its own FAIL instead of passing it.
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'ok: % (clinic with invoices)', SQLERRM; END;
  BEGIN PERFORM finance_set_currency('00000000-0000-7000-8000-0000000f00b1', 'XXX'); RAISE EXCEPTION 'FAIL: bad code';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'ok: % (unsupported code)', SQLERRM; END;
END $$;
RESET ROLE;
-- clinic C: no price, no invoice -> the platform may change its currency through the function
INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language, timezone, status, expires_at, max_users, max_branches, created_at, updated_at)
VALUES ('00000000-0000-7000-8000-0000000f00c1','fin-c','ج','C','general','ar','Asia/Riyadh','active',now()+interval '1 year',10,3,now(),now());
SET LOCAL ROLE eyadex_platform;
SELECT finance_set_currency('00000000-0000-7000-8000-0000000f00c1', 'SAR');
SELECT 'set currency C: ' || currency || '/' || currency_exponent AS proof FROM clinics WHERE slug = 'fin-c';
RESET ROLE;
SELECT 'owners: ' || string_agg(rolname || ' login=' || rolcanlogin || ' bypassrls=' || rolbypassrls, '; ') AS proof
FROM pg_roles WHERE rolname LIKE 'eyadex_finance_%';
SELECT 'eyadex_app EXECUTE set_currency: ' || has_function_privilege('eyadex_app', 'finance_set_currency(uuid,char)', 'EXECUTE')
       || ', owner SELECT invoices.patient_id: ' || has_column_privilege('eyadex_finance_totals_owner', 'invoices', 'patient_id', 'SELECT') AS proof;

-- ---- 0062 notification index swap (Task 5, without C1) ----
ALTER TABLE patient_notifications DROP CONSTRAINT patient_notifications_once;
CREATE UNIQUE INDEX patient_notifications_once ON patient_notifications (clinic_id, subject_id, kind, channel, subject_at)
  NULLS NOT DISTINCT WHERE subject_type <> 'invoice';
ALTER TABLE patient_notifications ADD COLUMN send_request_id uuid NULL;
CREATE UNIQUE INDEX patient_notifications_send_request ON patient_notifications (clinic_id, send_request_id)
  WHERE send_request_id IS NOT NULL;
SELECT 'constraint gone: ' || (NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'patient_notifications_once'))::text
       || ', partial index: ' || (SELECT pg_get_indexdef(indexrelid) FROM pg_index WHERE indexrelid = 'patient_notifications_once'::regclass) AS proof;
-- ON CONFLICT semantics of the partial index, on a table with the same key columns
CREATE TABLE pn_proof (clinic_id uuid, id uuid PRIMARY KEY, subject_type text, subject_id uuid, kind text, channel text,
  subject_at timestamptz, send_request_id uuid);
CREATE UNIQUE INDEX pn_once ON pn_proof (clinic_id, subject_id, kind, channel, subject_at) NULLS NOT DISTINCT
  WHERE subject_type <> 'invoice';
CREATE UNIQUE INDEX pn_send ON pn_proof (clinic_id, send_request_id) WHERE send_request_id IS NOT NULL;
-- reminder twice (the rewritten writers' clause) -> one row
INSERT INTO pn_proof VALUES ('00000000-0000-7000-8000-0000000f00a1', gen_random_uuid(), 'appointment', '00000000-0000-7000-8000-00000000a001', 'reminder_day', 'whatsapp', '2026-10-20T08:00Z', NULL)
  ON CONFLICT (clinic_id, subject_id, kind, channel, subject_at) WHERE subject_type <> 'invoice' DO NOTHING;
INSERT INTO pn_proof VALUES ('00000000-0000-7000-8000-0000000f00a1', gen_random_uuid(), 'appointment', '00000000-0000-7000-8000-00000000a001', 'reminder_day', 'whatsapp', '2026-10-20T08:00Z', NULL)
  ON CONFLICT (clinic_id, subject_id, kind, channel, subject_at) WHERE subject_type <> 'invoice' DO NOTHING;
-- prescription (subject_at NULL) twice -> one row (NULLS NOT DISTINCT kept)
INSERT INTO pn_proof VALUES ('00000000-0000-7000-8000-0000000f00a1', gen_random_uuid(), 'visit', '00000000-0000-7000-8000-00000000b001', 'prescription', 'email', NULL, NULL)
  ON CONFLICT (clinic_id, subject_id, kind, channel, subject_at) WHERE subject_type <> 'invoice' DO NOTHING;
INSERT INTO pn_proof VALUES ('00000000-0000-7000-8000-0000000f00a1', gen_random_uuid(), 'visit', '00000000-0000-7000-8000-00000000b001', 'prescription', 'email', NULL, NULL)
  ON CONFLICT (clinic_id, subject_id, kind, channel, subject_at) WHERE subject_type <> 'invoice' DO NOTHING;
-- invoice: two sends with different request ids -> two rows; same id again -> conflict
INSERT INTO pn_proof VALUES ('00000000-0000-7000-8000-0000000f00a1', gen_random_uuid(), 'invoice', '00000000-0000-7000-8000-00000000c001', 'invoice', 'whatsapp', NULL, '00000000-0000-7000-8000-0000000d0001');
INSERT INTO pn_proof VALUES ('00000000-0000-7000-8000-0000000f00a1', gen_random_uuid(), 'invoice', '00000000-0000-7000-8000-00000000c001', 'invoice', 'whatsapp', NULL, '00000000-0000-7000-8000-0000000d0002');
DO $$ BEGIN
  INSERT INTO pn_proof VALUES ('00000000-0000-7000-8000-0000000f00a1', gen_random_uuid(), 'invoice', '00000000-0000-7000-8000-00000000c002', 'invoice', 'email', NULL, '00000000-0000-7000-8000-0000000d0001');
  RAISE EXCEPTION 'FAIL: reused send_request_id accepted';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok: same send_request_id with another invoice/channel refused';
END $$;
-- the OLD clause no longer works once the constraint is an index (every writer must change)
DO $$ BEGIN
  EXECUTE 'INSERT INTO pn_proof VALUES (gen_random_uuid(), gen_random_uuid(), ''appointment'', gen_random_uuid(), ''booked'', ''email'', now(), NULL) ON CONFLICT ON CONSTRAINT pn_once DO NOTHING';
  RAISE EXCEPTION 'FAIL: ON CONSTRAINT still accepted';
EXCEPTION WHEN undefined_object THEN RAISE NOTICE 'ok: ON CONFLICT ON CONSTRAINT fails after the swap (%)', SQLERRM;
END $$;
SELECT 'rows: reminder=' || count(*) FILTER (WHERE kind='reminder_day') || ' prescription=' || count(*) FILTER (WHERE kind='prescription')
       || ' invoice=' || count(*) FILTER (WHERE kind='invoice') AS proof FROM pn_proof;
ROLLBACK;
