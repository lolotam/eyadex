import { z } from "zod";
import { idSchema, stripInvisibleControls } from "./common.ts";
import { systemRoleKeySchema } from "./organization.ts";
import {
  PERMISSION_CATALOG,
  VIEWED_THROUGH,
  actionSchema,
  resourceSchema,
  viewScopeCovers,
  type PermissionResource,
  type PermissionScope,
} from "./permissions.ts";

// Invisible format/control characters render as nothing; they could only split a number past the audit
// scrub or spoof a name, so they are dropped before the usual checks (as patient names, ADR-0018).
const roleName = z
  .string()
  .transform(stripInvisibleControls)
  .pipe(z.string().trim().min(1, "validation.required").max(100, "validation.tooLong"));

export const roleListItemSchema = z.object({
  id: idSchema,
  systemKey: systemRoleKeySchema.nullable(),
  nameAr: z.string(),
  nameEn: z.string(),
  isLocked: z.boolean(),
  isActive: z.boolean(),
  /** Members holding the role, in any status. */
  memberCount: z.number().int().nonnegative(),
  permissionKeys: z.array(z.string()),
});
export type RoleListItem = z.infer<typeof roleListItemSchema>;

const CATALOG_KEYS = new Set(PERMISSION_CATALOG.map((p) => p.key));

/** Each key must come from the fixed catalog; a role holds one scope per action on every resource. */
export const permissionKeysSchema = z
  .array(z.string())
  .max(PERMISSION_CATALOG.length)
  .superRefine((keys, ctx) => {
    for (const key of keys) {
      if (!CATALOG_KEYS.has(key)) {
        ctx.addIssue({ code: "custom", message: "validation.unknownPermission" });
        return;
      }
    }
    for (const resource of resourceSchema.options) {
      for (const action of actionSchema.options) {
        const scopes = keys.filter((k) => k.startsWith(`${action}:${resource}:`));
        if (scopes.length > 1) {
          ctx.addIssue({ code: "custom", message: "validation.oneScope" });
          return;
        }
      }
    }
    if (uncoveredWrite(keys) !== undefined) {
      ctx.addIssue({ code: "custom", message: "validation.needsView" });
    }
  })
  .transform((keys) => [...new Set(keys)]);

/**
 * The first write key with no view that reaches it, if any. Any write on a resource needs view on it too, so
 * every granted action is reachable; a resource with no view of its own (a discount is a change to an
 * invoice) needs view on the resource it changes. The view must reach as far as the write (issue #93): a
 * branch view with a clinic write would let the role change records in branches it cannot see. Exported so
 * a save can check the stored keys of a switched-off module too, which the request never carries.
 */
export function uncoveredWrite(keys: readonly string[]): string | undefined {
  return keys.find((key) => {
    const [action, resource, scope] = key.split(":") as [
      string,
      PermissionResource,
      PermissionScope,
    ];
    if (action === "view") return false;
    const viewed = VIEWED_THROUGH[resource] ?? resource;
    return !keys.some((k) => {
      const [a, r, s] = k.split(":") as [string, string, PermissionScope];
      return a === "view" && r === viewed && viewScopeCovers(s, scope);
    });
  });
}

export const roleInputSchema = z.object({
  nameAr: roleName,
  nameEn: roleName,
  permissionKeys: permissionKeysSchema,
});
export type RoleInput = z.input<typeof roleInputSchema>;
