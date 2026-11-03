import type { reportOwnSummaryResponseSchema } from "@eyadex/contracts/finance-reports";
import type { z } from "zod";
import { useI18n } from "@/shared/i18n/i18n-provider";
import type { ReportColumn } from "./report-table";
import type { useReportFormat } from "./use-report-format";

type Format = ReturnType<typeof useReportFormat>;
export type OwnSummaryResponse = z.output<typeof reportOwnSummaryResponseSchema>;
export type OwnSummaryRow = OwnSummaryResponse["rows"][number];

/** R10 columns: the month in the viewer's language and the billed amount, nothing else. */
export function useOwnSummaryColumns(fmt: Format): ReportColumn<OwnSummaryRow>[] {
  const { t } = useI18n();
  return [
    {
      key: "month",
      label: t("financeReports.ownSummary.month"),
      cell: (r) => fmt.period(r.period),
    },
    {
      key: "billed",
      label: t("financeReports.ownSummary.billed"),
      numeric: true,
      cell: (r) => fmt.money(r.billedMinor),
    },
  ];
}
