import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

export const paymentKeys = { all: ["clinic", "payments"] as const };

const retry = (count: number, error: unknown) => !(error instanceof ApiError) && count < 2;

/**
 * The invoice's movements and the patient's credit. `allowed` is `view:payments` at the invoice's branch:
 * without it the route is never asked (the API would answer forbidden). The invoice version is in the key:
 * an edit or void that releases credit bumps it, so the movements and credit refetch on their own.
 */
export function useInvoicePayments(invoiceId: string, version: number, allowed: boolean) {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: [...paymentKeys.all, "invoice", invoiceId, version, persona.memberId],
    queryFn: () => api.payments.invoicePayments(persona, invoiceId),
    enabled: ready && Boolean(persona.clinicId) && allowed,
    retry,
  });
}

export function useRefreshPayments() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: paymentKeys.all });
}
