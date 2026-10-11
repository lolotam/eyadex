import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

// Every read of clinical content is audited by the API, so nothing refetches it in the background
// and nothing stays cached after leaving the screen (as the patient file, patient-queries.ts).
const AUDITED = {
  staleTime: Infinity,
  gcTime: 0,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
} as const;

export const medicalKeys = {
  all: ["clinic", "medical"] as const,
  visits: (patientId: string, cursor: string | undefined) =>
    ["clinic", "medical", "visits", patientId, cursor ?? ""] as const,
  visit: (visitId: string) => ["clinic", "medical", "visit", visitId] as const,
  profile: (patientId: string) => ["clinic", "medical", "profile", patientId] as const,
  attachments: (patientId: string, visitId: string | undefined) =>
    ["clinic", "medical", "attachments", patientId, visitId ?? ""] as const,
  medicines: ["clinic", "medical", "medicines"] as const,
  walkInBranches: ["clinic", "medical", "walk-in-branches"] as const,
};

export function useClinicPersona() {
  const { persona, ready } = usePersona();
  return {
    persona,
    enabled: ready && persona.kind !== "platform_admin" && Boolean(persona.clinicId),
    personaKey: [persona.kind, persona.clinicId, persona.memberId] as const,
  };
}

export function usePatientVisits(patientId: string, cursor: string | undefined, enabled = true) {
  const api = useApi();
  const p = useClinicPersona();
  return useQuery({
    queryKey: [...medicalKeys.visits(patientId, cursor), ...p.personaKey],
    queryFn: () => api.medical.listVisits(p.persona, patientId, cursor ? { cursor } : {}),
    enabled: p.enabled && enabled,
    ...AUDITED,
  });
}

export function useVisit(visitId: string) {
  const api = useApi();
  const p = useClinicPersona();
  return useQuery({
    queryKey: [...medicalKeys.visit(visitId), ...p.personaKey],
    queryFn: () => api.medical.getVisit(p.persona, visitId),
    enabled: p.enabled,
    refetchOnMount: "always",
    ...AUDITED,
  });
}

export function useMedicalProfile(patientId: string) {
  const api = useApi();
  const p = useClinicPersona();
  return useQuery({
    queryKey: [...medicalKeys.profile(patientId), ...p.personaKey],
    queryFn: () => api.medical.getMedicalProfile(p.persona, patientId),
    enabled: p.enabled,
    ...AUDITED,
  });
}

/** The list is the view reach's read: `enabled` is false for a caller who may only upload. */
export function useAttachments(patientId: string, visitId?: string, enabled = true) {
  const api = useApi();
  const p = useClinicPersona();
  return useQuery({
    queryKey: [...medicalKeys.attachments(patientId, visitId), ...p.personaKey],
    queryFn: () => api.medical.listAttachments(p.persona, patientId, visitId ? { visitId } : {}),
    enabled: p.enabled && enabled,
    ...AUDITED,
  });
}

export function useMedicines(enabled = true) {
  const api = useApi();
  const p = useClinicPersona();
  return useQuery({
    queryKey: [...medicalKeys.medicines, ...p.personaKey],
    queryFn: () => api.medical.listMedicines(p.persona),
    enabled: p.enabled && enabled,
    retry: false,
  });
}

export function useWalkInBranches() {
  const api = useApi();
  const p = useClinicPersona();
  return useQuery({
    queryKey: [...medicalKeys.walkInBranches, ...p.personaKey],
    queryFn: () => api.medical.walkInBranches(p.persona),
    enabled: p.enabled,
    retry: false,
  });
}

/** After a write: drop every medical read so the next one comes fresh from the API. */
export function useRefreshMedical() {
  const queryClient = useQueryClient();
  return useCallback(
    (prefix: readonly string[] = medicalKeys.all) =>
      void queryClient.invalidateQueries({ queryKey: prefix }),
    [queryClient],
  );
}
