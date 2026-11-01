import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { idSchema } from "@eyadex/contracts/common";
import { idempotencyKeySchema } from "@eyadex/contracts/onboarding";
import {
  invitePlatformAccountRequestSchema,
  platformAccountResponseSchema,
  platformTeamListQuerySchema,
  platformTeamListResponseSchema,
  type InvitePlatformAccountRequest,
  type PlatformAccountResponse,
  type PlatformTeamListQuery,
  type PlatformTeamListResponse,
} from "@eyadex/contracts/platform-console";

import { parseContract } from "../../../shared/contract-parser.ts";
import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import {
  PLATFORM_SESSION_REVOKER,
  PLATFORM_TEAM_CHANGES,
  PlatformStaff,
  type AuthenticatedRequest,
  type PlatformSessionRevoker,
  type PlatformTeamChanges,
  type StatusChange,
} from "../../identity/index.ts";

const logger = new Logger("platform-team");

// A malformed id is an unknown account: 404, the same answer as a well-formed id that matches nothing.
const accountIdOf = (raw: string): string => {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("not_found");
  return parsed.data;
};

const actorOf = (request: AuthenticatedRequest) => request.areaSession.session.user.id;

// Stories 24–25 (ADR-0020). Thin: validate → call → map; the rules are identity's use case.
@Controller("platform/team")
export class PlatformTeamController {
  constructor(
    @Inject(PLATFORM_TEAM_CHANGES) private readonly team: PlatformTeamChanges,
    @Inject(PLATFORM_SESSION_REVOKER) private readonly sessions: PlatformSessionRevoker,
  ) {}

  @Get()
  @PlatformStaff()
  async list(
    @Query(new ZodValidationPipe(platformTeamListQuerySchema)) query: PlatformTeamListQuery,
  ): Promise<PlatformTeamListResponse> {
    return parseContract(platformTeamListResponseSchema, await this.team.list(query));
  }

  @Post()
  @HttpCode(201)
  @PlatformStaff()
  async invite(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(invitePlatformAccountRequestSchema))
    body: InvitePlatformAccountRequest,
  ): Promise<PlatformAccountResponse> {
    const key = idempotencyKeySchema.safeParse(rawKey);
    if (!key.success) {
      throw new ApiError("validation", [{ path: ["Idempotency-Key"], code: "required" }]);
    }
    const account = await this.team.invite(actorOf(request), body, key.data);
    return parseContract(platformAccountResponseSchema, account);
  }

  @Post(":id/deactivate")
  @HttpCode(200)
  @PlatformStaff()
  async deactivate(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<PlatformAccountResponse> {
    return this.afterCommit(await this.team.deactivate(actorOf(request), accountIdOf(id)));
  }

  @Post(":id/reactivate")
  @HttpCode(200)
  @PlatformStaff()
  async reactivate(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<PlatformAccountResponse> {
    return this.afterCommit(await this.team.reactivate(actorOf(request), accountIdOf(id)));
  }

  // PRD §4.10: a deactivated account loses its sessions now. A failure is logged, never thrown: the
  // change is committed and the gate refuses the account on its next request anyway.
  private async afterCommit(change: StatusChange): Promise<PlatformAccountResponse> {
    if (change.revokeUserId !== null) {
      try {
        await this.sessions.revokePlatformSessions(change.revokeUserId);
      } catch {
        logger.warn("platform session revocation failed; the gate still refuses the account");
      }
    }
    return parseContract(platformAccountResponseSchema, change.account);
  }
}
