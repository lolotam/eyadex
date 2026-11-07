-- All clinic isolation probes share one transaction; included files are not standalone tests.
-- Split by responsibility so each maintained source stays below 300 lines.
BEGIN;
-- Rollback-only fixtures must never lock or consume committed admission capacity.
SET CONSTRAINTS invoice_pdf_capacity_change DEFERRED;
\ir rls-isolation/seed.sql
\ir rls-isolation/pdf-seed.sql
\ir rls-isolation/clinic-reads.sql
\ir rls-isolation/cross-clinic-writes.sql
\ir rls-isolation/pdf-writes.sql
\ir rls-isolation/finance-writes.sql
\ir rls-isolation/mutations.sql
\ir rls-isolation/platform.sql
\echo 'RLS isolation tests: all passed'
ROLLBACK;
