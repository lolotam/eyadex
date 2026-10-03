import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/shared/api/api-provider";
import { usePersona } from "@/shared/persona/persona-provider";

export const roleKeys = {
  all: ["clinic", "roles"] as const,
};

function useClinicPersona() {
  const { persona, ready } = usePersona();
  return {
    persona,
    enabled: ready && persona.kind !== "platform_admin" && Boolean(persona.clinicId),
  };
}

export function useRoleList() {
  const api = useApi();
  const { persona, enabled } = useClinicPersona();
  return useQuery({
    queryKey: [...roleKeys.all, "list", persona.kind, persona.clinicId, persona.memberId],
    queryFn: () => api.roles.list(persona),
    enabled,
  });
}

export function usePermissionCatalog() {
  const api = useApi();
  const { persona, enabled } = useClinicPersona();
  return useQuery({
    queryKey: [...roleKeys.all, "catalog", persona.kind, persona.clinicId, persona.memberId],
    queryFn: () => api.roles.catalog(persona),
    enabled,
  });
}

/** A role edit changes holders' permissions at once, so the session and user lists refresh too. */
export function useRefreshRoles() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: roleKeys.all });
    void queryClient.invalidateQueries({ queryKey: ["clinic", "users"] });
    void queryClient.invalidateQueries({ queryKey: ["session"] });
  };
}
