import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ClinicAuditListQuery, PlatformAuditListQuery } from "@contracts/audit";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

// Audit rows can name sensitive actions; gcTime 0 so nothing outlives the screen or the persona.
export function useClinicAudit(query: ClinicAuditListQuery) {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: ["clinic", "audit", query, persona.kind, persona.clinicId, persona.memberId],
    queryFn: () => api.audit.clinicList(persona, query),
    enabled: ready && persona.kind !== "platform_admin" && Boolean(persona.clinicId),
    gcTime: 0,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function usePlatformAudit(query: PlatformAuditListQuery) {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: ["platform", "audit", query, persona.kind],
    queryFn: () => api.audit.platformList(persona, query),
    enabled: ready && persona.kind === "platform_admin",
    gcTime: 0,
    retry: false,
    placeholderData: keepPreviousData,
  });
}
