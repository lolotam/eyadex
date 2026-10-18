import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { canAtBranch } from "@/shared/permissions/can-at-branch";
import { usePersona, useSession } from "@/shared/persona/persona-provider";

const retry = (count: number, error: unknown) => !(error instanceof ApiError) && count < 2;

/**
 * The option lists the invoice form and filters pick from: services, doctors, branches, patients. The
 * form's branches are the ones the caller's `create:invoices` reaches, as the API judges an issue; the
 * list filter keeps every branch whose patients the caller sees.
 */
export function useInvoiceOptions() {
  const api = useApi();
  const { persona, ready } = usePersona();
  const { session } = useSession();
  const enabled = ready && Boolean(persona.clinicId);
  const services = useQuery({
    queryKey: ["clinic", "invoice-options", "services", persona.memberId],
    // Lesson 5.3: every page (100 at most each), never only the first.
    queryFn: async () => {
      const items = [];
      let cursor: string | null = null;
      do {
        const page = await api.scheduling.listServices(persona, {
          cursor,
          limit: 100,
          status: "active",
        });
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      return { items };
    },
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
  const all = branches.data ?? [];
  return {
    services: services.data?.items ?? [],
    providers: providers.data ?? [],
    branches: all,
    createBranches: session
      ? all.filter((b) => canAtBranch(session, "create", "invoices", b.id))
      : [],
  };
}

/** Patients matching the search text (sent as the patients list query, as the patients page does). */
export function usePatientSearch(q: string, raw = q) {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: ["clinic", "invoice-options", "patients", q, persona.memberId],
    queryFn: () =>
      api.patients.list(persona, { cursor: null, limit: 10, q, branchId: null, status: "active" }),
    enabled: ready && Boolean(persona.clinicId) && q.trim().length >= 2,
    placeholderData: (previous) =>
      raw.trim().length >= 2 && raw.trim() === q.trim() ? previous : undefined,
    retry,
  });
}
