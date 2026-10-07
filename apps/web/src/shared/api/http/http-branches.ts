import {
  branchDetailSchema,
  branchListResponseSchema,
  type BranchDetail,
  type CreateBranchRequest,
  type UpdateBranchRequest,
} from "@eyadex/contracts/branches";
import type { Branch, BranchInput, BranchListQuery } from "@eyadex/contracts/organization";
import type { DeactivateBranchRequest } from "@eyadex/contracts/user-admin";
import type { ApiClient } from "../api-client";
import { clinicIdOf, type HttpContext } from "./http-context";

/** API branch → web branch; the API leaves out the clinic id, the caller supplies it. */
export function toBranch(branch: BranchDetail, clinicId: string): Branch {
  return {
    id: branch.id,
    clinicId,
    nameAr: branch.nameAr,
    nameEn: branch.nameEn,
    address: branch.address,
    phone: branch.phone,
    isActive: branch.isActive,
    createdAt: branch.createdAt,
  };
}

/** Empty text means "no value"; the API stores it as null. */
function toBranchBody(input: BranchInput): CreateBranchRequest & UpdateBranchRequest {
  return {
    nameAr: input.nameAr,
    nameEn: input.nameEn,
    address: input.address.trim() === "" ? null : input.address,
    phone: input.phone.trim() === "" ? null : input.phone,
  };
}

export function branchListQuery(query: Pick<BranchListQuery, "cursor" | "limit" | "search" | "status">) {
  return {
    cursor: query.cursor,
    limit: query.limit,
    search: query.search.trim(),
    status: query.status,
  };
}

const path = (id: string) => `/v1/branches/${encodeURIComponent(id)}`;

export function createHttpBranches(ctx: HttpContext): ApiClient["branches"] {
  const { transport } = ctx;
  return {
    async list(_persona, query) {
      const clinicId = await clinicIdOf(ctx);
      const page = await transport.send("GET", "/v1/branches", {
        schema: branchListResponseSchema,
        query: branchListQuery(query),
      });
      return {
        items: page.items.map((b) => toBranch(b, clinicId)),
        nextCursor: page.nextCursor,
        total: page.total,
        // TODO(spec): a clinic-side limits read; the API still refuses a create past the limit (409).
        usage: null,
      };
    },
    async create(_persona, input, idempotencyKey) {
      const clinicId = await clinicIdOf(ctx);
      const branch = await transport.send("POST", "/v1/branches", {
        schema: branchDetailSchema,
        body: toBranchBody(input),
        idempotencyKey,
      });
      return toBranch(branch, clinicId);
    },
    async update(_persona, branchId, input) {
      const clinicId = await clinicIdOf(ctx);
      const branch = await transport.send("PATCH", path(branchId), {
        schema: branchDetailSchema,
        body: toBranchBody(input),
      });
      return toBranch(branch, clinicId);
    },
    async deactivate(_persona, branchId, options) {
      const clinicId = await clinicIdOf(ctx);
      const body: DeactivateBranchRequest = options?.confirmStrandedMembers
        ? { confirmStrandedMembers: true }
        : {};
      const branch = await transport.send("POST", `${path(branchId)}/deactivate`, {
        schema: branchDetailSchema,
        body,
      });
      return toBranch(branch, clinicId);
    },
    async reactivate(_persona, branchId) {
      const clinicId = await clinicIdOf(ctx);
      const branch = await transport.send("POST", `${path(branchId)}/reactivate`, {
        schema: branchDetailSchema,
      });
      return toBranch(branch, clinicId);
    },
  };
}
