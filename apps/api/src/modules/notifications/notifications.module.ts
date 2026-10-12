import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import { CLOCK, TenancyModule, type Clock } from "../tenancy/index.ts";
import { NotificationSettingsController } from "./http/notification-settings.controller.ts";
import { NOTIFICATION_SETTINGS_CHANGES } from "./ports/tokens.ts";
import { NotificationSettingsChanges } from "./use-cases/notification-settings/notification-settings.ts";

/**
 * رسائل المراجعين (ADR-0031، phase 3 N1): `/v1/clinic/notification-settings`. الموديول صاحب جدولين بس
 * (`clinic_notification_settings` و `patient_notifications`)؛ المواعيد والطب بيحطوا الرسائل في الطابور
 * ويقروا تاريخها من adapters بيصدّرها `index.ts`، مربوطة بـ ports بتاعتهم. الإرسال نفسه شغل الـ worker.
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [NotificationSettingsController],
  providers: [
    {
      provide: NOTIFICATION_SETTINGS_CHANGES,
      inject: [DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock) =>
        new NotificationSettingsChanges({ db, clock, ids: systemUuidV7() }),
    },
  ],
})
export class NotificationsModule {}
