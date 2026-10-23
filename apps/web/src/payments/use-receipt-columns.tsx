import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import type { Payment } from "@eyadex/contracts/finance";
import type { BranchOption } from "@eyadex/contracts/users";
import { formatMinor } from "@eyadex/contracts/money";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { canAtBranch } from "@/shared/permissions/can-at-branch";
import { useSession } from "@/shared/persona/persona-provider";
import { branchNameIn } from "./receipt-queries";

const link = "whitespace-nowrap font-medium text-primary underline-offset-4 hover:underline";

/**
 * Receipt (opens it), business day, patient name (plain text, no file open), branch, invoice (a link only
 * where the caller may view invoices at that branch), method, amount in the receipt's own currency.
 */
export function useReceiptColumns(branches: readonly BranchOption[] | undefined) {
  const { t, pick, formatDate } = useI18n();
  const { session } = useSession();
  return useMemo<ColumnDef<Payment, unknown>[]>(
    () => [
      {
        id: "number",
        header: t("payments.receipts.number"),
        cell: ({ row }) => (
          <Link
            to="/clinic/receipts/$paymentId"
            params={{ paymentId: row.original.id }}
            className={link}
            dir="ltr"
          >
            {row.original.receiptNumber}
          </Link>
        ),
      },
      {
        id: "date",
        header: t("payments.receipts.date"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{formatDate(row.original.businessDate)}</span>
        ),
      },
      {
        id: "patient",
        header: t("payments.receipts.patient"),
        cell: ({ row }) => (
          <span className="block max-w-48 truncate text-start" title={row.original.patientName}>
            {row.original.patientName}
          </span>
        ),
      },
      {
        id: "branch",
        header: t("payments.receipts.branch"),
        cell: ({ row }) => branchNameIn(branches, row.original.branchId, pick),
      },
      {
        id: "invoice",
        header: t("payments.receipts.invoice"),
        cell: ({ row }) =>
          session && canAtBranch(session, "view", "invoices", row.original.branchId) ? (
            <Link
              to="/clinic/invoices/$invoiceId"
              params={{ invoiceId: row.original.invoiceId }}
              className={link}
              dir="ltr"
            >
              {row.original.invoiceNumber}
            </Link>
          ) : (
            <span dir="ltr">{row.original.invoiceNumber}</span>
          ),
      },
      {
        id: "method",
        header: t("payments.receipts.method"),
        cell: ({ row }) => t(`payments.method.${row.original.method}`),
      },
      {
        id: "amount",
        header: () => <span className="block text-end">{t("payments.receipts.amount")}</span>,
        cell: ({ row }) => (
          <span className="block whitespace-nowrap text-end tabular-nums">
            {`${formatMinor(row.original.amountMinor, row.original.currencyExponent)} ${row.original.currency}`}
          </span>
        ),
      },
    ],
    [t, pick, formatDate, session, branches],
  );
}
