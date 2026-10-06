import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Invitation } from "@eyadex/contracts/invitations";
import { idempotencyKeySchema } from "@eyadex/contracts/onboarding";
import {
  invitationListHttpQuerySchema,
  type InvitationListHttpQuery,
  type InvitationListResponse,
} from "@eyadex/contracts/user-admin";
import { inviteUserInputSchema, type InviteUserInput } from "@eyadex/contracts/users";
import type { Database } from "@eyadex/db";

import { DATABASE } from "../../../shared/database.provider.ts";
import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { CLOCK, type Clock } from "../../tenancy/index.ts";
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
import { listInvitations } from "../queries/invitation-views.ts";
import type {
  InvitationChange,
  InvitationChanges,
} from "../use-cases/invitation-changes/invitation-changes.ts";
import { afterUserCommit } from "./after-commit.ts";
import { actorOf, idOf } from "./users.controller.ts";

export const INVITATION_CHANGES = Symbol("identity.InvitationChanges");

// Stories 35–37, 43 (ADR-0012). Same /invitations prefix as the public inspect/accept routes, which keep
// their own controller and guards; every route here needs a clinic session and a permission.
@Controller("invitations")
export class ClinicInvitationsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(INVITATION_CHANGES) private readonly changes: InvitationChanges,
    @Inject(AUTHORIZATION_INVALIDATOR) private readonly invalidator: AuthorizationInvalidator,
    @Inject(MEMBER_SESSION_REVOKER) private readonly revoker: MemberSessionRevoker,
  ) {}

  @Get()
  @Require("view:users:clinic")
  list(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(invitationListHttpQuerySchema)) query: InvitationListHttpQuery,
  ): Promise<InvitationListResponse> {
    return listInvitations(this.db, request.clinicContext.clinicId, query, this.clock.now());
  }

  @Post()
  @HttpCode(201)
  @Require("create:users:clinic")
  async invite(
    @Req() request: ClinicRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(inviteUserInputSchema)) body: InviteUserInput,
  ): Promise<Invitation> {
    const key = idempotencyKeySchema.safeParse(rawKey);
    if (!key.success) {
      throw new ApiError("validation", [{ path: ["Idempotency-Key"], code: "required" }]);
    }
    return this.after(request, await this.changes.invite(actorOf(request), body, key.data));
  }

  @Post(":id/resend")
  @HttpCode(200)
  @Require("create:users:clinic")
  async resend(@Req() request: ClinicRequest, @Param("id") id: string): Promise<Invitation> {
    return this.after(request, await this.changes.resend(actorOf(request), idOf(id)));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @Require("deactivate:users:clinic")
  async cancel(@Req() request: ClinicRequest, @Param("id") id: string): Promise<Invitation> {
    return this.after(request, await this.changes.cancel(actorOf(request), idOf(id)));
  }

  // Seats are not in the cached snapshot, but a bump keeps every users-area read consistent.
  private async after(request: ClinicRequest, change: InvitationChange): Promise<Invitation> {
    if (change.changed) {
      await afterUserCommit(request.clinicContext.clinicId, this.invalidator, this.revoker, null);
    }
    return change.invitation;
  }
}
