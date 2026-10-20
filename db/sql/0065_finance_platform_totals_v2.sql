-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Finance F2 platform totals v2 (docs/specs/finance-design.md §4.5 row 0065; FIN-3, R1-17): the platform
-- reads the collected and the refunded money as monthly totals only, never a payment or a refund row.
-- The old column names stay first, so the running API keeps working when the SQL ships before it.

-- The v1 function is replaced, not edited: its result gains two columns and the platform's grant is
-- re-issued below. It stays SECURITY DEFINER, owned by the 0061 NOLOGIN owner.
DROP FUNCTION finance_monthly_totals(uuid);

-- R1-17: `collected` = Σ payments by the clinic-timezone month of `received_at`; `refunded` = Σ refunds
-- by `refunded_at`. Only these columns are granted, and no patient column is reachable.
GRANT SELECT (clinic_id, received_at, amount_minor, currency) ON payments TO eyadex_finance_totals_owner;
GRANT SELECT (clinic_id, refunded_at, amount_minor, currency) ON refunds TO eyadex_finance_totals_owner;
CREATE POLICY payments_finance_totals_read ON payments FOR SELECT TO eyadex_finance_totals_owner USING (true);
CREATE POLICY refunds_finance_totals_read ON refunds FOR SELECT TO eyadex_finance_totals_owner USING (true);

-- A credit use is not collected money (no money came in), so only payments count as collected; refunds
-- count by the clinic-timezone month of refunded_at.
CREATE FUNCTION finance_monthly_totals(p_clinic uuid)
  RETURNS TABLE (month date, invoiced_minor bigint, currency char(3), collected_minor bigint, refunded_minor bigint)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT m.month, sum(m.invoiced)::bigint, m.currency, sum(m.collected)::bigint, sum(m.refunded)::bigint
  FROM (
    SELECT date_trunc('month', i.issued_at AT TIME ZONE c.timezone)::date AS month, i.currency,
      i.total_minor AS invoiced, 0::bigint AS collected, 0::bigint AS refunded
    FROM invoices i
    JOIN clinics c ON c.id = i.clinic_id
    WHERE i.clinic_id = p_clinic AND i.status <> 'void'
    UNION ALL
    SELECT date_trunc('month', p.received_at AT TIME ZONE c.timezone)::date, p.currency,
      0::bigint, p.amount_minor, 0::bigint
    FROM payments p
    JOIN clinics c ON c.id = p.clinic_id
    WHERE p.clinic_id = p_clinic
    UNION ALL
    SELECT date_trunc('month', f.refunded_at AT TIME ZONE c.timezone)::date, f.currency,
      0::bigint, 0::bigint, f.amount_minor
    FROM refunds f
    JOIN clinics c ON c.id = f.clinic_id
    WHERE f.clinic_id = p_clinic
  ) m
  GROUP BY 1, 3
  ORDER BY 1, 3
$$;
ALTER FUNCTION finance_monthly_totals(uuid) OWNER TO eyadex_finance_totals_owner;
REVOKE ALL ON FUNCTION finance_monthly_totals(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance_monthly_totals(uuid) TO eyadex_platform;
