import {
  permissionCatalogueResponseSchema,
  roleListResponseSchema,
  type PermissionCatalogueResponse,
  type RoleSummary,
} from "@eyadex/contracts/access";
import type { PermissionDefinition } from "@eyadex/contracts/permissions";
import type { RoleListItem } from "@eyadex/contracts/roles";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import type { HttpContext } from "./http-context";
import { collectPages } from "./http-transport";

const notImplemented = () => Promise.reject(new ApiError("not_implemented"));

/** The API counts active holders; the web column has no other count to show. */
export function toRoleListItem(role: RoleSummary): RoleListItem {
  return {
    id: role.id,
    systemKey: role.systemKey,
    nameAr: role.nameAr,
    nameEn: role.nameEn,
    isLocked: role.isLocked,
    isActive: role.isActive,
    memberCount: role.activeUserCount,
    permissionKeys: [...role.permissionKeys],
  };
}

/** Grouped by module on the API; the editor wants one flat list that carries the module. */
export function toCatalog(answer: PermissionCatalogueResponse): PermissionDefinition[] {
  return answer.modules.flatMap((group) =>
    group.permissions.map((p) => ({ ...p, module: group.module })),
  );
}

export function createHttpRoles(ctx: HttpContext): ApiClient["roles"] {
  const { transport } = ctx;
  return {
    async list() {
      const roles = await collectPages((cursor) =>
        transport.send("GET", "/v1/roles", {
          schema: roleListResponseSchema,
          query: { cursor, limit: 100 },
        }),
      );
      return roles.map(toRoleListItem);
    },
    catalog: async () =>
      toCatalog(
        await transport.send("GET", "/v1/permissions/catalogue", {
          schema: permissionCatalogueResponseSchema,
        }),
      ),
    // Slice 8 (custom roles) brings the write routes.
    create: notImplemented,
    update: notImplemented,
    deactivate: notImplemented,
    reactivate: notImplemented,
  };
}
