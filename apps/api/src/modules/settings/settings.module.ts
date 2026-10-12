import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import { mailProviderSealKey } from "../../shared/mail-provider-seal-key.ts";
import { AuthorizationCacheModule } from "../identity/index.ts";
import { ClinicSettingsChanges, CLOCK, TenancyModule, type Clock } from "../tenancy/index.ts";
import { ClinicSettingsController } from "./http/clinic-settings.controller.ts";
import { MailProviderController } from "./http/mail-provider.controller.ts";
import { MailProvidersController } from "./http/mail-providers.controller.ts";
import type { MailProviderReader } from "./ports/mail-provider-reader.ts";
import {
  CLINIC_SETTINGS_CHANGES,
  MAIL_PROVIDER_CHANGES,
  MAIL_PROVIDER_READER,
} from "./ports/tokens.ts";
import { getMailProvider, getMailProviders } from "./queries/mail-provider.ts";
import { MailProviderChanges } from "./use-cases/mail-provider-changes.ts";

// Re-exported for settings/index.ts, whose callers named it here before it moved to shared/.
export { mailProviderSealKey };

/**
 * إعدادات العيادة: `/v1/clinic/mail-provider` (ADR-0014، دلوقتي اسم تاني للخانة الأساسية)،
 * `/v1/clinic/mail-providers` (الخانتين، ADR-0031) و `/v1/clinic/settings` (ADR-0020). محتاج
 * DATABASE_URL و MAIL_PROVIDER_SEAL_KEY والـ REDIS_URL (إبطال الكاش).
 */
@Module({
  imports: [DatabaseModule, TenancyModule, AuthorizationCacheModule],
  controllers: [MailProviderController, MailProvidersController, ClinicSettingsController],
  providers: [
    {
      provide: CLINIC_SETTINGS_CHANGES,
      inject: [DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock) =>
        new ClinicSettingsChanges({ db, clock, ids: systemUuidV7() }),
    },
    {
      provide: MAIL_PROVIDER_READER,
      inject: [DATABASE],
      useFactory: (db: Database): MailProviderReader => ({
        read: (clinicId, slot) => getMailProvider(db, clinicId, slot),
        readAll: (clinicId) => getMailProviders(db, clinicId),
      }),
    },
    {
      provide: MAIL_PROVIDER_CHANGES,
      inject: [DATABASE, CLOCK],
      useFactory: (db: Database, clock: Clock) =>
        new MailProviderChanges({
          db,
          clock,
          ids: systemUuidV7(),
          sealKey: mailProviderSealKey(process.env),
        }),
    },
  ],
})
export class SettingsModule {}
