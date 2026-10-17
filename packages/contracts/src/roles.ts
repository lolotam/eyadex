import { z } from "zod";
import { idSchema, stripInvisibleControls } from "./common.ts";
import { systemRoleKeySchema } from "./organization.ts";
import {
  PERMISSION_CATALOG,
  VIEWED_THROUGH,
  actionSchema,
  resourceSchema,
  type PermissionResource,
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
    // Any write on a resource needs view on it too, so every granted action is reachable. A resource with no
    // view of its own (a discount is a change to an invoice) needs view on the resource it changes.
    for (const key of keys) {
      const [action, resource] = key.split(":") as [string, PermissionResource];
      const viewed = VIEWED_THROUGH[resource] ?? resource;
      if (action !== "view" && !keys.some((k) => k.startsWith(`view:${viewed}:`))) {
        ctx.addIssue({ code: "custom", message: "validation.needsView" });
        return;
      }
    }
  })
  .transform((keys) => [...new Set(keys)]);

export const roleInputSchema = z.object({
  nameAr: roleName,
  nameEn: roleName,
  permissionKeys: permissionKeysSchema,
});
export type RoleInput = z.input<typeof roleInputSchema>;
