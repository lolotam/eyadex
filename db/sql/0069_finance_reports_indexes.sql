-- SQL baseline (PostgreSQL 18). Forward-only: never edit after it is applied.
-- Finance F3 report indexes (docs/specs/finance-f3-reports-design.md §8 row 0069): only what the report
-- plans need, kept in its own file so the index cost is visible in review. Plain CREATE INDEX: the runner
-- applies each file in one transaction with its ledger row, so CONCURRENTLY cannot be used.

-- Spec §4 R3–R5: the reports read only issued invoices of a branch in an issue-time range; the
-- business_date indexes come with the contract step (0072), once that column is filled. The live lines
-- are already served by 0060's (clinic_id, invoice_id, position) WHERE archived_at IS NULL, and the
-- allocations of the balance view by 0064's (clinic_id, invoice_id, patient_id).
CREATE INDEX invoices_clinic_branch_issued_live_idx ON invoices (clinic_id, branch_id, issued_at)
  WHERE status = 'issued';
