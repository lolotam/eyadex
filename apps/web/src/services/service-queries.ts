import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ServiceListQuery } from "@eyadex/contracts/services";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

export const serviceKeys = { all: ["clinic", "services"] as const };

/** Typed API errors are final answers; only unknown failures are retried. */
const retry = (count: number, error: unknown) => !(error instanceof ApiError) && count < 2;

export function useServiceList(query: ServiceListQuery) {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: [...serviceKeys.all, "list", query, persona.kind, persona.clinicId, persona.memberId],
    queryFn: () => api.scheduling.listServices(persona, query),
    enabled: ready && persona.kind !== "platform_admin" && Boolean(persona.clinicId),
    retry,
    placeholderData: keepPreviousData,
  });
}

export function useRefreshServices() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: serviceKeys.all });
}
