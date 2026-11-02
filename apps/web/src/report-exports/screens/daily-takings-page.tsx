import {
  reportDailyTakingsQuerySchema,
  type reportDailyTakingsResponseSchema,
} from "@eyadex/contracts/finance-reports";
import type { z } from "zod";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { ReportContent } from "./report-content";
import { ReportShell } from "./report-shell";
import { ReportTable, type ReportColumn } from "./report-table";
import { SignedAmount } from "./signed-amount";
import { useReportFilters } from "./use-report-filters";
import { useReportFormat } from "./use-report-format";
import { useReportQuery } from "./use-report-query";

type Response = z.infer<typeof reportDailyTakingsResponseSchema>;
type Query = z.output<typeof reportDailyTakingsQuerySchema>;
type Row = Response["rows"][number];

/** R1 «الإيراد اليومي»: money in and out per period, branch and method; the net is signed. */
export function DailyTakingsPage() {
  const { t, tDynamic } = useI18n();
  const f = useReportFilters<Query>("daily_takings", reportDailyTakingsQuerySchema);
  const q = useReportQuery("daily_takings", f.query, (api, persona, query) =>
    api.reports.dailyTakings(persona, query),
  );
  const data = q.data;
  const fmt = useReportFormat(data?.currency ?? "", data?.currencyExponent ?? 0);
  const columns: ReportColumn<Row>[] = [
    { key: "period", label: t("financeReports.columns.period"), cell: (r) => fmt.period(r.period) },
    { key: "branch", label: t("financeReports.columns.branch"), cell: (r) => r.branchName },
    {
      key: "method",
      label: t("financeReports.columns.method"),
      cell: (r) => tDynamic(`payments.method.${r.method}`),
    },
    {
      key: "in",
      label: t("financeReports.columns.in"),
      numeric: true,
      cell: (r) => fmt.money(r.inMinor),
    },
    {
      key: "out",
      label: t("financeReports.columns.out"),
      numeric: true,
      cell: (r) => fmt.money(r.outMinor),
    },
    {
      key: "net",
      label: t("financeReports.columns.net"),
      numeric: true,
      cell: (r) => <SignedAmount minor={r.netMinor} text={fmt.money(r.netMinor)} />,
    },
  ];
  return (
    <ReportShell
      report="daily_takings"
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
            <ReportTable
              caption={t("financeReports.names.daily_takings")}
              columns={columns}
              rows={data.rows}
              rowKey={(r) => `${r.period}|${r.branchId}|${r.method}`}
              groupOf={(r) => fmt.period(r.period)}
              totals={{
                in: fmt.money(data.totals.inMinor),
                out: fmt.money(data.totals.outMinor),
                net: (
                  <SignedAmount
                    minor={data.totals.netMinor}
                    text={fmt.money(data.totals.netMinor)}
                  />
                ),
              }}
            />
          ) : null}
        </ReportContent>
      )}
    </ReportShell>
  );
}
