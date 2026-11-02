import { Link } from "@tanstack/react-router";
import { MessageSquareText, MinusCircle } from "lucide-react";
import type { reportCashClosingResponseSchema } from "@eyadex/contracts/finance-reports";
import type { z } from "zod";
import { useI18n } from "@/shared/i18n/i18n-provider";
import type { ReportColumn } from "./report-table";
import { DifferenceCell } from "./difference-cell";
import { SignedAmount } from "./signed-amount";
import type { useReportFormat } from "./use-report-format";

export type CashClosingRow = z.infer<typeof reportCashClosingResponseSchema>["rows"][number];
type Format = ReturnType<typeof useReportFormat>;

/** The R9 columns; the business day links to the closing page only when the caller may open it. */
export function useCashClosingColumns(fmt: Format, canOpenClosing: boolean) {
  const { t } = useI18n();
  const columns: ReportColumn<CashClosingRow>[] = [
    {
      key: "businessDate",
      label: t("financeReports.columns.businessDay"),
      cell: (r) =>
        canOpenClosing ? (
          <Link
            to="/clinic/cash-closings/$closingId"
            params={{ closingId: r.closingId }}
            className="text-primary underline-offset-2 hover:underline"
            aria-label={t("financeReports.cashClosings.openClosing", {
              day: fmt.period(r.businessDate),
            })}
          >
            {fmt.period(r.businessDate)}
          </Link>
        ) : (
          fmt.period(r.businessDate)
        ),
    },
    { key: "branch", label: t("financeReports.columns.branch"), cell: (r) => r.branchName },
    {
      key: "expected",
      label: t("financeReports.columns.expected"),
      numeric: true,
      cell: (r) => <SignedAmount minor={r.expectedMinor} text={fmt.money(r.expectedMinor)} />,
    },
    {
      key: "counted",
      label: t("financeReports.columns.counted"),
      numeric: true,
      cell: (r) => fmt.money(r.countedMinor),
    },
    {
      key: "difference",
      label: t("financeReports.columns.difference"),
      numeric: true,
      cell: (r) => <DifferenceCell minor={r.differenceMinor} text={fmt.money(r.differenceMinor)} />,
    },
    {
      key: "closedBy",
      label: t("financeReports.columns.closedBy"),
      cell: (r) => r.closedByName ?? t("financeReports.cashClosings.noValue"),
    },
    {
      key: "note",
      label: t("financeReports.columns.note"),
      cell: (r) => {
        const Icon = r.notePresent ? MessageSquareText : MinusCircle;
        return (
          <span className="inline-flex items-center gap-1 text-xs">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {t(`financeReports.cashClosings.${r.notePresent ? "noteYes" : "noteNo"}`)}
          </span>
        );
      },
    },
  ];
  return columns;
}
