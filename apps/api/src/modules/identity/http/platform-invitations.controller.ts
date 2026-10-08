import { Body, Controller, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import {
  acceptInvitationRequestSchema,
  inspectInvitationRequestSchema,
  type AcceptInvitationRequest,
  type InspectInvitationRequest,
} from "@eyadex/contracts/invitation-acceptance";
import {
  acceptPlatformInvitationResponseSchema,
  inspectPlatformInvitationResponseSchema,
  type AcceptPlatformInvitationResponse,
  type InspectPlatformInvitationResponse,
} from "@eyadex/contracts/platform-console";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { Public } from "../access/access-rules.ts";
import { PlatformAreaGuard } from "../auth/platform-area.guard.ts";
import { PublicRateLimitGuard } from "../auth/public-rate-limit.guard.ts";
import type { AcceptPlatformInvitation } from "../use-cases/platform-team/accept-platform-invitation.ts";

export const ACCEPT_PLATFORM_INVITATION = Symbol("identity.AcceptPlatformInvitation");

// No session: the invitee has no account yet. Platform host first (anything else → 404), then the
// counters, so a refused or rate-limited request never reaches the database (ADR-0008, ADR-0020).
@Controller("platform/invitations")
@UseGuards(PlatformAreaGuard, PublicRateLimitGuard)
export class PlatformInvitationsController {
  constructor(
    @Inject(ACCEPT_PLATFORM_INVITATION) private readonly acceptance: AcceptPlatformInvitation,
  ) {}

  @Post("inspect")
  @HttpCode(200)
  @Public()
  async inspect(
    @Body(new ZodValidationPipe(inspectInvitationRequestSchema)) body: InspectInvitationRequest,
  ): Promise<InspectPlatformInvitationResponse> {
    return inspectPlatformInvitationResponseSchema.parse(await this.acceptance.inspect(body.token));
  }

  @Post("accept")
  @HttpCode(200)
  @Public()
  async accept(
    @Body(new ZodValidationPipe(acceptInvitationRequestSchema)) body: AcceptInvitationRequest,
  ): Promise<AcceptPlatformInvitationResponse> {
    return acceptPlatformInvitationResponseSchema.parse(await this.acceptance.accept(body));
  }
}
