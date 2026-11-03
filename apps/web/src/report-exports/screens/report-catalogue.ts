import { reportPermissionScope } from "@eyadex/contracts/finance-report-access";
import { REPORT_IDS, type ReportGroupBy, type ReportId } from "@eyadex/contracts/finance-reports";
import { NO_BRANCH_REPORTS } from "../report-no-branch";

/** The reports that have an on-screen view: every report id since card 7. */
export const SCREEN_REPORTS = [
  "daily_takings",
  "period_summary",
  "cash_closings",
  "by_service",
  "by_doctor",
  "outstanding",
  "patient_credit",
  "refunds",
  "discounts",
  "own_summary",
] as const satisfies readonly ReportId[];
export type ScreenReportId = (typeof SCREEN_REPORTS)[number];

/** Spec §4: only R1 and R2 group their range, each with its own default. */
export const SCREEN_GROUP_DEFAULT: Partial<Record<ReportId, ReportGroupBy>> = {
  daily_takings: "day",
  period_summary: "month",
};

/**
 * Reports whose default range is the last N clinic days through today (inclusive, within the
 * 366-day cap) instead of the current clinic month. R5 ages invoices from their issue day, so a one
 * month window would always leave the older buckets empty (owner decision 2026-11-03: 365 days).
 */
export const SCREEN_DEFAULT_DAYS: Partial<Record<ScreenReportId, number>> = { outstanding: 365 };

/** Screens with no branch filter (the shared `NO_BRANCH_REPORTS`, which the export form follows too). */
export const SCREEN_NO_BRANCH: ReadonlySet<ScreenReportId> = new Set(
  SCREEN_REPORTS.filter((report) => NO_BRANCH_REPORTS.has(report)),
);

/** Reports whose numbers ignore the selected period: the shell shows the clinic-wide notice. */
export const SCREEN_CLINIC_WIDE_NOTICE: ReadonlySet<ScreenReportId> = new Set(["patient_credit"]);

export const isReportId = (value: string): value is ReportId =>
  (REPORT_IDS as readonly string[]).includes(value);

export const isScreenReport = (report: ReportId): report is ScreenReportId =>
  (SCREEN_REPORTS as readonly string[]).includes(report);

/** Permission strings only (report key + covering keys at the report's scope), never role names. */
export const canOpenReport = (permissions: readonly string[], report: ReportId): boolean =>
  reportPermissionScope(permissions, report) !== null;

/** Every report the caller may open, whether or not its screen exists yet. */
export const openableReports = (permissions: readonly string[]): ReportId[] =>
  REPORT_IDS.filter((report) => canOpenReport(permissions, report));

/** The report cards to show: built screens the caller may open. */
export const availableScreens = (permissions: readonly string[]): ScreenReportId[] =>
  SCREEN_REPORTS.filter((report) => canOpenReport(permissions, report));
