import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import type { InvoiceListItem } from "@/shared/api/finance-client";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { InvoiceStatusBadge } from "./invoice-status-badge";

/**
 * Number (opens the invoice), date, branch, source, status, total in the invoice's own currency. The
 * branch name comes with the invoice: a doctor's own invoices cross branches outside its membership.
 */
export function useInvoiceColumns(
  format: (minor: string, exponent: number, currency: string) => string,
): ColumnDef<InvoiceListItem, unknown>[] {
  const { t, pick, formatDate } = useI18n();
  return useMemo(
    () => [
      {
        id: "number",
        header: t("finance.list.number"),
        cell: ({ row }) => (
          <Link
            to="/clinic/invoices/$invoiceId"
            params={{ invoiceId: row.original.id }}
            className="font-medium text-primary underline-offset-4 hover:underline"
            dir="ltr"
          >
            {row.original.number}
          </Link>
        ),
      },
      {
        id: "date",
        header: t("finance.list.date"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{formatDate(row.original.issuedAt)}</span>
        ),
      },
      {
        id: "branch",
        header: t("finance.list.branch"),
        cell: ({ row }) => pick(row.original.branchNameAr, row.original.branchNameEn),
      },
      {
        id: "source",
        header: t("finance.list.source"),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {t(`finance.detail.source.${row.original.source}`)}
          </span>
        ),
      },
      {
        id: "status",
        header: t("finance.list.status"),
        cell: ({ row }) => <InvoiceStatusBadge status={row.original.status} />,
      },
      {
        id: "total",
        header: () => <span className="block text-end">{t("finance.list.total")}</span>,
        cell: ({ row }) => (
          <span className="block whitespace-nowrap text-end tabular-nums">
            {format(row.original.totalMinor, row.original.currencyExponent, row.original.currency)}
          </span>
        ),
      },
    ],
    [t, pick, formatDate, format],
  );
}
