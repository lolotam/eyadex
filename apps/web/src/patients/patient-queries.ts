import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type {
  PatientBranchAction,
  PatientListQuery,
  PatientWriteResult,
} from "@eyadex/contracts/patients";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

export const patientKeys = {
  all: ["clinic", "patients"] as const,
  list: (query: PatientListQuery) => ["clinic", "patients", "list", query] as const,
  branches: (action: PatientBranchAction) => ["clinic", "patients", "branches", action] as const,
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
    // Rows reflect the caller's branch scope at fetch time; never show an old scope's rows.
    gcTime: 0,
    placeholderData: keepPreviousData,
  });
}

/** Branches within the scope of one action: view for filters, create or update for the form. */
export function usePatientBranches(action: PatientBranchAction, active = true) {
  const api = useApi();
  const { persona, enabled, personaKey } = useClinicPersona();
  return useQuery({
    queryKey: [...patientKeys.branches(action), ...personaKey],
    queryFn: () => api.patients.branchOptions(persona, action),
    // Only fetched while the screen that needs it is open (a closed form asks for nothing).
    enabled: enabled && active,
    retry: false,
    gcTime: 0,
  });
}

/**
 * Each fetch is an audited file open: every route entry opens the file again (so each open is
 * recorded), and nothing refetches it in the background.
 */
export function usePatientDetail(patientId: string) {
  const api = useApi();
  const { persona, enabled, personaKey } = useClinicPersona();
  return useQuery({
    queryKey: [...patientKeys.detail(patientId), ...personaKey],
    queryFn: () => api.patients.open(persona, patientId),
    enabled,
    staleTime: Infinity,
    // Nothing stays cached after leaving the file, so revoked access can never show an old copy.
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}

/** Refreshes lists and writes a mutation's result into the open file without re-opening it. */
export function useRefreshPatients() {
  const queryClient = useQueryClient();
  const { personaKey } = useClinicPersona();
  return useCallback(
    (result: PatientWriteResult) => {
      void queryClient.invalidateQueries({
        queryKey: [...patientKeys.all, "list"],
      });
      const key = [...patientKeys.detail(result.id), ...personaKey];
      // Only a file that is open on screen right now is updated in place. Anything else is
      // dropped, so a write never seeds a cache entry that could outlive the caller's access.
      const open = queryClient.getQueryCache().find({ queryKey: key, exact: true });
      if (result.detail && open && open.getObserversCount() > 0)
        queryClient.setQueryData(key, result.detail);
      else if (open && open.getObserversCount() > 0)
        void queryClient.resetQueries({ queryKey: key });
      else queryClient.removeQueries({ queryKey: key, exact: true });
    },
    [queryClient, personaKey],
  );
}
