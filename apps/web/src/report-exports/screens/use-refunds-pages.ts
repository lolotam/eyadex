import type {
  reportRefundQuerySchema,
  reportRefundResponseSchema,
} from "@eyadex/contracts/finance-reports";
import type { z } from "zod";
import { useReportPages, type PageRequest } from "./use-report-pages";

export type RefundsQuery = z.output<typeof reportRefundQuerySchema>;
export type RefundsPage = z.output<typeof reportRefundResponseSchema>;
export type RefundRow = RefundsPage["items"][number];
/** The filters the pager is given: the pager alone owns the cursor and the page size. */
export type RefundsFilters = Omit<RefundsQuery, "cursor" | "limit">;

const request: PageRequest<RefundsFilters, RefundsPage> = (api, persona, query) =>
  api.reports.refunds(persona, query);

/** R7 page by page over the shared cursor pager. */
export function useRefundsPages(filters: RefundsFilters | null) {
  const { first: _first, ...pages } = useReportPages<RefundsFilters, RefundRow, RefundsPage>(
    "refunds",
    request,
    filters,
  );
  return pages;
}
