import { useState } from "react";
import type { ReportGroupBy } from "@eyadex/contracts/finance-reports";
import { todayInTimeZone } from "@eyadex/contracts/patients";
import { useSession } from "@/shared/persona/persona-provider";
import { SCREEN_GROUP_DEFAULT, type ScreenReportId } from "./report-catalogue";

export type ReportFilters = {
  from: string;
  to: string;
  /** null is "all branches in reach": the query then omits `branchId`. */
  branchId: string | null;
  groupBy: ReportGroupBy | null;
};

type Parser<Q> = {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: Q }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
};

const ISSUES = ["required", "date", "dateOrder", "rangeTooLong"] as const;
export type ReportFilterIssue = (typeof ISSUES)[number] | "invalid";

/** The current clinic month up to today, as clinic business days. */
export function defaultReportRange(timeZone: string, now = new Date()) {
  const to = todayInTimeZone(timeZone, now);
  return { from: `${to.slice(0, 8)}01`, to };
}

/**
 * A report screen's filters, judged by the report's own contract schema before any request: an
 * invalid or too-long range yields field issues and no query (spec §6, F3-Q6 a).
 */
export function useReportFilters<Q>(report: ScreenReportId, schema: Parser<Q>) {
  const { session } = useSession();
  const zone = session?.clinic?.timezone ?? "Asia/Kuwait";
  const [filters, setFilters] = useState<ReportFilters>(() => ({
    ...defaultReportRange(zone),
    branchId: null,
    groupBy: SCREEN_GROUP_DEFAULT[report] ?? null,
  }));
  const parsed = schema.safeParse({
    from: filters.from,
    to: filters.to,
    ...(filters.branchId !== null ? { branchId: filters.branchId } : {}),
    ...(filters.groupBy !== null ? { groupBy: filters.groupBy } : {}),
  });
  const issues: Partial<Record<"from" | "to", ReportFilterIssue>> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] === "from" ? "from" : "to";
      if (issues[field]) continue;
      const key = issue.message.startsWith("validation.")
        ? issue.message.slice("validation.".length)
        : "";
      const empty = filters[field] === "";
      issues[field] = empty
        ? "required"
        : (ISSUES as readonly string[]).includes(key)
          ? (key as ReportFilterIssue)
          : "invalid";
    }
  }
  return {
    filters,
    zone,
    issues,
    query: parsed.success ? parsed.data : null,
    set: (change: Partial<ReportFilters>) => setFilters((old) => ({ ...old, ...change })),
  };
}
