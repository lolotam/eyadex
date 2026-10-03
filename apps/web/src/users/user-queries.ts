import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InvitationListQuery } from "@eyadex/contracts/invitations";
import type { UserListQuery } from "@eyadex/contracts/users";
import { ApiError } from "@/shared/api/api-error";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

export const userKeys = {
  all: ["clinic", "users"] as const,
};

/** Typed API errors are final answers; only unknown failures are retried. */
const retry = (count: number, error: unknown) => !(error instanceof ApiError) && count < 2;

function usePersonaKey() {
  const { persona, ready } = usePersona();
  return {
    persona,
    enabled: ready && persona.kind !== "platform_admin" && Boolean(persona.clinicId),
    key: [persona.kind, persona.clinicId, persona.memberId] as const,
  };
}

export function useUserList(query: UserListQuery) {
  const api = useApi();
  const { persona, enabled, key } = usePersonaKey();
  return useQuery({
    queryKey: [...userKeys.all, "list", query, ...key],
    queryFn: () => api.users.list(persona, query),
    enabled,
    retry,
    placeholderData: keepPreviousData,
  });
}

export function useInvitationList(query: InvitationListQuery) {
  const api = useApi();
  const { persona, enabled, key } = usePersonaKey();
  return useQuery({
    queryKey: [...userKeys.all, "invitations", query, ...key],
    queryFn: () => api.invitations.list(persona, query),
    enabled,
    retry,
    placeholderData: keepPreviousData,
  });
}

export function useUserUsage() {
  const api = useApi();
  const { persona, enabled, key } = usePersonaKey();
  return useQuery({
    queryKey: [...userKeys.all, "usage", ...key],
    queryFn: () => api.users.usage(persona),
    enabled,
    retry,
  });
}

export function useRoleOptions() {
  const api = useApi();
  const { persona, enabled, key } = usePersonaKey();
  return useQuery({
    queryKey: [...userKeys.all, "roles", ...key],
    queryFn: () => api.users.listRoleOptions(persona),
    enabled,
    retry,
  });
}

export function useBranchOptions() {
  const api = useApi();
  const { persona, enabled, key } = usePersonaKey();
  return useQuery({
    queryKey: [...userKeys.all, "branches", ...key],
    queryFn: () => api.users.listBranchOptions(persona),
    enabled,
    retry,
  });
}

/** Refreshes every users/invitations view plus the platform's usage counters. */
export function useRefreshUsers() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: userKeys.all });
    void queryClient.invalidateQueries({ queryKey: ["platform", "clinics"] });
    void queryClient.invalidateQueries({ queryKey: ["login-accounts"] });
    // The signed-in admin may have changed their own role or branches: refresh permissions now.
    void queryClient.invalidateQueries({ queryKey: ["session"] });
  };
}
