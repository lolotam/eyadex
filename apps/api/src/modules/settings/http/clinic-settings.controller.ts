import { Body, Controller, Get, Inject, Logger, Put, Req } from "@nestjs/common";
import {
  clinicSettingsRequestSchema,
  clinicSettingsResponseSchema,
  type ClinicSettingsRequest,
  type ClinicSettingsResponse,
} from "@eyadex/contracts/settings-http";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (ADR-0014, owner decision 2026-10-07).
import {
  AUTHORIZATION_INVALIDATOR,
  Require,
  type AuthorizationInvalidator,
  type ClinicRequest,
} from "../../identity/index.ts";
import type { ClinicSettingsChanges } from "../../tenancy/index.ts";
import { CLINIC_SETTINGS_CHANGES } from "../ports/tokens.ts";

const logger = new Logger("clinic-settings");

// Story 55 (ADR-0020). Thin: validate → call → map. The write is tenancy's (clinics is its table).
@Controller("clinic/settings")
export class ClinicSettingsController {
  constructor(
    @Inject(CLINIC_SETTINGS_CHANGES) private readonly changes: ClinicSettingsChanges,
    @Inject(AUTHORIZATION_INVALIDATOR) private readonly invalidator: AuthorizationInvalidator,
  ) {}

  @Get()
  @Require("view:clinic_settings:clinic")
  async view(@Req() request: ClinicRequest): Promise<ClinicSettingsResponse> {
    return clinicSettingsResponseSchema.parse(
      await this.changes.read(request.clinicContext.clinicId),
    );
  }

  @Put()
  @Require("update:clinic_settings:clinic")
  async update(
    @Req() request: ClinicRequest,
    @Body(new ZodValidationPipe(clinicSettingsRequestSchema)) body: ClinicSettingsRequest,
  ): Promise<ClinicSettingsResponse> {
    const { clinicId, userId } = request.clinicContext;
    const saved = await this.changes.update({ clinicId, userId }, body);
    // The member snapshot carries the clinic's names and time zone: the next request must see the new ones.
    try {
      await this.invalidator.clinicChanged(clinicId);
    } catch {
      logger.warn("authorization cache invalidation failed; relying on the 30 s TTL");
    }
    return clinicSettingsResponseSchema.parse(saved);
  }
}
