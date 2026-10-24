-- Finance F3 backfill (docs/specs/finance-f3-reports-design.md §8 step 3, EY-10.5). Not a migration:
-- db/migrate.sh never runs it. Run it once by hand, after the API whose allocation writers fill
-- payment_allocations.business_date (slice 2b) is live, and before the contract release (0071–0073).
-- It fills only the rows still NULL, so it is idempotent: a payment-funded allocation takes its
-- payment's business_date, and a credit-funded one takes its own created_at in the clinic's timezone.
-- Then it proves no row is left NULL.
-- No BEGIN/COMMIT of its own: run it in one transaction, and the tests wrap it in theirs.
-- Usage: psql -1 -v ON_ERROR_STOP=1 -f db/maintenance/allocation-business-date-backfill.sql (as the migration owner)
UPDATE payment_allocations a
SET business_date = p.business_date
FROM payments p
WHERE p.clinic_id = a.clinic_id AND p.id = a.payment_id AND a.business_date IS NULL;

UPDATE payment_allocations a
SET business_date = (a.created_at AT TIME ZONE c.timezone)::date
FROM clinics c
WHERE c.id = a.clinic_id AND a.credit_id IS NOT NULL AND a.business_date IS NULL;

DO $$
DECLARE missing bigint;
BEGIN
  SELECT count(*) INTO missing FROM payment_allocations WHERE business_date IS NULL;
  IF missing <> 0 THEN
    RAISE EXCEPTION 'allocation business_date backfill: % allocation(s) still have no business_date', missing;
  END IF;
END $$;
