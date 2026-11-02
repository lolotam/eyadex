import {
  reportPeriodSummaryQuerySchema,
  type reportPeriodSummaryResponseSchema,
} from "@eyadex/contracts/finance-reports";
import type { z } from "zod";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ReportContent } from "./report-content";
import { ReportShell } from "./report-shell";
import { ReportTable, type ReportColumn } from "./report-table";
import { useReportFilters } from "./use-report-filters";
import { useReportFormat } from "./use-report-format";
import { useReportQuery } from "./use-report-query";

type Response = z.infer<typeof reportPeriodSummaryResponseSchema>;
type Query = z.output<typeof reportPeriodSummaryQuerySchema>;
type Row = Response["rows"][number];
const MONEY = [
  ["invoiced", "invoicedMinor"],
  ["discount", "discountMinor"],
  ["tax", "taxMinor"],
  ["collected", "collectedMinor"],
  ["refunded", "refundedMinor"],
  ["creditApplied", "creditAppliedMinor"],
] as const;

/** R2 «ملخص الفترة»: invoiced to credit applied per period and branch, with the voided count. */
export function PeriodSummaryPage() {
  const { t } = useI18n();
  const f = useReportFilters<Query>(
    "period_summary",
    reportPeriodSummaryQuerySchema,
  );
  const q = useReportQuery("period_summary", f.query, (api, persona, query) =>
    api.reports.periodSummary(persona, query),
  );
  const data = q.data;
  const fmt = useReportFormat(data?.currency ?? "", data?.currencyExponent ?? 0);
  const columns: ReportColumn<Row>[] = [
    { key: "period", label: t("financeReports.columns.period"), cell: (r) => fmt.period(r.period) },
    { key: "branch", label: t("financeReports.columns.branch"), cell: (r) => r.branchName },
    ...MONEY.map(([key, field]) => ({
      key,
      label: t(`financeReports.columns.${key}`),
      numeric: true,
      cell: (r: Row) => fmt.money(r[field]),
    })),
    {
      key: "voidCount",
      label: t("financeReports.columns.voidCount"),
      numeric: true,
      cell: (r) => fmt.count(r.voidCount),
    },
  ];
  const totals = data
    ? {
        ...Object.fromEntries(MONEY.map(([key, field]) => [key, fmt.money(data.totals[field])])),
        voidCount: fmt.count(data.totals.voidCount),
      }
    : {};
  return (
    <ReportShell
      report="period_summary"
      filters={f.filters}
      zone={f.zone}
      issues={f.issues}
      onChange={f.set}
    >
      {f.query === null ? null : (
        <ReportContent
          loading={q.isLoading}
          error={q.error}
          empty={!data || data.rows.length === 0}
          onRetry={q.retry}
        >
          {data ? (
            <>
              <ReportTable
                caption={t("financeReports.names.period_summary")}
                columns={columns}
                rows={data.rows}
                rowKey={(r) => `${r.period}|${r.branchId}`}
                groupOf={(r) => fmt.period(r.period)}
                totals={totals}
              />
              <p className="text-xs text-muted-foreground">{t("financeReports.creditHelp")}</p>
            </>
          ) : null}
        </ReportContent>
      )}
    </ReportShell>
  );
}
