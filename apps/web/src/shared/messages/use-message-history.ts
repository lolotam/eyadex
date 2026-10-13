import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

function usePersonaKey() {
  const { persona, ready } = usePersona();
  return { persona, ready, key: [persona.kind, persona.clinicId, persona.memberId] as const };
}

/** The message history of one appointment or one visit. */
export function useMessageHistory(subject: "appointment" | "visit", id: string) {
  const api = useApi();
  const { persona, ready, key } = usePersonaKey();
  return useQuery({
    queryKey: ["clinic", "messages", subject, id, ...key],
    queryFn: () =>
      subject === "appointment"
        ? api.notifications.appointmentHistory(persona, id)
        : api.notifications.visitHistory(persona, id),
    enabled: ready && persona.kind !== "platform_admin",
    retry: false,
    // WhatsApp receipts can arrive after acceptance; keep watching until read or a final failure.
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      if (items.some((item) => item.status === "queued")) return 1500;
      return items.some(
        (item) => item.channel === "whatsapp" && item.status === "sent" && !item.readAt,
      )
        ? 5000
        : false;
    },
  });
}
