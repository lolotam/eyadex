-- Finance F3 backfill (docs/specs/finance-f3-reports-design.md §8 step 3, F3-Q1 a). Not a migration:
-- db/migrate.sh never runs it. Run it once by hand, after the API whose issue path writes
-- invoices.business_date (slice 2b) is live, and before the contract release (0071–0073).
-- It fills only the rows still NULL, from issued_at in the clinic's timezone, so it is idempotent and
-- leaves every day the issue path already wrote unchanged. Then it proves no row is left NULL.
-- No BEGIN/COMMIT of its own: run it in one transaction, and the tests wrap it in theirs.
-- Usage: psql -1 -v ON_ERROR_STOP=1 -f db/maintenance/invoice-business-date-backfill.sql (as the migration owner)
UPDATE invoices i
SET business_date = (i.issued_at AT TIME ZONE c.timezone)::date
FROM clinics c
WHERE c.id = i.clinic_id AND i.business_date IS NULL;

DO $$
DECLARE missing bigint;
BEGIN
  SELECT count(*) INTO missing FROM invoices WHERE business_date IS NULL;
  IF missing <> 0 THEN
    RAISE EXCEPTION 'invoice business_date backfill: % invoice(s) still have no business_date', missing;
  END IF;
END $$;
