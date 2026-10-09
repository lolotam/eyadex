import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

export const scheduleKeys = { all: ["clinic", "schedules"] as const };

const retry = (count: number, error: unknown) => !(error instanceof ApiError) && count < 2;

function usePersonaKey() {
  const { persona, ready } = usePersona();
  return {
    persona,
    enabled: ready && persona.kind !== "platform_admin" && Boolean(persona.clinicId),
    key: [persona.kind, persona.clinicId, persona.memberId] as const,
  };
}

export function useProviders() {
  const api = useApi();
  const { persona, enabled, key } = usePersonaKey();
  return useQuery({
    queryKey: [...scheduleKeys.all, "providers", ...key],
    queryFn: () => api.scheduling.listProviders(persona),
    enabled,
    retry,
  });
}

export function useProviderSchedule(membershipId: string | null) {
  const api = useApi();
  const { persona, enabled, key } = usePersonaKey();
  return useQuery({
    queryKey: [...scheduleKeys.all, "provider", membershipId, ...key],
    queryFn: () => api.scheduling.getProviderSchedule(persona, membershipId ?? ""),
    enabled: enabled && membershipId !== null,
    retry,
  });
}

export function useRefreshSchedules() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
}
