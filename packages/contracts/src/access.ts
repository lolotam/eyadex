import { z } from "zod";
import { idSchema, languageSchema } from "./common.ts";
import { clinicStatusSchema, moduleSchema } from "./clinics.ts";
import { systemRoleKeySchema } from "./organization.ts";
import { actionSchema, resourceSchema, scopeSchema } from "./permissions.ts";

/**
 * `GET /v1/me` (Phase B slice 4, ADR-0009): the signed-in clinic user's context. The web hides menus
 * and buttons from `permissions`; the API enforces the same keys on every route.
 */
export const meResponseSchema = z.object({
  user: z.object({
    id: idSchema,
    fullName: z.string(),
    email: z.string(),
    preferredLanguage: languageSchema,
  }),
  clinic: z.object({
    id: idSchema,
    nameAr: z.string(),
    nameEn: z.string(),
    timezone: z.string(),
    status: clinicStatusSchema,
    expiresAt: z.string().datetime(),
  }),
  role: z.object({ id: idSchema, nameAr: z.string(), nameEn: z.string() }),
  permissions: z.array(z.string()),
  /** true = every branch of the clinic; otherwise `branchIds` lists the allowed, active branches. */
  allBranches: z.boolean(),
  branchIds: z.array(idSchema),
  /** Modules enabled for the clinic (PRD §4.8); `permissions` already excludes the locked ones. */
  modules: z.array(moduleSchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

const catalogueEntrySchema = z.object({
  key: z.string(),
  action: actionSchema,
  resource: resourceSchema,
  scope: scopeSchema,
});

/** `GET /v1/permissions/catalogue`: the fixed catalogue grouped by module (null = core). */
export const permissionCatalogueResponseSchema = z.object({
  modules: z.array(
    z.object({
      module: moduleSchema.nullable(),
      permissions: z.array(catalogueEntrySchema),
    }),
  ),
});
export type PermissionCatalogueResponse = z.infer<typeof permissionCatalogueResponseSchema>;

export const roleSummarySchema = z.object({
  id: idSchema,
  systemKey: systemRoleKeySchema.nullable(),
  nameAr: z.string(),
  nameEn: z.string(),
  isLocked: z.boolean(),
  isActive: z.boolean(),
  /** Active members holding the role (PRD story 50). */
  activeUserCount: z.number().int().nonnegative(),
  memberCount: z.number().int().nonnegative(), // memberships in any status (slice 8: role_in_use)
  permissionKeys: z.array(z.string()),
});
export type RoleSummary = z.infer<typeof roleSummarySchema>;

/** Query string of `GET /v1/roles`; the cursor is opaque to the client. */
export const roleListQuerySchema = z
  .object({
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type RoleListQuery = z.infer<typeof roleListQuerySchema>;

export const roleListResponseSchema = z.object({
  items: z.array(roleSummarySchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});
export type RoleListResponse = z.infer<typeof roleListResponseSchema>;
