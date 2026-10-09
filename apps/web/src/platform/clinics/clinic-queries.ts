import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ClinicListQuery } from "@eyadex/contracts/clinics";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

export const clinicKeys = {
  all: ["platform", "clinics"] as const,
  list: (q: ClinicListQuery) => ["platform", "clinics", "list", q] as const,
  detail: (id: string) => ["platform", "clinics", "detail", id] as const,
  members: (id: string) => ["platform", "clinics", "members", id] as const,
  branches: (id: string) => ["platform", "clinics", "branches", id] as const,
};

export function useClinicList(query: ClinicListQuery) {
  const api = useApi();
  const { persona } = usePersona();
  return useQuery({
    queryKey: clinicKeys.list(query),
    queryFn: () => api.platform.listClinics(persona, query),
    placeholderData: keepPreviousData,
  });
}

export function useClinic(id: string) {
  const api = useApi();
  const { persona } = usePersona();
  return useQuery({
    queryKey: clinicKeys.detail(id),
    queryFn: () => api.platform.getClinic(persona, id),
  });
}

export function useClinicMembers(id: string) {
  const api = useApi();
  const { persona } = usePersona();
  return useQuery({
    queryKey: clinicKeys.members(id),
    queryFn: () => api.platform.listClinicMembers(persona, id),
  });
}

export function useClinicBranches(id: string) {
  const api = useApi();
  const { persona } = usePersona();
  return useQuery({
    queryKey: clinicKeys.branches(id),
    queryFn: () => api.platform.listClinicBranches(persona, id),
  });
}

/**
 * The platform settings a new clinic's form starts from. Same key as the settings page, so saving
 * the settings refreshes it.
 */
export function useNewClinicSettings() {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: ["platform", "settings", persona.kind, persona.memberId],
    queryFn: () => api.platformSettings.get(persona),
    enabled: ready,
    retry: false,
  });
}
