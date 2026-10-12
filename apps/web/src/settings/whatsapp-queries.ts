import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

export function useWhatsappChannel() {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: ["clinic", "whatsapp", persona.kind, persona.clinicId, persona.memberId],
    queryFn: () => api.whatsapp.channel(persona),
    enabled: ready && persona.kind !== "platform_admin",
    retry: false,
  });
}

export function useRefreshWhatsapp() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ["clinic", "whatsapp"] });
}
