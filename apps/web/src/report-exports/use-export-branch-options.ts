import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReportId } from "@eyadex/contracts/finance-reports";
import { reportPermissionScope } from "@eyadex/contracts/finance-report-access";
import type { BranchOptionListResponse } from "@eyadex/contracts/role-admin";
import { useApi } from "@/shared/api/api-provider";
import { errorKeyOf } from "@/shared/api/api-error";
import { usePersona, useSession } from "@/shared/persona/persona-provider";

export type ExportBranchOption = BranchOptionListResponse["items"][number];
const PAGE = 100;

/**
 * The export form's branch list for one report: every page of `reports.branchOptions`, published
 * only when all pages succeed. Requester history does not depend on this hook.
 */
export function useExportBranchOptions(selectedReport: ReportId | null) {
  const api = useApi();
  const { persona, ready } = usePersona();
  const { session, isLoading, error: sessionError } = useSession();
  const coherent =
    ready &&
    !isLoading &&
    !sessionError &&
    !!session?.membershipId &&
    !!session.clinic &&
    session.clinic.id === persona.clinicId &&
    session.persona.kind === persona.kind &&
    session.persona.memberId === persona.memberId;
  const eligible =
    coherent &&
    selectedReport !== null &&
    session.blocked === null &&
    session.features.finance === true &&
    reportPermissionScope(session.permissions, selectedReport) !== null;
  // Every access input is part of the identity, so a permission or reach change never shows old names.
  const key = [
    "clinic",
    "report-export-branch-options",
    persona.kind,
    persona.clinicId,
    persona.memberId,
    session?.clinic?.id ?? null,
    session?.membershipId ?? null,
    selectedReport,
    [...(session?.permissions ?? [])].sort().join(" "),
    session?.allBranches ?? null,
    [...(session?.branchIds ?? [])].sort().join(" "),
    session?.blocked ?? null,
    session?.features.finance ?? null,
    eligible,
  ] as const;
  const scope = JSON.stringify(key);
  const identity = useRef(scope);
  const generation = useRef(0);
  if (identity.current !== scope) generation.current += 1;
  identity.current = scope;
  const epoch = generation.current;
  const mounted = useRef(false);
  const current = () =>
    mounted.current && identity.current === scope && generation.current === epoch;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const query = useQuery({
    queryKey: [...key, epoch],
    enabled: eligible,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }): Promise<ExportBranchOption[]> => {
      if (selectedReport === null) throw new Error("No report selected");
      const found = new Map<string, ExportBranchOption>();
      let cursor: string | null = null;
      do {
        if (signal.aborted || !current()) throw new Error("Cancelled branch options");
        const page: BranchOptionListResponse = await api.reports.branchOptions(
          persona,
          selectedReport,
          cursor === null ? { limit: PAGE } : { limit: PAGE, cursor },
        );
        if (signal.aborted || !current()) throw new Error("Cancelled branch options");
        for (const branch of page.items) if (!found.has(branch.id)) found.set(branch.id, branch);
        cursor = page.nextCursor;
      } while (cursor !== null);
      return [...found.values()];
    },
  });

  const shown = eligible && !query.error;
  return {
    /** Complete options only; empty while loading, on any error, or when the report is not reachable. */
    items: shown ? (query.data ?? []) : [],
    isEligible: eligible,
    isReady: shown && query.isSuccess && !query.isFetching,
    isLoading: isLoading || (eligible && query.isPending),
    isRefreshing: eligible && query.isFetching,
    error: sessionError
      ? errorKeyOf(sessionError)
      : eligible && query.error
        ? errorKeyOf(query.error)
        : null,
    refresh: () => (eligible ? query.refetch({ cancelRefetch: false }) : Promise.resolve()),
    retry: () => (eligible ? query.refetch({ cancelRefetch: false }) : Promise.resolve()),
  };
}
