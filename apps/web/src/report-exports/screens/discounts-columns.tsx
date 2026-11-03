import { Link } from "@tanstack/react-router";
import { FileText, ListOrdered } from "lucide-react";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ReasonText } from "./reason-text";
import type { ReportColumn } from "./report-table";
import type { DiscountRow } from "./use-discounts-pages";
import type { useReportFormat } from "./use-report-format";

type Format = ReturnType<typeof useReportFormat>;

/**
 * R8 columns. The patient by name only, as plain text. The invoice number links to the invoice
 * page only when the caller holds `view:invoices` (as R5 does); otherwise it is plain text.
 */
export function useDiscountsColumns(fmt: Format, canOpenInvoice: boolean) {
  const { t } = useI18n();
  const C = "financeReports.adjustments.columns";
  const columns: ReportColumn<DiscountRow>[] = [
    {
      key: "invoiceNumber",
      label: t(`${C}.invoiceNumber`),
      cell: (r) =>
        canOpenInvoice ? (
          <Link
            to="/clinic/invoices/$invoiceId"
            params={{ invoiceId: r.invoiceId }}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            <bdi dir="ltr">{r.invoiceNumber}</bdi>
          </Link>
        ) : (
          <bdi dir="ltr">{r.invoiceNumber}</bdi>
        ),
    },
    { key: "day", label: t(`${C}.issueDay`), cell: (r) => fmt.period(r.businessDate) },
    { key: "branch", label: t("financeReports.columns.branch"), cell: (r) => r.branchName },
    { key: "patient", label: t(`${C}.patient`), cell: (r) => r.patientName },
    {
      key: "kind",
      label: t(`${C}.kind`),
      cell: (r) => {
        const Icon = r.kind === "line" ? ListOrdered : FileText;
        return (
          <span className="inline-flex items-center gap-1">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {t(`financeReports.adjustments.kind.${r.kind}`)}
          </span>
        );
      },
    },
    {
      key: "discount",
      label: t(`${C}.discount`),
      numeric: true,
      cell: (r) => fmt.money(r.discountMinor),
    },
    {
      key: "discountedBy",
      label: t(`${C}.discountedBy`),
      cell: (r) => r.discountedByName ?? t("financeReports.adjustments.noValue"),
    },
    { key: "reason", label: t(`${C}.reason`), cell: (r) => <ReasonText reason={r.reason} /> },
  ];
  return columns;
}
