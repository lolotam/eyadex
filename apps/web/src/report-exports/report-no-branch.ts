import type { ReportId } from "@eyadex/contracts/finance-reports";

/**
 * Reports with no branch filter, on screen and in the export form. R6 is the current clinic-wide
 * remaining credit (owner decision 2026-10-27): a branch cannot narrow it, so no branch field is
 * shown, no branch list is fetched and the request never carries `branchId`. R10 is the caller's own
 * lines in his own reach, with no branch column (card 7): a branch filter would only hide his own
 * months, so it follows the same rule.
 */
export const NO_BRANCH_REPORTS: ReadonlySet<ReportId> = new Set<ReportId>([
  "patient_credit",
  "own_summary",
]);
