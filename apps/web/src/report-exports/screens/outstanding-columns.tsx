import { Link } from "@tanstack/react-router";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { AgeBucketBadge } from "./age-bucket-badge";
import type { ReportColumn } from "./report-table";
import type { OutstandingPage } from "./use-outstanding-pages";
import type { useReportFormat } from "./use-report-format";

export type OutstandingRow = OutstandingPage["items"][number];
type Format = ReturnType<typeof useReportFormat>;

/**
 * R5 columns. The patient appears by name only, as plain text: no id, no link into the file. The
 * invoice number links to the invoice page when the caller holds `view:invoices`.
 */
export function useOutstandingColumns(fmt: Format, canOpenInvoice: boolean) {
  const { t } = useI18n();
  const columns: ReportColumn<OutstandingRow>[] = [
    {
      key: "invoiceNumber",
      label: t("financeReports.outstanding.columns.invoiceNumber"),
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
    { key: "branch", label: t("financeReports.columns.branch"), cell: (r) => r.branchName },
    {
      key: "issueDay",
      label: t("financeReports.outstanding.columns.issueDay"),
      cell: (r) => fmt.period(r.businessDate),
    },
    {
      key: "patient",
      label: t("financeReports.outstanding.columns.patient"),
      cell: (r) => r.patientName,
    },
    {
      key: "total",
      label: t("financeReports.outstanding.columns.total"),
      numeric: true,
      cell: (r) => fmt.money(r.totalMinor),
    },
    {
      key: "paid",
      label: t("financeReports.outstanding.columns.paid"),
      numeric: true,
      cell: (r) => fmt.money(r.paidMinor),
    },
    {
      key: "owed",
      label: t("financeReports.outstanding.columns.owed"),
      numeric: true,
      cell: (r) => fmt.money(r.owedMinor),
    },
    {
      key: "age",
      label: t("financeReports.outstanding.columns.age"),
      cell: (r) => <AgeBucketBadge bucket={r.ageBucket} />,
    },
  ];
  return columns;
}
