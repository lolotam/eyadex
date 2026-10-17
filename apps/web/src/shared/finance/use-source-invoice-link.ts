import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { can } from "@/shared/permissions/can";
import { canAtBranch } from "@/shared/permissions/can-at-branch";
import { usePersona, useSession } from "@/shared/persona/persona-provider";

export type SourceInvoiceLink =
  | { kind: "view"; invoiceId: string }
  | { kind: "create"; source: "appointment" | "visit"; id: string }
  | null;

/**
 * F1 §3: what the «فاتورة» control of an appointment or visit offers — the live invoice when one
 * exists, else a new one (needs `create:invoices` reaching the source's branch, as the API's draft
 * judges it), else nothing. Hidden while finance is off.
 */
export function useSourceInvoiceLink(
  source: { kind: "appointment" | "visit"; id: string; branchId: string },
  active = true,
): SourceInvoiceLink {
  const { session } = useSession();
  const keys = session?.permissions ?? [];
  const on = active && session?.features.finance === true && can(keys, "view", "invoices");
  const api = useApi();
  const { persona, ready } = usePersona();
  // Under the invoices key, so issuing or voiding an invoice refreshes this lookup too.
  const existing = useQuery({
    queryKey: ["clinic", "invoices", "source", source.kind, source.id, persona.memberId],
    queryFn: async () => {
      const page = await api.finance.listInvoices(persona, {
        source: source.kind,
        sourceId: source.id,
        status: "issued",
        limit: 1,
      });
      return page.items[0] ?? null;
    },
    enabled: on && ready && Boolean(persona.clinicId),
    retry: (count, error) => !(error instanceof ApiError) && count < 2,
  });
  if (!on || existing.isLoading || existing.isError) return null;
  if (existing.data) return { kind: "view", invoiceId: existing.data.id };
  return session && canAtBranch(session, "create", "invoices", source.branchId)
    ? { kind: "create", source: source.kind, id: source.id }
    : null;
}
