import { CreditCard, Receipt } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ReasonText } from "./reason-text";
import type { ReportColumn } from "./report-table";
import type { RefundRow } from "./use-refunds-pages";
import type { useReportFormat } from "./use-report-format";

type Format = ReturnType<typeof useReportFormat>;

/** R7 columns. The patient by name only, as plain text; no refund or patient id reaches the page. */
export function useRefundsColumns(fmt: Format) {
  const { t, tDynamic } = useI18n();
  const C = "financeReports.adjustments.columns";
  const columns: ReportColumn<RefundRow>[] = [
    {
      key: "refundNumber",
      label: t(`${C}.refundNumber`),
      cell: (r) => <bdi dir="ltr">{r.refundNumber}</bdi>,
    },
    { key: "day", label: t(`${C}.businessDay`), cell: (r) => fmt.period(r.businessDate) },
    { key: "branch", label: t("financeReports.columns.branch"), cell: (r) => r.branchName },
    { key: "patient", label: t(`${C}.patient`), cell: (r) => r.patientName },
    { key: "method", label: t(`${C}.method`), cell: (r) => tDynamic(`payments.method.${r.method}`) },
    {
      key: "source",
      label: t(`${C}.source`),
      cell: (r) => {
        const Icon = r.source === "payment" ? Receipt : CreditCard;
        return (
          <span className="inline-flex items-center gap-1">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {t(`financeReports.adjustments.source.${r.source}`)}
          </span>
        );
      },
    },
    { key: "amount", label: t(`${C}.amount`), numeric: true, cell: (r) => fmt.money(r.amountMinor) },
    {
      key: "refundedBy",
      label: t(`${C}.refundedBy`),
      cell: (r) => r.refundedByName ?? t("financeReports.adjustments.noValue"),
    },
    { key: "reason", label: t(`${C}.reason`), cell: (r) => <ReasonText reason={r.reason} /> },
  ];
  return columns;
}
