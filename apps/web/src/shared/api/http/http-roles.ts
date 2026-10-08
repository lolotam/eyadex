import {
  permissionCatalogueResponseSchema,
  roleListResponseSchema,
  roleSummarySchema,
  type PermissionCatalogueResponse,
  type RoleSummary,
} from "@eyadex/contracts/access";
import type { PermissionDefinition } from "@eyadex/contracts/permissions";
import type { CreateRoleRequest } from "@eyadex/contracts/role-admin";
import type { RoleInput, RoleListItem } from "@eyadex/contracts/roles";
import type { ApiClient } from "../api-client";
import type { HttpContext } from "./http-context";
import { collectPages } from "./http-transport";

/** The web column counts holders in any status, like the API's deactivation rule (`role_in_use`). */
export function toRoleListItem(role: RoleSummary): RoleListItem {
  return {
    id: role.id,
    systemKey: role.systemKey,
    nameAr: role.nameAr,
    nameEn: role.nameEn,
    isLocked: role.isLocked,
    isActive: role.isActive,
    memberCount: role.memberCount,
    permissionKeys: [...role.permissionKeys],
  };
}

/** Grouped by module on the API; the editor wants one flat list that carries the module. */
export function toCatalog(answer: PermissionCatalogueResponse): PermissionDefinition[] {
  return answer.modules.flatMap((group) =>
    group.permissions.map((p) => ({ ...p, module: group.module })),
  );
}

/** Create and update send the whole editable role (ADR-0017). */
function toRoleBody(input: RoleInput): CreateRoleRequest {
  return { nameAr: input.nameAr, nameEn: input.nameEn, permissionKeys: [...input.permissionKeys] };
}

const path = (id: string) => `/v1/roles/${encodeURIComponent(id)}`;

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
    async create(_persona, input, idempotencyKey) {
      const role = await transport.send("POST", "/v1/roles", {
        schema: roleSummarySchema,
        body: toRoleBody(input),
        idempotencyKey,
      });
      return toRoleListItem(role);
    },
    async update(_persona, roleId, input) {
      const role = await transport.send("PATCH", path(roleId), {
        schema: roleSummarySchema,
        body: toRoleBody(input),
      });
      return toRoleListItem(role);
    },
    async deactivate(_persona, roleId) {
      return toRoleListItem(
        await transport.send("POST", `${path(roleId)}/deactivate`, { schema: roleSummarySchema }),
      );
    },
    async reactivate(_persona, roleId) {
      return toRoleListItem(
        await transport.send("POST", `${path(roleId)}/reactivate`, { schema: roleSummarySchema }),
      );
    },
  };
}
