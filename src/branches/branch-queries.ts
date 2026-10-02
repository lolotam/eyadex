import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { BranchListQuery } from "@contracts/organization";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

export const branchKeys = {
  all: ["clinic", "branches"] as const,
  list: (query: BranchListQuery) => ["clinic", "branches", "list", query] as const,
};

export function useBranchList(query: BranchListQuery) {
  const api = useApi();
  const { persona, ready } = usePersona();
  return useQuery({
    queryKey: [...branchKeys.list(query), persona.kind, persona.clinicId],
    queryFn: () => api.branches.list(persona, query),
    enabled: ready && persona.kind !== "platform_admin" && Boolean(persona.clinicId),
    placeholderData: keepPreviousData,
  });
}
