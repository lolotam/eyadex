import {
  VIEWED_THROUGH,
  viewScopeCovers,
  type PermissionDefinition,
  type PermissionResource,
  type PermissionScope,
} from "@eyadex/contracts/permissions";
import { viewScope } from "./view-scope";

const partsOf = (key: string) => key.split(":") as [string, string, PermissionScope];

/** The resources whose writes are reached through `resource`'s view: itself and its viewed-through ones. */
function readThrough(resource: string): string[] {
  const dependents = Object.entries(VIEWED_THROUGH)
    .filter(([, via]) => via === resource)
    .map(([r]) => r);
  return [resource, ...dependents];
}

/** One matrix cell set to a scope, or cleared with `null`. */
export type MatrixCell = { resource: PermissionResource; action: string; scope: string | null };

/**
 * The role's keys after one matrix cell changes, keeping the contract's write-needs-view rule (issue #93):
 * a write needs a view on its resource (or the one it is viewed through) that reaches as far as the write.
 * Granting a write adds that view, or widens a narrower one; narrowing or dropping a view drops the writes
 * it no longer covers, so the admin picks them again on purpose rather than the editor changing them.
 */
export function withScope(
  catalog: readonly PermissionDefinition[],
  keys: readonly string[],
  cell: MatrixCell,
): string[] {
  const { resource, action, scope } = cell;
  const prefix = `${action}:${resource}:`;
  const next = keys.filter((k) => !k.startsWith(prefix));
  if (scope) next.push(`${prefix}${scope}`);
  if (action === "view") {
    const reached = readThrough(resource);
    return next.filter((k) => {
      const [a, r, s] = partsOf(k);
      if (a === "view" || !reached.includes(r)) return true;
      return scope !== null && viewScopeCovers(scope as PermissionScope, s);
    });
  }
  if (!scope) return next;
  const viewedVia = VIEWED_THROUGH[resource] ?? resource;
  const viewPrefix = `view:${viewedVia}:`;
  const view = next.find((k) => k.startsWith(viewPrefix));
  if (view && viewScopeCovers(partsOf(view)[2], scope as PermissionScope)) return next;
  return [
    ...next.filter((k) => k !== view),
    `${viewPrefix}${viewScope(catalog, viewedVia, scope)}`,
  ];
}
