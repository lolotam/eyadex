import { reportOwnSummaryQuerySchema } from "@eyadex/contracts/finance-reports";
import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import type { z } from "zod";
import { useI18n } from "@/shared/i18n/i18n-provider";
import { useSession } from "@/shared/persona/persona-provider";
import { can } from "@/shared/permissions/can";
import { OwnSummaryReportBody } from "./own-summary-report-body";
import { ReportContent } from "./report-content";
import { ReportShell } from "./report-shell";
import { useReportFilters } from "./use-report-filters";
import { useReportQuery } from "./use-report-query";

type Query = z.output<typeof reportOwnSummaryQuerySchema>;

/**
 * R10 «ملخص فواتيري»: the caller's own billed lines per clinic month (single table, no cursor, no
 * branch filter). The drill-down is the invoices list, linked only when the caller may open it.
 */
export function OwnSummaryReportPage() {
  const { t } = useI18n();
  const { session } = useSession();
  const f = useReportFilters<Query>("own_summary", reportOwnSummaryQuerySchema);
  const q = useReportQuery("own_summary", f.query, (api, persona, query) => {
    // No branch filter for an own report: the request never carries one (NO_BRANCH_REPORTS).
    return api.reports.ownSummary(persona, { from: query.from, to: query.to });
  });
  const data = q.data;
  return (
    <ReportShell
      report="own_summary"
      filters={f.filters}
      zone={f.zone}
      issues={f.issues}
      onChange={f.set}
    >
      {can(session?.permissions ?? [], "view", "invoices") ? (
        <Link
          to="/clinic/invoices"
          className="flex w-fit items-center gap-1 text-sm text-primary underline-offset-4 hover:underline print:hidden"
        >
          <FileText className="size-4" aria-hidden />
          {t("financeReports.ownSummary.myInvoices")}
        </Link>
      ) : null}
      {f.query === null && !f.waiting ? null : (
        <ReportContent
          loading={f.waiting || q.isLoading}
          error={q.error}
          empty={!data || data.rows.length === 0}
          onRetry={q.retry}
        >
          {data ? <OwnSummaryReportBody data={data} /> : null}
        </ReportContent>
      )}
    </ReportShell>
  );
}
