import { useI18n } from "@/shared/i18n/i18n-provider";
import { useOwnSummaryColumns, type OwnSummaryResponse } from "./own-summary-columns";
import { sumMinor } from "./report-money";
import { ReportTable } from "./report-table";
import { useReportFormat } from "./use-report-format";

type Props = { data: OwnSummaryResponse };

/**
 * The R10 body: one row per clinic month. The totals row is the response's own total, shown only
 * when it equals the BigInt sum of the rows on screen; a disagreeing total is never displayed.
 */
export function OwnSummaryReportBody({ data }: Props) {
  const { t } = useI18n();
  const fmt = useReportFormat(data.currency, data.currencyExponent);
  const columns = useOwnSummaryColumns(fmt);
  const agrees = sumMinor(data.rows.map((r) => r.billedMinor)) === data.totals.billedMinor;
  return (
    <ReportTable
      caption={t("financeReports.names.own_summary")}
      columns={columns}
      rows={data.rows}
      rowKey={(r) => `${r.period}-${r.currency}`}
      totals={{
        billed: agrees ? fmt.money(data.totals.billedMinor) : t("financeReports.ownSummary.noValue"),
      }}
    />
  );
}
