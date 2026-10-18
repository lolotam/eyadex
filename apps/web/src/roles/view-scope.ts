import type { PermissionDefinition } from "@eyadex/contracts/permissions";

// Widest first: a write granted alone must never get a narrower view than the catalog offers.
const WIDEST_FIRST = ["clinic", "branch", "own"] as const;

/** The view scope to grant with a write: the same scope when the view offers it, else its widest. */
export function viewScope(
  catalog: readonly PermissionDefinition[],
  resource: string,
  scope: string,
): string {
  const scopes: string[] = catalog
    .filter((d) => d.resource === resource && d.action === "view")
    .map((d) => d.scope);
  if (scopes.includes(scope)) return scope;
  return WIDEST_FIRST.find((s) => scopes.includes(s)) ?? scopes[0] ?? scope;
}
