import { z } from "zod";
import { idSchema } from "./common";
import { systemRoleKeySchema } from "./organization";
import { PERMISSION_CATALOG, actionSchema } from "./permissions";

const roleName = z.string().trim().min(1, "validation.required").max(100, "validation.tooLong");

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

/** Each key must come from the fixed catalog; a scoped resource takes one scope per action. */
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
    for (const action of actionSchema.options) {
      const scopes = keys.filter((k) => k.startsWith(`${action}:patients:`));
      if (scopes.length > 1) {
        ctx.addIssue({ code: "custom", message: "validation.oneScope" });
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
