import { reportDiscountQuerySchema } from "@eyadex/contracts/finance-reports";
import { DiscountsReportBody } from "./discounts-report-body";
import { ReportContent } from "./report-content";
import { ReportShell } from "./report-shell";
import { useReportFilters } from "./use-report-filters";
import {
  useDiscountsPages,
  type DiscountsFilters,
  type DiscountsQuery,
} from "./use-discounts-pages";

/** The filters without the pager's own fields: the pager adds the page size and the cursor. */
const filtersOf = (query: DiscountsQuery | null): DiscountsFilters | null => {
  if (query === null) return null;
  const { cursor: _cursor, limit: _limit, ...rest } = query;
  return rest;
};

/** R8 «الخصومات»: the discounts on invoices issued in the period, 50 per page. */
export function DiscountsReportPage() {
  const f = useReportFilters<DiscountsQuery>("discounts", reportDiscountQuerySchema);
  const pages = useDiscountsPages(filtersOf(f.query));
  return (
    <ReportShell
      report="discounts"
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
          {pages.currency !== null ? <DiscountsReportBody pages={pages} /> : null}
        </ReportContent>
      )}
    </ReportShell>
  );
}
