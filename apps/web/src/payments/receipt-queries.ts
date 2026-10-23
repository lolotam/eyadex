import { useQuery } from "@tanstack/react-query";
import type { PaymentListQuery, RefundListQuery } from "@eyadex/contracts/finance";
import type { BranchOption } from "@eyadex/contracts/users";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";
import { paymentKeys } from "./payment-queries";

const retry = (count: number, error: unknown) => !(error instanceof ApiError) && count < 2;

/** One cursor page of receipts; the shown page stays while the next one loads. */
export function useReceiptList(query: Partial<PaymentListQuery>) {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: [...paymentKeys.all, "list", query, persona.memberId],
    queryFn: () => api.payments.listPayments(persona, query),
    enabled: ready && Boolean(persona.clinicId),
    placeholderData: (previous) => previous,
    retry,
  });
}

export function useReceipt(paymentId: string) {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: [...paymentKeys.all, "receipt", paymentId, persona.memberId],
    queryFn: () => api.payments.getPayment(persona, paymentId),
    enabled: ready && Boolean(persona.clinicId),
    retry,
  });
}

/** Every branch the `view:payments` key reaches, all pages (lesson 5.3): names and the filter. */
export function useReceiptBranches() {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: [...paymentKeys.all, "branch-options", persona.memberId],
    queryFn: async () => {
      const items: BranchOption[] = [];
      let cursor: string | undefined;
      do {
        const page = await api.payments.branchOptions(persona, {
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return items;
    },
    enabled: ready && Boolean(persona.clinicId),
    retry,
  });
}

/** A branch's name from that list; a branch missing from it is «—». */
export function branchNameIn(
  branches: readonly BranchOption[] | undefined,
  branchId: string,
  pick: (ar: string, en: string) => string,
): string {
  const b = branches?.find((x) => x.id === branchId);
  return b ? pick(b.nameAr, b.nameEn) : "—";
}

/** One cursor page of refunds (read through `view:payments`); the shown page stays while the next loads. */
export function useRefundList(query: Partial<RefundListQuery>) {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: [...paymentKeys.all, "refunds", query, persona.memberId],
    queryFn: () => api.payments.listRefunds(persona, query),
    enabled: ready && Boolean(persona.clinicId),
    placeholderData: (previous) => previous,
    retry,
  });
}
