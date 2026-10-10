import type {
  PermissionAction,
  PermissionResource,
  PermissionScope,
} from "@eyadex/contracts/permissions";

/**
 * True when the user holds the action on the resource in any scope, or only in the listed `scopes` when
 * given (a page an `own` key cannot load). UI never checks role names.
 */
export function can(
  permissions: readonly string[],
  action: PermissionAction,
  resource: PermissionResource,
  scopes?: readonly PermissionScope[],
): boolean {
  if (scopes) return scopes.some((scope) => permissions.includes(`${action}:${resource}:${scope}`));
  return permissions.some((p) => p.startsWith(`${action}:${resource}:`));
}
