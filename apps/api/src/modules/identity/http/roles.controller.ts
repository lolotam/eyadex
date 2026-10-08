import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import type { RoleSummary } from "@eyadex/contracts/access";
import { idempotencyKeySchema } from "@eyadex/contracts/onboarding";
import {
  createRoleRequestSchema,
  updateRoleRequestSchema,
  type CreateRoleRequest,
  type UpdateRoleRequest,
} from "@eyadex/contracts/role-admin";

import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { Require } from "../access/access-rules.ts";
import type { ClinicRequest } from "../access/access.guard.ts";
import {
  AUTHORIZATION_INVALIDATOR,
  type AuthorizationInvalidator,
} from "../ports/authorization-invalidator.ts";
import type { RoleChange, RoleChanges } from "../use-cases/role-changes/role-changes.ts";
import { idOf } from "./users.controller.ts";

export const ROLE_CHANGES = Symbol("identity.RoleChanges");

const logger = new Logger("roles");

const actorOf = (request: ClinicRequest) => ({
  clinicId: request.clinicContext.clinicId,
  userId: request.clinicContext.userId,
  permissions: request.clinicContext.permissions,
});

// Stories 46–52 (ADR-0017). The reads (`GET /v1/roles`, the catalogue) stay in access.controllers.ts;
// Nest serves two controllers on one prefix.
@Controller("roles")
export class RoleWritesController {
  constructor(
    @Inject(ROLE_CHANGES) private readonly changes: RoleChanges,
    @Inject(AUTHORIZATION_INVALIDATOR) private readonly invalidator: AuthorizationInvalidator,
  ) {}

  @Post()
  @HttpCode(201)
  @Require("create:roles:clinic")
  async create(
    @Req() request: ClinicRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(createRoleRequestSchema)) body: CreateRoleRequest,
  ): Promise<RoleSummary> {
    const key = idempotencyKeySchema.safeParse(rawKey);
    if (!key.success) {
      throw new ApiError("validation", [{ path: ["Idempotency-Key"], code: "required" }]);
    }
    return this.after(request, await this.changes.create(actorOf(request), body, key.data));
  }

  @Patch(":id")
  @Require("update:roles:clinic")
  async update(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateRoleRequestSchema)) body: UpdateRoleRequest,
  ): Promise<RoleSummary> {
    return this.after(request, await this.changes.update(actorOf(request), idOf(id), body));
  }

  @Post(":id/deactivate")
  @HttpCode(200)
  @Require("deactivate:roles:clinic")
  async deactivate(@Req() request: ClinicRequest, @Param("id") id: string): Promise<RoleSummary> {
    return this.after(request, await this.changes.deactivate(actorOf(request), idOf(id)));
  }

  @Post(":id/reactivate")
  @HttpCode(200)
  @Require("deactivate:roles:clinic")
  async reactivate(@Req() request: ClinicRequest, @Param("id") id: string): Promise<RoleSummary> {
    return this.after(request, await this.changes.reactivate(actorOf(request), idOf(id)));
  }

  // A role's keys and status are in every holder's cached snapshot (RBAC-03): bump after commit.
  private async after(request: ClinicRequest, change: RoleChange): Promise<RoleSummary> {
    if (change.changed) {
      try {
        await this.invalidator.clinicChanged(request.clinicContext.clinicId);
      } catch {
        // Committed already; the stale snapshot lives at most MEMBER_TTL_SECONDS (ADR-0009).
        logger.warn("authorization cache invalidation failed; relying on the 30 s TTL");
      }
    }
    return change.role;
  }
}
