import type { PermissionAction, PermissionResource } from "@contracts/permissions";

/** True when the user holds the action on the resource in any scope. UI never checks role names. */
export function can(permissions: readonly string[], action: PermissionAction, resource: PermissionResource): boolean {
  return permissions.some((p) => p.startsWith(`${action}:${resource}:`));
}
