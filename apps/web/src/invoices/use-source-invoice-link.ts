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

type Source = { kind: "appointment" | "visit"; id: string; branchId: string };

/**
 * F1 §3: what the «فاتورة» control offers. One invoice covers an encounter (an appointment and its
 * visits), looked up together by the API. A caller with a view key gets the live invoice
 * the list lets them see; a caller with only a create key never looks and gets the new-invoice flow
 * when that key reaches the record's branch (the draft refuses an already billed encounter).
 */
export function useSourceInvoiceLink(
  source: Source & { appointmentId?: string | null },
  active = true,
): SourceInvoiceLink {
  const { session } = useSession();
  const keys = session?.permissions ?? [];
  const finance = active && session?.features.finance === true;
  const viewer = finance && can(keys, "view", "invoices");
  const api = useApi();
  const { persona, ready } = usePersona();
  // Under the invoices key, so issuing or voiding an invoice refreshes this lookup too.
  const existing = useQuery({
    queryKey: [
      "clinic",
      "invoices",
      "source",
      source.kind,
      source.id,
      "encounter",
      persona.memberId,
    ],
    queryFn: async () => {
      const page = await api.finance.listInvoices(persona, {
        source: source.kind,
        sourceId: source.id,
        encounter: true,
        status: "issued",
        limit: 1,
      });
      return page.items[0] ?? null;
    },
    enabled: viewer && ready && Boolean(persona.clinicId),
    retry: (count, error) => !(error instanceof ApiError) && count < 2,
  });
  if (!finance || !session) return null;
  if (viewer) {
    if (existing.isLoading || existing.isError) return null;
    if (existing.data) return { kind: "view", invoiceId: existing.data.id };
  }
  return canAtBranch(session, "create", "invoices", source.branchId)
    ? { kind: "create", source: source.kind, id: source.id }
    : null;
}
