import type { ReportId } from "@eyadex/contracts/finance-reports";

/**
 * Reports with no branch filter, on screen and in the export form. R6 is the current clinic-wide
 * remaining credit (owner decision 2026-10-27): a branch cannot narrow it, so no branch field is
 * shown, no branch list is fetched and the request never carries `branchId`.
 */
export const NO_BRANCH_REPORTS: ReadonlySet<ReportId> = new Set<ReportId>(["patient_credit"]);
