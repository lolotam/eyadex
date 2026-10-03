import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { PatientDetail, PatientListQuery } from "@contracts/patients";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

export const patientKeys = {
  all: ["clinic", "patients"] as const,
  list: (query: PatientListQuery) => ["clinic", "patients", "list", query] as const,
  branches: ["clinic", "patients", "branches"] as const,
  detail: (id: string) => ["clinic", "patients", "detail", id] as const,
};

function useClinicPersona() {
  const { persona, ready } = usePersona();
  return {
    persona,
    enabled: ready && persona.kind !== "platform_admin" && Boolean(persona.clinicId),
    personaKey: [persona.kind, persona.clinicId, persona.memberId] as const,
  };
}

export function usePatientList(query: PatientListQuery) {
  const api = useApi();
  const { persona, enabled, personaKey } = useClinicPersona();
  return useQuery({
    queryKey: [...patientKeys.list(query), ...personaKey],
    queryFn: () => api.patients.list(persona, query),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function usePatientBranches() {
  const api = useApi();
  const { persona, enabled, personaKey } = useClinicPersona();
  return useQuery({
    queryKey: [...patientKeys.branches, ...personaKey],
    queryFn: () => api.patients.branchOptions(persona),
    enabled,
  });
}

/** Each fetch is an audited file open, so the detail is never refetched in the background. */
export function usePatientDetail(patientId: string) {
  const api = useApi();
  const { persona, enabled, personaKey } = useClinicPersona();
  return useQuery({
    queryKey: [...patientKeys.detail(patientId), ...personaKey],
    queryFn: () => api.patients.open(persona, patientId),
    enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** Refreshes lists and writes a mutation's result into the open file without re-opening it. */
export function useRefreshPatients() {
  const queryClient = useQueryClient();
  const { personaKey } = useClinicPersona();
  return useCallback(
    (detail?: PatientDetail) => {
      void queryClient.invalidateQueries({
        queryKey: [...patientKeys.all, "list"],
      });
      if (detail)
        queryClient.setQueryData([...patientKeys.detail(detail.id), ...personaKey], detail);
    },
    [queryClient, personaKey],
  );
}
