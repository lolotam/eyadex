import { useQuery } from "@tanstack/react-query";
import type { CashClosingListQuery } from "@eyadex/contracts/finance";
import type { BranchOption } from "@eyadex/contracts/users";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

export const closingKeys = { all: ["cash-closings"] as const };

const retry = (count: number, error: unknown) => !(error instanceof ApiError) && count < 2;

/** One cursor page of closings; the shown page stays while the next one loads. */
export function useClosingList(query: Partial<CashClosingListQuery>) {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: [...closingKeys.all, "list", query, persona.memberId],
    queryFn: () => api.cashClosings.list(persona, query),
    enabled: ready && Boolean(persona.clinicId),
    placeholderData: (previous) => previous,
    retry,
  });
}

export function useClosing(closingId: string) {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: [...closingKeys.all, "detail", closingId, persona.memberId],
    queryFn: () => api.cashClosings.get(persona, closingId),
    enabled: ready && Boolean(persona.clinicId),
    retry,
  });
}

/** The drawer's preview; never cached as fresh, since any cash movement changes it. */
export function useClosingPreview(branchId: string | null) {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: [...closingKeys.all, "preview", branchId, persona.memberId],
    queryFn: () => api.cashClosings.preview(persona, branchId!),
    enabled: ready && Boolean(persona.clinicId) && branchId !== null,
    staleTime: 0,
    retry,
  });
}

/**
 * The payments branch options, all pages (owner decision): the history's names and filter and, through
 * closableBranches, the close dialog's picker. Without `view:payments` it is not asked (it would refuse).
 */
export function useClosingBranches(enabled: boolean) {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: [...closingKeys.all, "branch-options", persona.memberId],
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
    enabled: enabled && ready && Boolean(persona.clinicId),
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
