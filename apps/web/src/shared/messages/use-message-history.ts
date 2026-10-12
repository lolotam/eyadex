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
    // A queued row settles shortly after: look again while one is pending.
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => item.status === "queued") ? 1500 : false,
  });
}
