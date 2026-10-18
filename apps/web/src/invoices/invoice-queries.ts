import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InvoiceListQuery } from "@eyadex/contracts/finance";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

export const invoiceKeys = { all: ["clinic", "invoices"] as const };

const retry = (count: number, error: unknown) => !(error instanceof ApiError) && count < 2;

function useClinicPersona() {
  const { persona, ready } = usePersona();
  return {
    persona,
    enabled: ready && persona.kind !== "platform_admin" && Boolean(persona.clinicId),
  };
}

export function useInvoiceList(query: Partial<InvoiceListQuery>) {
  const api = useApi();
  const { persona, enabled } = useClinicPersona();
  return useQuery({
    queryKey: [...invoiceKeys.all, "list", query, persona.memberId],
    queryFn: () => api.finance.listInvoices(persona, query),
    enabled,
    retry,
    placeholderData: keepPreviousData,
  });
}

export function useInvoice(invoiceId: string) {
  const api = useApi();
  const { persona, enabled } = useClinicPersona();
  return useQuery({
    queryKey: [...invoiceKeys.all, "detail", invoiceId, persona.memberId],
    queryFn: () => api.finance.getInvoice(persona, invoiceId),
    enabled,
    retry,
  });
}

/** The live (issued) invoice of an appointment's or visit's encounter, or null. */
export function useSourceInvoice(source: "appointment" | "visit", sourceId: string, on = true) {
  const api = useApi();
  const { persona, enabled } = useClinicPersona();
  return useQuery({
    queryKey: [...invoiceKeys.all, "source", "encounter", source, sourceId, persona.memberId],
    queryFn: async () => {
      const page = await api.finance.listInvoices(persona, {
        source,
        sourceId,
        encounter: true,
        status: "issued",
        limit: 1,
      });
      return page.items[0] ?? null;
    },
    enabled: enabled && on,
    retry,
  });
}

export function useInvoiceDraft(source: "appointment" | "visit" | null, sourceId: string | null) {
  const api = useApi();
  const { persona, enabled } = useClinicPersona();
  return useQuery({
    queryKey: [...invoiceKeys.all, "draft", source, sourceId, persona.memberId],
    queryFn: () => api.finance.draft(persona, source!, sourceId!),
    enabled: enabled && source !== null && sourceId !== null,
    retry,
    staleTime: Infinity,
  });
}

export function useRefreshInvoices() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
}
