import type {
  reportOutstandingQuerySchema,
  reportOutstandingResponseSchema,
} from "@eyadex/contracts/finance-reports";
import type { z } from "zod";
import { REPORT_PAGE_SIZE, useReportPages, type PageRequest } from "./use-report-pages";

export type OutstandingQuery = z.output<typeof reportOutstandingQuerySchema>;
export type OutstandingPage = z.output<typeof reportOutstandingResponseSchema>;
/** The filters the pager is given: the pager alone owns the cursor and the page size. */
export type OutstandingFilters = Omit<OutstandingQuery, "cursor" | "limit">;
type OutstandingRow = OutstandingPage["items"][number];

export const OUTSTANDING_PAGE_SIZE = REPORT_PAGE_SIZE;

const request: PageRequest<OutstandingFilters, OutstandingPage> = (api, persona, query) =>
  api.reports.outstanding(persona, query);

/** R5 page by page over the shared cursor pager; the whole-range summary comes from page 1. */
export function useOutstandingPages(filters: OutstandingFilters | null) {
  const { first, ...pages } = useReportPages<OutstandingFilters, OutstandingRow, OutstandingPage>(
    "outstanding",
    request,
    filters,
  );
  return { ...pages, summary: first?.summary ?? [] };
}
