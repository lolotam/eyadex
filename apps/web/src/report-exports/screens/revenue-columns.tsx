import { useI18n } from "@/shared/i18n/i18n-provider";
import type { ReportColumn } from "./report-table";
import type { RevenueRow } from "./revenue-rows";
import type { useReportFormat } from "./use-report-format";

type Format = ReturnType<typeof useReportFormat>;

/** R3 / R4 columns: the free, no-doctor and tax rows are named through i18n, not by the response. */
export function useRevenueColumns(fmt: Format, nameLabel: string) {
  const { t } = useI18n();
  const nameOf = (r: RevenueRow) => {
    if (r.kind === "tax") return t("financeReports.revenue.taxRow");
    if (r.kind === "free") return t("financeReports.revenue.freeRow");
    if (r.kind === "none") return t("financeReports.revenue.noDoctorRow");
    return r.name.trim() === "" ? t("financeReports.revenue.noValue") : r.name;
  };
  const columns: ReportColumn<RevenueRow>[] = [
    {
      key: "name",
      label: nameLabel,
      cell: (r) => (
        <span data-kind={r.kind} className={r.kind === "tax" ? "font-medium" : undefined}>
          {nameOf(r)}
        </span>
      ),
    },
    {
      key: "lineCount",
      label: t("financeReports.columns.lineCount"),
      numeric: true,
      cell: (r) => (r.kind === "tax" ? t("financeReports.revenue.noValue") : fmt.count(r.lineCount)),
    },
    {
      key: "quantity",
      label: t("financeReports.columns.quantity"),
      numeric: true,
      cell: (r) => (r.kind === "tax" ? t("financeReports.revenue.noValue") : fmt.count(r.quantity)),
    },
    {
      key: "amount",
      label: t("financeReports.columns.amount"),
      numeric: true,
      cell: (r) => fmt.money(r.amountMinor),
    },
  ];
  return columns;
}
