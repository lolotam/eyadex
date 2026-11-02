import { useEffect, useState } from "react";
import type { ReportGroupBy } from "@eyadex/contracts/finance-reports";
import { todayInTimeZone } from "@eyadex/contracts/patients";
import { useSession } from "@/shared/persona/persona-provider";
import { useExportBranchOptions } from "../use-export-branch-options";
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
  // The same cached branch list the filters bar shows. A chosen branch is sent only while it is in
  // the loaded list: if reach narrows it is dropped back to all branches (never sent to be refused),
  // and while the list reloads the query waits instead of sending the old choice.
  const branches = useExportBranchOptions(report);
  const chosen = filters.branchId;
  const outOfReach =
    chosen !== null && branches.isReady && !branches.items.some((b) => b.id === chosen);
  const waiting = chosen !== null && !branches.isReady;
  const branchId = outOfReach ? null : chosen;
  useEffect(() => {
    if (outOfReach)
      setFilters((old) => (old.branchId === chosen ? { ...old, branchId: null } : old));
  }, [outOfReach, chosen]);
  const parsed = schema.safeParse({
    from: filters.from,
    to: filters.to,
    ...(branchId !== null ? { branchId } : {}),
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
    filters: { ...filters, branchId },
    zone,
    issues,
    query: parsed.success && !waiting ? parsed.data : null,
    set: (change: Partial<ReportFilters>) => setFilters((old) => ({ ...old, ...change })),
  };
}
