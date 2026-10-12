import { Body, Controller, Get, Inject, Put, Req } from "@nestjs/common";
import {
  notificationSettingsSchema,
  type NotificationSettings,
} from "@eyadex/contracts/notifications";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, type ClinicRequest } from "../../identity/index.ts";
import { NOTIFICATION_SETTINGS_CHANGES } from "../ports/tokens.ts";
import type { NotificationSettingsChanges } from "../use-cases/notification-settings/notification-settings.ts";

// Phase 3 N1 (spec §5, ADR-0031): which messages the clinic sends. Clinic settings keys, like
// /clinic/settings. Thin: validate → call → map.
@Controller("clinic/notification-settings")
export class NotificationSettingsController {
  constructor(
    @Inject(NOTIFICATION_SETTINGS_CHANGES) private readonly changes: NotificationSettingsChanges,
  ) {}

  @Get()
  @Require("view:clinic_settings:clinic")
  async view(@Req() request: ClinicRequest): Promise<NotificationSettings> {
    return notificationSettingsSchema.parse(
      await this.changes.read(request.clinicContext.clinicId),
    );
  }

  @Put()
  @Require("update:clinic_settings:clinic")
  async update(
    @Req() request: ClinicRequest,
    @Body(new ZodValidationPipe(notificationSettingsSchema)) body: NotificationSettings,
  ): Promise<NotificationSettings> {
    const { clinicId, userId } = request.clinicContext;
    return notificationSettingsSchema.parse(await this.changes.update({ clinicId, userId }, body));
  }
}
