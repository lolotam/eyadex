import type { PermissionAction, PermissionResource } from "@eyadex/contracts/permissions";
import type { SessionContext } from "@eyadex/contracts/session";

type BranchAccess = Pick<SessionContext, "permissions" | "allBranches" | "branchIds">;

/**
 * True when the user holds the action on the resource at this branch: its clinic key reaches every
 * branch, its branch key only the user's own active branches (as the API's branch scope); an own key
 * reaches no branch. Hiding a control is UX only: the API refuses too.
 */
export function canAtBranch(
  access: BranchAccess,
  action: PermissionAction,
  resource: PermissionResource,
  branchId: string,
): boolean {
  const { permissions, allBranches, branchIds } = access;
  if (permissions.includes(`${action}:${resource}:clinic`)) return true;
  if (!permissions.includes(`${action}:${resource}:branch`)) return false;
  return allBranches || branchIds.includes(branchId);
}
