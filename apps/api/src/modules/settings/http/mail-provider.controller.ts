import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import {
  mailProviderRequestSchema,
  type MailProviderRequest,
  type MailProviderResponse,
  type MailProviderView,
} from "@eyadex/contracts/mail-provider";
import { idempotencyKeySchema } from "@eyadex/contracts/onboarding";

import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (ADR-0014, owner decision 2026-10-07).
import { Require, type ClinicRequest } from "../../identity/index.ts";
import { MAIL_PROVIDER_CHANGES, MAIL_PROVIDER_READER } from "../ports/tokens.ts";
import type { MailProviderReader } from "../ports/mail-provider-reader.ts";
import type { MailProviderChanges } from "../use-cases/mail-provider-changes.ts";

const actor = (request: ClinicRequest) => ({
  clinicId: request.clinicContext.clinicId,
  userId: request.clinicContext.userId,
});

const keyOf = (raw: string | undefined): string => {
  const key = idempotencyKeySchema.safeParse(raw);
  if (!key.success) {
    throw new ApiError("validation", [{ path: ["Idempotency-Key"], code: "required" }]);
  }
  return key.data;
};

// ADR-0014 (7c-2a). Thin: validate → call → map. Nothing here ever returns the key or the password.
@Controller("clinic/mail-provider")
export class MailProviderController {
  constructor(
    @Inject(MAIL_PROVIDER_READER) private readonly reader: MailProviderReader,
    @Inject(MAIL_PROVIDER_CHANGES) private readonly changes: MailProviderChanges,
  ) {}

  @Get()
  @Require("view:clinic_settings:clinic")
  view(@Req() request: ClinicRequest): Promise<MailProviderResponse> {
    return this.reader.read(request.clinicContext.clinicId);
  }

  @Put()
  @Require("update:clinic_settings:clinic")
  put(
    @Req() request: ClinicRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(mailProviderRequestSchema)) body: MailProviderRequest,
  ): Promise<MailProviderView> {
    return this.changes.put(actor(request), body, keyOf(rawKey));
  }

  @Delete()
  @HttpCode(204)
  @Require("update:clinic_settings:clinic")
  async remove(@Req() request: ClinicRequest): Promise<void> {
    await this.changes.remove(actor(request));
  }

  @Post("test")
  @HttpCode(202)
  @Require("update:clinic_settings:clinic")
  async test(
    @Req() request: ClinicRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
  ): Promise<{ accepted: true }> {
    await this.changes.requestTest(actor(request), keyOf(rawKey));
    return { accepted: true };
  }
}
