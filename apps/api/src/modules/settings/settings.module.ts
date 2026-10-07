import { Module } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import { CLOCK, TenancyModule, type Clock } from "../tenancy/index.ts";
import { MailProviderController } from "./http/mail-provider.controller.ts";
import type { MailProviderReader } from "./ports/mail-provider-reader.ts";
import { MAIL_PROVIDER_CHANGES, MAIL_PROVIDER_READER } from "./ports/tokens.ts";
import { getMailProvider } from "./queries/mail-provider.ts";
import { MailProviderChanges } from "./use-cases/mail-provider-changes.ts";

/**
 * بيقرا `MAIL_PROVIDER_SEAL_KEY` ويوقف التشغيل لو ناقص أو مش 32 بايت. الخطأ بيسمّي المفتاح بس.
 *
 * @param env البيئة
 * @returns المفتاح base64
 */
export function mailProviderSealKey(env: NodeJS.ProcessEnv): string {
  const value = env["MAIL_PROVIDER_SEAL_KEY"] ?? "";
  if (Buffer.from(value, "base64").length !== 32) {
    throw new Error("Invalid API configuration: MAIL_PROVIDER_SEAL_KEY — see .env.example");
  }
  return value;
}

/** إعدادات العيادة (ADR-0014): `/v1/clinic/mail-provider`. محتاج DATABASE_URL و MAIL_PROVIDER_SEAL_KEY. */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [MailProviderController],
  providers: [
    {
      provide: MAIL_PROVIDER_READER,
      inject: [DATABASE],
      useFactory: (db: Database): MailProviderReader => ({
        read: (clinicId) => getMailProvider(db, clinicId),
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
