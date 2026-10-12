import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import {
  mailProviderRequestSchema,
  type MailProviderRequest,
  type MailProviderResponse,
  type MailProvidersResponse,
  type MailProviderView,
} from "@eyadex/contracts/mail-provider";
import { mailProviderSlotSchema, type MailProviderSlot } from "@eyadex/contracts/notifications";

import { ApiError } from "../../../shared/errors.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (ADR-0014, owner decision 2026-10-07).
import { Require, type ClinicRequest } from "../../identity/index.ts";
import { MAIL_PROVIDER_CHANGES, MAIL_PROVIDER_READER } from "../ports/tokens.ts";
import type { MailProviderReader } from "../ports/mail-provider-reader.ts";
import type { MailProviderChanges } from "../use-cases/mail-provider-changes.ts";
import { actor, keyOf } from "./mail-provider.controller.ts";

// An unknown slot is an unknown resource: 404, like a malformed id.
const slotOf = (raw: string): MailProviderSlot => {
  const parsed = mailProviderSlotSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("not_found");
  return parsed.data;
};

// Phase 3 (N-3, ADR-0031): the primary and the fallback provider. Same bodies, permissions, idempotency,
// cooldown and audit as the single-provider routes, which stay as the primary's alias. Thin: validate →
// call → map; nothing here ever returns the key or the password.
@Controller("clinic/mail-providers")
export class MailProvidersController {
  constructor(
    @Inject(MAIL_PROVIDER_READER) private readonly reader: MailProviderReader,
    @Inject(MAIL_PROVIDER_CHANGES) private readonly changes: MailProviderChanges,
  ) {}

  @Get()
  @Require("view:clinic_settings:clinic")
  list(@Req() request: ClinicRequest): Promise<MailProvidersResponse> {
    return this.reader.readAll(request.clinicContext.clinicId);
  }

  @Get(":slot")
  @Require("view:clinic_settings:clinic")
  view(@Req() request: ClinicRequest, @Param("slot") slot: string): Promise<MailProviderResponse> {
    return this.reader.read(request.clinicContext.clinicId, slotOf(slot));
  }

  @Put(":slot")
  @Require("update:clinic_settings:clinic")
  put(
    @Req() request: ClinicRequest,
    @Param("slot") slot: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodValidationPipe(mailProviderRequestSchema)) body: MailProviderRequest,
  ): Promise<MailProviderView> {
    return this.changes.put(actor(request), slotOf(slot), body, keyOf(rawKey));
  }

  @Delete(":slot")
  @HttpCode(204)
  @Require("update:clinic_settings:clinic")
  async remove(@Req() request: ClinicRequest, @Param("slot") slot: string): Promise<void> {
    await this.changes.remove(actor(request), slotOf(slot));
  }

  @Post(":slot/test")
  @HttpCode(202)
  @Require("update:clinic_settings:clinic")
  async test(
    @Req() request: ClinicRequest,
    @Param("slot") slot: string,
    @Headers("idempotency-key") rawKey: string | undefined,
  ): Promise<{ accepted: true }> {
    await this.changes.requestTest(actor(request), slotOf(slot), keyOf(rawKey));
    return { accepted: true };
  }
}
