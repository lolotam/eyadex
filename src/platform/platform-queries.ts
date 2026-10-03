import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

// Team rows carry emails: gcTime 0 so they never outlive the screen or the persona.
export function usePlatformTeam() {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: ["platform", "team", persona.kind, persona.memberId],
    queryFn: () => api.platformTeam.list(persona),
    enabled: ready && persona.kind === "platform_admin",
    gcTime: 0,
    retry: false,
  });
}

export function usePlatformOverview() {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: ["platform", "overview", persona.kind, persona.memberId],
    queryFn: () => api.platformOverview.get(persona),
    enabled: ready && persona.kind === "platform_admin",
    gcTime: 0,
    retry: false,
    // Counts and the expiring list are computed from the current time: keep them moving.
    refetchInterval: 60_000,
  });
}

/** Team changes can affect the signed-in account itself: refresh the session too. */
export function useRefreshPlatform() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["session"] });
    void queryClient.invalidateQueries({ queryKey: ["platform"] });
  };
}
