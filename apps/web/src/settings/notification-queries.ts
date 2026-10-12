import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

function usePersonaKey() {
  const { persona, ready } = usePersona();
  return { persona, ready, key: [persona.kind, persona.clinicId, persona.memberId] as const };
}

export function useNotificationSettings() {
  const api = useApi();
  const { persona, ready, key } = usePersonaKey();
  return useQuery({
    queryKey: ["clinic", "notification-settings", ...key],
    queryFn: () => api.notifications.getSettings(persona),
    enabled: ready && persona.kind !== "platform_admin",
    retry: false,
  });
}

export function useMailProviders() {
  const api = useApi();
  const { persona, ready, key } = usePersonaKey();
  return useQuery({
    queryKey: ["clinic", "mail-providers", ...key],
    queryFn: () => api.notifications.mailProviders(persona),
    enabled: ready && persona.kind !== "platform_admin",
    retry: false,
  });
}

export function useRefreshMailProviders() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ["clinic", "mail-providers"] });
}
