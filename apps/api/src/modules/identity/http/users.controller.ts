import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { idSchema } from "@eyadex/contracts/common";
import {
  userListHttpQuerySchema,
  type UserListHttpQuery,
  type UserListResponse,
  type UserUsageResponse,
} from "@eyadex/contracts/user-admin";
import {
  changeBranchesInputSchema,
  changeRoleInputSchema,
  type ChangeBranchesInput,
  type ChangeRoleInput,
  type MembershipUserView,
} from "@eyadex/contracts/users";
import type { Database } from "@eyadex/db";

import { DATABASE } from "../../../shared/database.provider.ts";
import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { Require } from "../access/access-rules.ts";
import type { ClinicRequest } from "../access/access.guard.ts";
import {
  AUTHORIZATION_INVALIDATOR,
  type AuthorizationInvalidator,
} from "../ports/authorization-invalidator.ts";
import {
  MEMBER_SESSION_REVOKER,
  type MemberSessionRevoker,
} from "../ports/member-session-revoker.ts";
import { listUsers } from "../queries/user-views.ts";
import type { UserChange, UserChanges } from "../use-cases/user-changes/user-changes.ts";
import { afterUserCommit } from "./after-commit.ts";
import { CLINIC_USAGE, usageOf, type ClinicUsageReader } from "./branches.controller.ts";

export const USER_CHANGES = Symbol("identity.UserChanges");

// A malformed id is an unknown member: 404, the same answer as another clinic's id (ISO-02).
export const idOf = (raw: string): string => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("not_found");
  return parsed.data;
};

export const actorOf = (request: ClinicRequest) => ({
  clinicId: request.clinicContext.clinicId,
  userId: request.clinicContext.userId,
  permissions: request.clinicContext.permissions,
});

// Stories 38–42, 44 (ADR-0012). `:id` is the membership id.
@Controller("users")
export class UsersController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(USER_CHANGES) private readonly changes: UserChanges,
    @Inject(AUTHORIZATION_INVALIDATOR) private readonly invalidator: AuthorizationInvalidator,
    @Inject(MEMBER_SESSION_REVOKER) private readonly revoker: MemberSessionRevoker,
    @Inject(CLINIC_USAGE) private readonly usage: ClinicUsageReader,
  ) {}

  // ADR-0016: active members + live pending invitations, the same rule as the seat check.
  @Get("usage")
  @Require("view:users:clinic")
  async usageRead(@Req() request: ClinicRequest): Promise<UserUsageResponse> {
    const { users } = await usageOf(this.usage, request.clinicContext.clinicId);
    return { used: users.used, limit: users.max };
  }

  @Get()
  @Require("view:users:clinic")
  list(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(userListHttpQuerySchema)) query: UserListHttpQuery,
  ): Promise<UserListResponse> {
    return listUsers(this.db, request.clinicContext.clinicId, query);
  }

  @Patch(":id/role")
  @Require("update:users:clinic")
  async role(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(changeRoleInputSchema)) body: ChangeRoleInput,
  ): Promise<MembershipUserView> {
    return this.after(
      request,
      await this.changes.changeRole(actorOf(request), idOf(id), body.roleId),
    );
  }

  @Patch(":id/branches")
  @Require("update:users:clinic")
  async branches(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(changeBranchesInputSchema)) body: ChangeBranchesInput,
  ): Promise<MembershipUserView> {
    return this.after(request, await this.changes.changeBranches(actorOf(request), idOf(id), body));
  }

  @Post(":id/deactivate")
  @HttpCode(200)
  @Require("deactivate:users:clinic")
  async deactivate(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
  ): Promise<MembershipUserView> {
    return this.after(request, await this.changes.deactivate(actorOf(request), idOf(id)));
  }

  @Post(":id/reactivate")
  @HttpCode(200)
  @Require("deactivate:users:clinic")
  async reactivate(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
  ): Promise<MembershipUserView> {
    return this.after(request, await this.changes.reactivate(actorOf(request), idOf(id)));
  }

  private async after(request: ClinicRequest, change: UserChange): Promise<MembershipUserView> {
    if (change.changed) {
      await afterUserCommit(
        request.clinicContext.clinicId,
        this.invalidator,
        this.revoker,
        change.revokeUserId,
      );
    }
    return change.user;
  }
}
