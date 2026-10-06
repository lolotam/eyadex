import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  branchListQuerySchema,
  createBranchRequestSchema,
  updateBranchRequestSchema,
  type BranchDetail,
  type BranchListQuery,
  type BranchListResponse,
  type CreateBranchRequest,
  type UpdateBranchRequest,
} from "@eyadex/contracts/branches";
import { idSchema } from "@eyadex/contracts/common";
import { idempotencyKeySchema } from "@eyadex/contracts/onboarding";
import type { Database } from "@eyadex/db";

import { DATABASE } from "../../../shared/database.provider.ts";
import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { listBranches, type BranchChange, type BranchChanges } from "../../tenancy/index.ts";
import { Require } from "../access/access-rules.ts";
import type { ClinicRequest } from "../access/access.guard.ts";
import {
  AUTHORIZATION_INVALIDATOR,
  type AuthorizationInvalidator,
} from "../ports/authorization-invalidator.ts";

export const BRANCH_CHANGES = Symbol("identity.BranchChanges");

const logger = new Logger("branches");

// A malformed id is an unknown branch: 404, the same answer as another clinic's id (ISO-02).
const branchIdOf = (raw: string): string => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("not_found");
  return parsed.data;
};

const actor = (request: ClinicRequest) => ({
  clinicId: request.clinicContext.clinicId,
  userId: request.clinicContext.userId,
});

// Stories 31–34 (ADR-0011). The use cases live in tenancy; this controller sits in identity because the
// guard and the cache invalidator do (identity → tenancy is an allowed arrow).
@Controller("branches")
export class BranchesController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BRANCH_CHANGES) private readonly changes: BranchChanges,
    @Inject(AUTHORIZATION_INVALIDATOR) private readonly invalidator: AuthorizationInvalidator,
  ) {}

  @Get()
  @Require("view:branches:clinic")
  list(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(branchListQuerySchema)) query: BranchListQuery,
  ): Promise<BranchListResponse> {
    return listBranches(this.db, request.clinicContext.clinicId, query);
  }

  @Post()
  @HttpCode(201)
  @Require("create:branches:clinic")
  async create(
    @Req() request: ClinicRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(createBranchRequestSchema)) body: CreateBranchRequest,
  ): Promise<BranchDetail> {
    const key = idempotencyKeySchema.safeParse(rawKey);
    if (!key.success) {
      throw new ApiError("validation", [{ path: ["Idempotency-Key"], code: "required" }]);
    }
    return this.after(request, await this.changes.create(actor(request), body, key.data));
  }

  @Patch(":id")
  @Require("update:branches:clinic")
  async update(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateBranchRequestSchema)) body: UpdateBranchRequest,
  ): Promise<BranchDetail> {
    const change = await this.changes.update(actor(request), branchIdOf(id), body);
    return this.after(request, change);
  }

  @Post(":id/deactivate")
  @HttpCode(200)
  @Require("deactivate:branches:clinic")
  async deactivate(@Req() request: ClinicRequest, @Param("id") id: string): Promise<BranchDetail> {
    return this.after(request, await this.changes.deactivate(actor(request), branchIdOf(id)));
  }

  @Post(":id/reactivate")
  @HttpCode(200)
  @Require("deactivate:branches:clinic")
  async reactivate(@Req() request: ClinicRequest, @Param("id") id: string): Promise<BranchDetail> {
    return this.after(request, await this.changes.reactivate(actor(request), branchIdOf(id)));
  }

  // Branch scope is in the cached member snapshot, so every committed change bumps the clinic version.
  private async after(request: ClinicRequest, change: BranchChange): Promise<BranchDetail> {
    if (change.changed) {
      try {
        await this.invalidator.clinicChanged(request.clinicContext.clinicId);
      } catch {
        // Committed already; the stale snapshot lives at most MEMBER_TTL_SECONDS (ADR-0009).
        logger.warn("authorization cache invalidation failed; relying on the 30 s TTL");
      }
    }
    return change.branch;
  }
}
