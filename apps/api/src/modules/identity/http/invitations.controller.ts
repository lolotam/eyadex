import { Body, Controller, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import {
  acceptInvitationRequestSchema,
  inspectInvitationRequestSchema,
  type AcceptInvitationRequest,
  type AcceptInvitationResponse,
  type InspectInvitationRequest,
  type InspectInvitationResponse,
} from "@eyadex/contracts/invitation-acceptance";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { ClinicAreaGuard } from "../auth/clinic-area.guard.ts";
import { PublicRateLimitGuard } from "../auth/public-rate-limit.guard.ts";
import type { AcceptInvitation } from "../use-cases/accept-invitation/accept-invitation.ts";

export const ACCEPT_INVITATION = Symbol("identity.AcceptInvitation");

// No session: the invitee has no account yet. Clinic host first (anything else → 404), then the
// counters, so a refused or rate-limited request never reaches the database (ADR-0008).
@Controller("invitations")
@UseGuards(ClinicAreaGuard, PublicRateLimitGuard)
export class InvitationsController {
  constructor(@Inject(ACCEPT_INVITATION) private readonly acceptance: AcceptInvitation) {}

  @Post("inspect")
  @HttpCode(200)
  inspect(
    @Body(new ZodValidationPipe(inspectInvitationRequestSchema)) body: InspectInvitationRequest,
  ): Promise<InspectInvitationResponse> {
    return this.acceptance.inspect(body.token);
  }

  @Post("accept")
  @HttpCode(200)
  accept(
    @Body(new ZodValidationPipe(acceptInvitationRequestSchema)) body: AcceptInvitationRequest,
  ): Promise<AcceptInvitationResponse> {
    return this.acceptance.accept(body);
  }
}
