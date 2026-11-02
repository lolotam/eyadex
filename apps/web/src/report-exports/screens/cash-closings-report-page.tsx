import { reportCashClosingQuerySchema } from "@eyadex/contracts/finance-reports";
import type { z } from "zod";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import { can } from "@/shared/permissions/can";
import { useCashClosingColumns } from "./cash-closings-report-columns";
import { DifferenceCell } from "./difference-cell";
import { ReportContent } from "./report-content";
import { ReportShell } from "./report-shell";
import { ReportTable } from "./report-table";
import { SignedAmount } from "./signed-amount";
import { useReportFilters } from "./use-report-filters";
import { useReportFormat } from "./use-report-format";
import { useReportQuery } from "./use-report-query";

type Query = z.output<typeof reportCashClosingQuerySchema>;

/**
 * R9 «سجل إقفال الصندوق»: one row per saved closing (single table, the contract has no cursor).
 * The totals are the response's own; method totals are never read or shown.
 */
export function CashClosingsReportPage() {
  const { t } = useI18n();
  const { session } = useSession();
  const f = useReportFilters<Query>("cash_closings", reportCashClosingQuerySchema);
  const q = useReportQuery("cash_closings", f.query, (api, persona, query) =>
    api.reports.cashClosings(persona, query),
  );
  const data = q.data;
  const fmt = useReportFormat(data?.currency ?? "", data?.currencyExponent ?? 0);
  const columns = useCashClosingColumns(
    fmt,
    can(session?.permissions ?? [], "view", "cash_closings"),
  );
  return (
    <ReportShell
      report="cash_closings"
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
              caption={t("financeReports.names.cash_closings")}
              columns={columns}
              rows={data.rows}
              rowKey={(r) => r.closingId}
              totals={{
                expected: (
                  <SignedAmount
                    minor={data.totals.expectedMinor}
                    text={fmt.money(data.totals.expectedMinor)}
                  />
                ),
                counted: fmt.money(data.totals.countedMinor),
                difference: (
                  <DifferenceCell
                    minor={data.totals.differenceMinor}
                    text={fmt.money(data.totals.differenceMinor)}
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
