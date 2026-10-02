import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ClinicListQuery } from "@contracts/clinics";
import { useApi } from "@/shared/api/api-provider";

export const clinicKeys = {
  all: ["platform", "clinics"] as const,
  list: (q: ClinicListQuery) => ["platform", "clinics", "list", q] as const,
  detail: (id: string) => ["platform", "clinics", "detail", id] as const,
  members: (id: string) => ["platform", "clinics", "members", id] as const,
  branches: (id: string) => ["platform", "clinics", "branches", id] as const,
};

export function useClinicList(query: ClinicListQuery) {
  const api = useApi();
  return useQuery({ queryKey: clinicKeys.list(query), queryFn: () => api.platform.listClinics(query), placeholderData: keepPreviousData });
}

export function useClinic(id: string) {
  const api = useApi();
  return useQuery({ queryKey: clinicKeys.detail(id), queryFn: () => api.platform.getClinic(id) });
}

export function useClinicMembers(id: string) {
  const api = useApi();
  return useQuery({ queryKey: clinicKeys.members(id), queryFn: () => api.platform.listClinicMembers(id) });
}

export function useClinicBranches(id: string) {
  const api = useApi();
  return useQuery({ queryKey: clinicKeys.branches(id), queryFn: () => api.platform.listClinicBranches(id) });
}
