import { useId } from "react";
import type { ReportGroupBy } from "@eyadex/contracts/finance-reports";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ExportDateField } from "../export-date-field";
import { ExportSelectField } from "../export-select-field";
import { SCREEN_GROUP_DEFAULT, SCREEN_NO_BRANCH, type ScreenReportId } from "./report-catalogue";
import { ReportBranchPicker } from "./report-branch-picker";
import type { ReportFilterIssue, ReportFilters } from "./use-report-filters";

type Props = {
  report: ScreenReportId;
  filters: ReportFilters;
  zone: string;
  issues: Partial<Record<"from" | "to", ReportFilterIssue>>;
  onChange: (change: Partial<ReportFilters>) => void;
};

/** From/To clinic days, the report's own branch list (not for clinic-wide R6) and R1/R2 grouping. */
export function ReportFiltersBar({ report, filters, zone, issues, onChange }: Props) {
  const { t } = useI18n();
  const uid = useId();
  const helpId = `${uid}-zone`;
  const issueText = (issue: ReportFilterIssue | undefined) =>
    issue === undefined
      ? null
      : issue === "invalid"
        ? t("errors.validation")
        : t(`financeReports.issues.${issue}`);
  const groupable = SCREEN_GROUP_DEFAULT[report] !== undefined;
  return (
    <section
      aria-label={t("financeReports.filters.title")}
      className="flex flex-col gap-2 rounded-md border bg-card p-4 print:hidden"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        {(["from", "to"] as const).map((name) => (
          <ExportDateField
            key={name}
            id={`${uid}-${name}`}
            label={t(`financeReports.filters.${name}`)}
            value={filters[name]}
            helpId={helpId}
            error={issueText(issues[name])}
            disabled={false}
            onChange={(value) => onChange({ [name]: value })}
          />
        ))}
        {SCREEN_NO_BRANCH.has(report) ? null : (
          <ReportBranchPicker
            id={`${uid}-branch`}
            report={report}
            branchId={filters.branchId}
            onChange={(branchId) => onChange({ branchId })}
          />
        )}
        {groupable ? (
          <ExportSelectField
            id={`${uid}-group`}
            label={t("financeReports.filters.groupBy")}
            value={filters.groupBy ?? ""}
            options={(["day", "month"] as const).map((g) => ({
              value: g,
              label: t(`financeReports.filters.group.${g}`),
            }))}
            onChange={(value) => onChange({ groupBy: value as ReportGroupBy })}
          />
        ) : null}
      </div>
      <p id={helpId} className="text-xs text-muted-foreground">
        {t("financeReports.filters.zoneHint", { zone })}
      </p>
    </section>
  );
}
