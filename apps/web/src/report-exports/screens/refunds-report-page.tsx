import { reportRefundQuerySchema } from "@eyadex/contracts/finance-reports";
import { RefundsReportBody } from "./refunds-report-body";
import { ReportContent } from "./report-content";
import { ReportShell } from "./report-shell";
import { useReportFilters } from "./use-report-filters";
import { useRefundsPages, type RefundsFilters, type RefundsQuery } from "./use-refunds-pages";

/** The filters without the pager's own fields: the pager adds the page size and the cursor. */
const filtersOf = (query: RefundsQuery | null): RefundsFilters | null => {
  if (query === null) return null;
  const { cursor: _cursor, limit: _limit, ...rest } = query;
  return rest;
};

/** R7 «المستردات»: the refunds of the period, 50 per page. */
export function RefundsReportPage() {
  const f = useReportFilters<RefundsQuery>("refunds", reportRefundQuerySchema);
  const pages = useRefundsPages(filtersOf(f.query));
  return (
    <ReportShell report="refunds" filters={f.filters} zone={f.zone} issues={f.issues} onChange={f.set}>
      {f.query === null && !f.waiting ? null : (
        <ReportContent
          loading={f.waiting || pages.isLoading}
          error={pages.error}
          empty={pages.currency !== null && pages.rows.length === 0}
          onRetry={pages.retry}
        >
          {pages.currency !== null ? <RefundsReportBody pages={pages} /> : null}
        </ReportContent>
      )}
    </ReportShell>
  );
}
