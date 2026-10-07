import type { ApiMode } from "@/shared/api/api-mode";
import { can } from "@/shared/permissions/can";

export type RoleWriteAccess = { mayCreate: boolean; mayUpdate: boolean; mayDeactivate: boolean };

/**
 * The API serves role writes from slice 8 on. Until then the HTTP mode shows roles read-only, so a
 * permitted admin never fills a dialog whose save can only answer not_implemented.
 */
export function roleWriteAccess(permissions: readonly string[], mode: ApiMode): RoleWriteAccess {
  const served = mode === "mock";
  return {
    mayCreate: served && can(permissions, "create", "roles"),
    mayUpdate: served && can(permissions, "update", "roles"),
    mayDeactivate: served && can(permissions, "deactivate", "roles"),
  };
}
