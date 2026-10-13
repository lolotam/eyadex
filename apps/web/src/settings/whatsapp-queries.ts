import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { WhatsappChannelView } from "@eyadex/contracts/whatsapp";
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
  const { persona } = usePersona();
  return (view?: WhatsappChannelView) => {
    if (view)
      queryClient.setQueryData(
        ["clinic", "whatsapp", persona.kind, persona.clinicId, persona.memberId],
        view,
      );
    void queryClient.invalidateQueries({ queryKey: ["clinic", "whatsapp"] });
  };
}
