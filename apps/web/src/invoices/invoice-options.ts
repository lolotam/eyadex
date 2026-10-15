import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

const retry = (count: number, error: unknown) => !(error instanceof ApiError) && count < 2;

/** The option lists the invoice form and filters pick from: services, doctors, branches, patients. */
export function useInvoiceOptions() {
  const api = useApi();
  const { persona, ready } = usePersona();
  const enabled = ready && Boolean(persona.clinicId);
  const services = useQuery({
    queryKey: ["clinic", "invoice-options", "services", persona.memberId],
    queryFn: () =>
      api.scheduling.listServices(persona, { cursor: null, limit: 100, status: "active" }),
    enabled,
    retry,
  });
  const providers = useQuery({
    queryKey: ["clinic", "invoice-options", "providers", persona.memberId],
    queryFn: () => api.scheduling.listProviders(persona),
    enabled,
    retry,
  });
  const branches = useQuery({
    queryKey: ["clinic", "invoice-options", "branches", persona.memberId],
    queryFn: () => api.patients.branchOptions(persona, "view"),
    enabled,
    retry,
  });
  return {
    services: services.data?.items ?? [],
    providers: providers.data ?? [],
    branches: branches.data ?? [],
  };
}

/** Patients matching the search text (sent as the patients list query, as the patients page does). */
export function usePatientSearch(q: string) {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: ["clinic", "invoice-options", "patients", q, persona.memberId],
    queryFn: () =>
      api.patients.list(persona, { cursor: null, limit: 10, q, branchId: null, status: "active" }),
    enabled: ready && Boolean(persona.clinicId) && q.trim().length >= 2,
    retry,
  });
}
