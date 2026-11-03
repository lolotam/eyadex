import { reportOutstandingQuerySchema } from "@eyadex/contracts/finance-reports";
import { OutstandingReportBody } from "./outstanding-report-body";
import { ReportContent } from "./report-content";
import { ReportShell } from "./report-shell";
import { useReportFilters } from "./use-report-filters";
import {
  useOutstandingPages,
  type OutstandingFilters,
  type OutstandingQuery,
} from "./use-outstanding-pages";

/** The filters without the pager's own fields: the pager adds the page size and the cursor. */
const filtersOf = (query: OutstandingQuery | null): OutstandingFilters | null => {
  if (query === null) return null;
  const { cursor: _cursor, limit: _limit, ...rest } = query;
  return rest;
};

/** R5 «المبالغ المستحقة»: issued invoices that still owe, by age bucket, 50 per page. */
export function OutstandingReportPage() {
  const f = useReportFilters<OutstandingQuery>("outstanding", reportOutstandingQuerySchema);
  const pages = useOutstandingPages(filtersOf(f.query));
  return (
    <ReportShell
      report="outstanding"
      filters={f.filters}
      zone={f.zone}
      issues={f.issues}
      onChange={f.set}
    >
      {f.query === null && !f.waiting ? null : (
        <ReportContent
          loading={f.waiting || pages.isLoading}
          error={pages.error}
          empty={pages.currency !== null && pages.rows.length === 0}
          onRetry={pages.retry}
        >
          {pages.currency !== null ? (
            <OutstandingReportBody pages={pages} perBranch={f.filters.branchId === null} />
          ) : null}
        </ReportContent>
      )}
    </ReportShell>
  );
}
