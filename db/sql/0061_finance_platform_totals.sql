-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Finance F1, plan Task 4 (spec FIN-3, R1-6, R1-17, R2-3): the platform reads monthly invoice totals and
-- changes a clinic's currency only through two SECURITY DEFINER functions, each owned by its own NOLOGIN,
-- NOBYPASSRLS role with the column grants and policies its statements need (the 0059 pattern). The
-- platform keeps no privilege on any finance table, and loses its direct UPDATE on the currency columns.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_finance_totals_owner') THEN
    CREATE ROLE eyadex_finance_totals_owner NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyadex_finance_currency_owner') THEN
    CREATE ROLE eyadex_finance_currency_owner NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO eyadex_finance_totals_owner, eyadex_finance_currency_owner;

-- FIN-3, R1-17: `invoiced` = Σ total of non-void invoices by the clinic-timezone month of `issued_at`, as
-- they stand now (an edit or a void restates its month). The policies are role-wide on purpose; the
-- function filters on its argument. No patient column is granted.
GRANT SELECT (id, timezone) ON clinics TO eyadex_finance_totals_owner;
GRANT SELECT (clinic_id, status, issued_at, total_minor, currency) ON invoices TO eyadex_finance_totals_owner;
CREATE POLICY clinics_finance_totals_read ON clinics FOR SELECT TO eyadex_finance_totals_owner USING (true);
CREATE POLICY invoices_finance_totals_read ON invoices FOR SELECT TO eyadex_finance_totals_owner USING (true);

CREATE FUNCTION finance_monthly_totals(p_clinic uuid)
  RETURNS TABLE (month date, invoiced_minor bigint, currency char(3))
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT date_trunc('month', i.issued_at AT TIME ZONE c.timezone)::date, sum(i.total_minor)::bigint, i.currency
  FROM invoices i
  JOIN clinics c ON c.id = i.clinic_id
  WHERE i.clinic_id = p_clinic AND i.status <> 'void'
  GROUP BY 1, 3
  ORDER BY 1, 3
$$;
ALTER FUNCTION finance_monthly_totals(uuid) OWNER TO eyadex_finance_totals_owner;
REVOKE ALL ON FUNCTION finance_monthly_totals(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance_monthly_totals(uuid) TO eyadex_platform;

-- R1-6, R2-3: the currency changes only while the clinic has no price and no invoice, under the same
-- per-clinic advisory lock the API takes for prices and the first issue, so the check and the change are
-- one step. The exponent always follows the currency.
GRANT SELECT (id, currency) ON clinics TO eyadex_finance_currency_owner;
GRANT UPDATE (currency, currency_exponent, updated_at) ON clinics TO eyadex_finance_currency_owner;
GRANT SELECT (clinic_id, price_minor) ON clinic_services TO eyadex_finance_currency_owner;
GRANT SELECT (clinic_id) ON service_provider_prices TO eyadex_finance_currency_owner;
GRANT SELECT (clinic_id) ON invoices TO eyadex_finance_currency_owner;
CREATE POLICY clinics_finance_currency_read ON clinics FOR SELECT TO eyadex_finance_currency_owner USING (true);
CREATE POLICY clinics_finance_currency_write ON clinics FOR UPDATE TO eyadex_finance_currency_owner
  USING (true) WITH CHECK (true);
CREATE POLICY clinic_services_finance_currency_read ON clinic_services FOR SELECT
  TO eyadex_finance_currency_owner USING (true);
CREATE POLICY service_provider_prices_finance_currency_read ON service_provider_prices FOR SELECT
  TO eyadex_finance_currency_owner USING (true);
CREATE POLICY invoices_finance_currency_read ON invoices FOR SELECT TO eyadex_finance_currency_owner USING (true);

CREATE FUNCTION finance_set_currency(p_clinic uuid, p_currency char(3)) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('finance:' || p_clinic::text, 0));
  IF p_currency NOT IN ('KWD', 'BHD', 'OMR', 'SAR', 'AED', 'QAR') THEN
    RAISE EXCEPTION 'currency_unsupported' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM clinic_services WHERE clinic_id = p_clinic AND price_minor IS NOT NULL)
     OR EXISTS (SELECT 1 FROM service_provider_prices WHERE clinic_id = p_clinic)
     OR EXISTS (SELECT 1 FROM invoices WHERE clinic_id = p_clinic) THEN
    RAISE EXCEPTION 'currency_locked' USING ERRCODE = 'P0001';
  END IF;
  UPDATE clinics
  SET currency = p_currency,
      currency_exponent = CASE WHEN p_currency IN ('KWD', 'BHD', 'OMR') THEN 3 ELSE 2 END,
      updated_at = now()
  WHERE id = p_clinic;
END
$$;
ALTER FUNCTION finance_set_currency(uuid, char) OWNER TO eyadex_finance_currency_owner;
REVOKE ALL ON FUNCTION finance_set_currency(uuid, char) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance_set_currency(uuid, char) TO eyadex_platform;

-- Closing the direct path: eyadex_platform holds a table-level UPDATE on clinics (0013), which a
-- column-level REVOKE would not remove. The table grant goes, and the columns the platform writes come
-- back by name; the currency, its exponent and the clinic's own finance settings are left out. This
-- block fails the migration if clinics gained a column nobody reviewed for that list.
DO $$
DECLARE actual text[];
BEGIN
  SELECT array_agg(column_name::text ORDER BY ordinal_position) INTO actual
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clinics';
  IF actual IS DISTINCT FROM ARRAY['id', 'slug', 'name_ar', 'name_en', 'specialty', 'default_language',
      'timezone', 'status', 'expires_at', 'max_users', 'max_branches', 'created_at', 'updated_at', 'currency',
      'currency_exponent', 'tax_rate_bp', 'commercial_reg_no', 'logo_blob_key'] THEN
    RAISE EXCEPTION 'clinics columns changed: %', actual;
  END IF;
END $$;
REVOKE UPDATE ON clinics FROM eyadex_platform;
GRANT UPDATE (slug, name_ar, name_en, specialty, default_language, timezone, status, expires_at,
  max_users, max_branches, updated_at, tax_rate_bp) ON clinics TO eyadex_platform;
-- SELECT and INSERT stay table-level: creating a clinic sets its currency, and it has no price yet.

-- Spec §3.3 `PATCH /clinic/settings/finance` (Task 8h): the clinic writes its own commercial registration
-- number and logo key through its existing own-clinic UPDATE policy (0036); never the currency, the
-- exponent or the tax rate, which belong to the platform.
GRANT UPDATE (commercial_reg_no, logo_blob_key) ON clinics TO eyadex_app;
