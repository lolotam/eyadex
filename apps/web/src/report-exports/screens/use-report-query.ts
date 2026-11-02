import { useQuery } from "@tanstack/react-query";
import type { Persona } from "@eyadex/contracts/session";
import type { ApiClient } from "@/shared/api/api-client";
import { errorKeyOf } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { usePersona, useSession } from "@/shared/persona/persona-provider";
import { canOpenReport, type ScreenReportId } from "./report-catalogue";

/**
 * One on-screen report read through the `ApiClient`. The key carries the actor, the access scope
 * and the parsed filters, so another persona, clinic or reach never sees cached rows; no automatic retry.
 */
export function useReportQuery<Q, T>(
  report: ScreenReportId,
  query: Q | null,
  read: (api: ApiClient, persona: Persona, query: Q) => Promise<T>,
) {
  const api = useApi();
  const { persona } = usePersona();
  const { session } = useSession();
  const enabled =
    query !== null &&
    !!session &&
    session.blocked === null &&
    session.features.finance === true &&
    canOpenReport(session.permissions, report);
  const result = useQuery({
    queryKey: [
      "clinic",
      "finance-reports",
      persona.kind,
      persona.clinicId,
      persona.memberId,
      session?.membershipId ?? null,
      // Every access input is part of the identity: a permission or branch-reach change refetches
      // and never keeps rows or branch names from the older scope on screen.
      [...(session?.permissions ?? [])].sort().join(" "),
      session?.allBranches ?? null,
      [...(session?.branchIds ?? [])].sort().join(" "),
      report,
      query,
    ],
    queryFn: () => read(api, persona, query as Q),
    enabled,
    retry: false,
  });
  return {
    data: enabled ? result.data : undefined,
    isLoading: enabled && result.isPending,
    error: enabled && result.error ? errorKeyOf(result.error) : null,
    retry: () => void result.refetch(),
  };
}
