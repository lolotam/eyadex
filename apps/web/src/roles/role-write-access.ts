import { can } from "@/shared/permissions/can";

export type RoleWriteAccess = { mayCreate: boolean; mayUpdate: boolean; mayDeactivate: boolean };

/** Role writes are served by the mock and, from slice 8 on, by the API: only permissions decide. */
export function roleWriteAccess(permissions: readonly string[]): RoleWriteAccess {
  return {
    mayCreate: can(permissions, "create", "roles"),
    mayUpdate: can(permissions, "update", "roles"),
    mayDeactivate: can(permissions, "deactivate", "roles"),
  };
}
