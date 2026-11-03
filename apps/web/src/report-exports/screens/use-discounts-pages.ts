import type {
  reportDiscountQuerySchema,
  reportDiscountResponseSchema,
} from "@eyadex/contracts/finance-reports";
import type { z } from "zod";
import { useReportPages, type PageRequest } from "./use-report-pages";

export type DiscountsQuery = z.output<typeof reportDiscountQuerySchema>;
export type DiscountsPage = z.output<typeof reportDiscountResponseSchema>;
export type DiscountRow = DiscountsPage["items"][number];
/** The filters the pager is given: the pager alone owns the cursor and the page size. */
export type DiscountsFilters = Omit<DiscountsQuery, "cursor" | "limit">;

const request: PageRequest<DiscountsFilters, DiscountsPage> = (api, persona, query) =>
  api.reports.discounts(persona, query);

/** R8 page by page over the shared cursor pager. */
export function useDiscountsPages(filters: DiscountsFilters | null) {
  const { first: _first, ...pages } = useReportPages<DiscountsFilters, DiscountRow, DiscountsPage>(
    "discounts",
    request,
    filters,
  );
  return pages;
}
