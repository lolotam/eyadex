import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import type { CashClosing } from "@eyadex/contracts/finance";
import type { BranchOption } from "@eyadex/contracts/users";
import { formatMinor, formatSignedMinor } from "@eyadex/contracts/money";
import { branchNameIn } from "@/payments/receipt-queries";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ClosingDifference } from "./closing-difference";

const amount = "block whitespace-nowrap text-end tabular-nums";

/** Business day (opens the closing), branch, expected, counted, difference, note; no "closed by". */
export function useClosingColumns(branches: readonly BranchOption[] | undefined) {
  const { t, pick, formatDate } = useI18n();
  return useMemo<ColumnDef<CashClosing>[]>(
    () => [
      {
        id: "date",
        header: t("cashClosings.date"),
        cell: ({ row }) => (
          <Link
            to="/clinic/cash-closings/$closingId"
            params={{ closingId: row.original.id }}
            className="whitespace-nowrap font-medium text-primary underline-offset-4 hover:underline"
          >
            {formatDate(row.original.businessDate)}
          </Link>
        ),
      },
      {
        id: "branch",
        header: t("cashClosings.branch"),
        cell: ({ row }) => branchNameIn(branches, row.original.branchId, pick),
      },
      {
        id: "expected",
        header: () => <span className="block text-end">{t("cashClosings.expected")}</span>,
        cell: ({ row }) => (
          <span className={amount} dir="ltr">
            {`${formatSignedMinor(row.original.expectedMinor, row.original.currencyExponent)} ${row.original.currency}`}
          </span>
        ),
      },
      {
        id: "counted",
        header: () => <span className="block text-end">{t("cashClosings.counted")}</span>,
        cell: ({ row }) => (
          <span className={amount} dir="ltr">
            {`${formatMinor(row.original.countedMinor, row.original.currencyExponent)} ${row.original.currency}`}
          </span>
        ),
      },
      {
        id: "difference",
        header: t("cashClosings.difference"),
        cell: ({ row }) => (
          <ClosingDifference
            differenceMinor={row.original.differenceMinor}
            exponent={row.original.currencyExponent}
            currency={row.original.currency}
          />
        ),
      },
      {
        id: "note",
        header: t("cashClosings.note"),
        cell: ({ row }) => (
          <span className="block max-w-56 truncate text-start" title={row.original.note ?? ""}>
            {row.original.note ?? "—"}
          </span>
        ),
      },
    ],
    [t, pick, formatDate, branches],
  );
}
