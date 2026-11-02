import { useId } from "react";
import type { ReportGroupBy } from "@eyadex/contracts/finance-reports";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ExportDateField } from "../export-date-field";
import { ExportSelectField } from "../export-select-field";
import { useExportBranchOptions } from "../use-export-branch-options";
import { SCREEN_GROUP_DEFAULT, type ScreenReportId } from "./report-catalogue";
import type { ReportFilterIssue, ReportFilters } from "./use-report-filters";

const ALL = "__all__";

type Props = {
  report: ScreenReportId;
  filters: ReportFilters;
  zone: string;
  issues: Partial<Record<"from" | "to", ReportFilterIssue>>;
  onChange: (change: Partial<ReportFilters>) => void;
};

/** From/To clinic days, the report's own branch list (inactive marked) and R1/R2 grouping. */
export function ReportFiltersBar({ report, filters, zone, issues, onChange }: Props) {
  const { t, pick } = useI18n();
  const uid = useId();
  const branches = useExportBranchOptions(report);
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
        <ExportSelectField
          id={`${uid}-branch`}
          label={t("financeReports.filters.branch")}
          value={branches.isReady ? (filters.branchId ?? ALL) : ""}
          options={[
            { value: ALL, label: t("financeReports.filters.allBranches") },
            ...branches.items.map((b) => ({
              value: b.id,
              label: b.isActive
                ? pick(b.nameAr, b.nameEn)
                : t("financeReports.filters.inactive", { name: pick(b.nameAr, b.nameEn) }),
            })),
          ]}
          onChange={(value) => onChange({ branchId: value === ALL ? null : value })}
          disabled={!branches.isReady}
        />
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
      {branches.error !== null ? (
        <p role="alert" className="flex items-center gap-2 text-xs text-muted-foreground">
          {t("financeReports.filters.branchesError")}
          <Button variant="ghost" size="sm" onClick={() => branches.retry()}>
            {t("financeReports.states.retry")}
          </Button>
        </p>
      ) : null}
    </section>
  );
}
