import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

function usePersonaKey() {
  const { persona, ready } = usePersona();
  return { persona, ready, key: [persona.kind, persona.clinicId, persona.memberId] as const };
}

export function useClinicSettings() {
  const api = useApi();
  const { persona, ready, key } = usePersonaKey();
  return useQuery({
    queryKey: ["clinic", "settings", ...key],
    queryFn: () => api.clinicSettings.get(persona),
    enabled: ready && persona.kind !== "platform_admin",
    retry: false,
  });
}

export function useAccountProfile() {
  const api = useApi();
  const { persona, ready, key } = usePersonaKey();
  return useQuery({
    queryKey: ["clinic", "account", ...key],
    queryFn: () => api.account.get(persona),
    enabled: ready && persona.kind !== "platform_admin",
    gcTime: 0,
    retry: false,
  });
}

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

export function usePlatformSettings() {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: ["platform", "settings", persona.kind, persona.memberId],
    queryFn: () => api.platformSettings.get(persona),
    enabled: ready && persona.kind === "platform_admin",
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
  });
}

/** Names, language and limits shown in the shell come from the session: refresh it too. */
export function useRefreshAfterSettings() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["session"] });
    void queryClient.invalidateQueries({ queryKey: ["clinic"] });
    void queryClient.invalidateQueries({ queryKey: ["platform"] });
  };
}
