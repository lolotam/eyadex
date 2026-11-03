import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ExportSelectField } from "../export-select-field";
import { useExportBranchOptions } from "../use-export-branch-options";
import type { ScreenReportId } from "./report-catalogue";

const ALL = "__all__";

type Props = {
  id: string;
  report: ScreenReportId;
  branchId: string | null;
  onChange: (branchId: string | null) => void;
};

/** The report's own branch list (inactive marked), with its retry notice when it cannot load. */
export function ReportBranchPicker({ id, report, branchId, onChange }: Props) {
  const { t, pick } = useI18n();
  const branches = useExportBranchOptions(report);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <ExportSelectField
        id={id}
        label={t("financeReports.filters.branch")}
        value={branches.isLoading ? "" : (branchId ?? ALL)}
        options={[
          { value: ALL, label: t("financeReports.filters.allBranches") },
          ...branches.items.map((b) => ({
            value: b.id,
            label: b.isActive
              ? pick(b.nameAr, b.nameEn)
              : t("financeReports.filters.inactive", { name: pick(b.nameAr, b.nameEn) }),
          })),
        ]}
        onChange={(value) => onChange(value === ALL ? null : value)}
        disabled={branches.isLoading}
      />
      {branches.error !== null ? (
        <p role="alert" className="flex items-center gap-2 text-xs text-muted-foreground">
          {t("financeReports.filters.branchesError")}
          <Button variant="ghost" size="sm" onClick={() => branches.retry()}>
            {t("financeReports.states.retry")}
          </Button>
        </p>
      ) : null}
    </div>
  );
}
