import { roleListResponseSchema, type RoleSummary } from "@eyadex/contracts/access";
import { branchListResponseSchema, type BranchDetail } from "@eyadex/contracts/branches";
import { userListResponseSchema, type UserListHttpQuery } from "@eyadex/contracts/user-admin";
import {
  membershipUserViewSchema,
  type BranchOption,
  type MembershipUserView,
  type RoleOption,
  type UserListQuery,
} from "@eyadex/contracts/users";
import type { ApiClient } from "../api-client";
import type { HttpContext } from "./http-context";
import { collectPages } from "./http-transport";

/** The API answers the web shape already (shared schema); the copy keeps screens off API objects. */
export function toUserView(user: MembershipUserView): MembershipUserView {
  return { ...user, branchIds: [...user.branchIds] };
}

export function toRoleOption(role: RoleSummary): RoleOption {
  return { id: role.id, nameAr: role.nameAr, nameEn: role.nameEn, isActive: role.isActive };
}

export function toBranchOption(branch: BranchDetail): BranchOption {
  return { id: branch.id, nameAr: branch.nameAr, nameEn: branch.nameEn, isActive: branch.isActive };
}

function userQuery(
  query: UserListQuery,
): Partial<Record<keyof UserListHttpQuery, string | number | null>> {
  return {
    cursor: query.cursor,
    limit: query.limit,
    search: query.search.trim(),
    roleId: query.roleId,
    branchId: query.branchId,
    status: query.status,
  };
}

const path = (id: string) => `/v1/users/${encodeURIComponent(id)}`;
const LIMIT = 100;

export function createHttpUsers(ctx: HttpContext): ApiClient["users"] {
  const { transport } = ctx;
  return {
    async list(_persona, query) {
      const page = await transport.send("GET", "/v1/users", {
        schema: userListResponseSchema,
        query: userQuery(query),
      });
      return { items: page.items.map(toUserView), nextCursor: page.nextCursor, total: page.total };
    },
    // TODO(spec): a clinic-side limits read; until then the counter hides and the API's 409 decides.
    usage: () => Promise.resolve(null),
    async listRoleOptions() {
      const roles = await collectPages((cursor) =>
        transport.send("GET", "/v1/roles", {
          schema: roleListResponseSchema,
          query: { cursor, limit: LIMIT },
        }),
      );
      return roles.map(toRoleOption);
    },
    async listBranchOptions() {
      const branches = await collectPages((cursor) =>
        transport.send("GET", "/v1/branches", {
          schema: branchListResponseSchema,
          query: { cursor, limit: LIMIT, status: "active" },
        }),
      );
      return branches.map(toBranchOption);
    },
    async changeRole(_persona, memberId, input) {
      const user = await transport.send("PATCH", `${path(memberId)}/role`, {
        schema: membershipUserViewSchema,
        body: { roleId: input.roleId },
      });
      return toUserView(user);
    },
    async changeBranches(_persona, memberId, input) {
      const user = await transport.send("PATCH", `${path(memberId)}/branches`, {
        schema: membershipUserViewSchema,
        body: { allBranches: input.allBranches, branchIds: input.branchIds },
      });
      return toUserView(user);
    },
    async deactivate(_persona, memberId) {
      return toUserView(
        await transport.send("POST", `${path(memberId)}/deactivate`, {
          schema: membershipUserViewSchema,
        }),
      );
    },
    async reactivate(_persona, memberId) {
      return toUserView(
        await transport.send("POST", `${path(memberId)}/reactivate`, {
          schema: membershipUserViewSchema,
        }),
      );
    },
  };
}
