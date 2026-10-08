import { Body, Controller, Get, Inject, Logger, Put, Req } from "@nestjs/common";
import {
  accountRequestSchema,
  accountResponseSchema,
  type AccountRequest,
  type AccountResponse,
} from "@eyadex/contracts/settings-http";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { Authenticated } from "../access/access-rules.ts";
import type { ClinicRequest } from "../access/access.guard.ts";
import {
  AUTHORIZATION_INVALIDATOR,
  type AuthorizationInvalidator,
} from "../ports/authorization-invalidator.ts";
import type { AccountChanges, AccountOwner } from "../use-cases/account-changes/account-changes.ts";

export const ACCOUNT_CHANGES = Symbol("identity.AccountChanges");

const logger = new Logger("account");

// Only the session names the account: nothing in the request can point at another member.
const ownerOf = (request: ClinicRequest): AccountOwner => ({
  clinicId: request.clinicContext.clinicId,
  userId: request.clinicContext.userId,
  membershipId: request.clinicContext.membershipId,
});

// Story 64 (ADR-0020): any active member of an allowed clinic, its own profile only.
@Controller("account")
export class AccountController {
  constructor(
    @Inject(ACCOUNT_CHANGES) private readonly changes: AccountChanges,
    @Inject(AUTHORIZATION_INVALIDATOR) private readonly invalidator: AuthorizationInvalidator,
  ) {}

  @Get()
  @Authenticated()
  async view(@Req() request: ClinicRequest): Promise<AccountResponse> {
    return accountResponseSchema.parse(await this.changes.read(ownerOf(request)));
  }

  @Put()
  @Authenticated()
  async update(
    @Req() request: ClinicRequest,
    @Body(new ZodValidationPipe(accountRequestSchema)) body: AccountRequest,
  ): Promise<AccountResponse> {
    const saved = await this.changes.update(ownerOf(request), body);
    // The member snapshot carries the name and the language that /v1/me answers with.
    try {
      await this.invalidator.clinicChanged(request.clinicContext.clinicId);
    } catch {
      logger.warn("authorization cache invalidation failed; relying on the 30 s TTL");
    }
    return accountResponseSchema.parse(saved);
  }
}
