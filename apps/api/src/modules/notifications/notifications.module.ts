import { Module, type DynamicModule } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import { mailProviderSealKey } from "../../shared/mail-provider-seal-key.ts";
import { CLOCK, TenancyModule, type Clock } from "../tenancy/index.ts";
import { NotificationSettingsController } from "./http/notification-settings.controller.ts";
import { WhatsappController } from "./http/whatsapp.controller.ts";
import { EvolutionWebhookController } from "./http/evolution-webhook.controller.ts";
import { EvolutionWebhookGuard } from "./http/evolution-webhook.guard.ts";
import { MetaWebhookController } from "./http/meta-webhook.controller.ts";
import { MetaWebhookGuard } from "./http/meta-webhook.guard.ts";
import { metaConfigFromEnv, type MetaAppConfig } from "./persistence/meta-config.ts";
import { MetaWebhook } from "./use-cases/meta-webhook/meta-webhook.ts";
import { WhatsappEmbeddedSignup } from "./use-cases/whatsapp-channel/whatsapp-embedded-signup.ts";
import { AuthModule, PublicRateLimitGuard } from "../identity/index.ts";
import { HttpMetaApi } from "./persistence/http-meta-api.ts";
import type { MetaApi } from "./ports/meta-api.ts";
import { EvolutionWebhook } from "./use-cases/evolution-webhook/evolution-webhook.ts";
import { evolutionApiFromEnv } from "./persistence/evolution-config.ts";
import type { EvolutionApi } from "./ports/evolution-api.ts";
import {
  EVOLUTION_API,
  NOTIFICATION_SETTINGS_CHANGES,
  WHATSAPP_COEXISTENCE,
  WHATSAPP_LINK,
  META_API,
  META_CONFIG,
  META_WEBHOOK,
  EVOLUTION_WEBHOOK,
  EVOLUTION_WEBHOOK_SECRET,
  WHATSAPP_EMBEDDED_SIGNUP,
} from "./ports/tokens.ts";
import { NotificationSettingsChanges } from "./use-cases/notification-settings/notification-settings.ts";
import { WhatsappCoexistence } from "./use-cases/whatsapp-channel/whatsapp-coexistence.ts";
import { WhatsappLink } from "./use-cases/whatsapp-channel/whatsapp-link.ts";

/**
 * رسائل المراجعين (ADR-0031، phase 3 N1 و N2): `/v1/clinic/notification-settings` و `/v1/clinic/whatsapp`.
 * الموديول صاحب تلات جداول بس (`clinic_notification_settings` و `patient_notifications` و
 * `clinic_whatsapp_channels`)؛ المواعيد والطب بيحطوا الرسائل في الطابور ويقروا تاريخها من adapters بيصدّرها
 * `index.ts`، مربوطة بـ ports بتاعتهم. الإرسال نفسه شغل الـ worker. محتاج `MAIL_PROVIDER_SEAL_KEY` (ختم توكن
 * coexistence)، و `EVOLUTION_API_URL` + `EVOLUTION_API_KEY` مع بعض أو ولا واحد فيهم، و (N3) `META_APP_ID` +
 * `META_APP_SECRET` + `META_WHATSAPP_CONFIG_ID` + `META_WEBHOOK_VERIFY_TOKEN` مع بعض أو ولا واحد فيهم.
 */
@Module({})
export class NotificationsModule {
  /**
   * الموديول بـ Evolution من البيئة، أو اللي الاختبار بيحقنه.
   *
   * @param meta Graph verification boundary for tests
   * @param evolution بديل للاختبارات بس
   * @returns الموديول
   */
  static forRoot(evolution?: EvolutionApi, meta?: MetaApi): DynamicModule {
    return {
      module: NotificationsModule,
      imports: [DatabaseModule, TenancyModule, AuthModule],
      controllers: [
        NotificationSettingsController,
        WhatsappController,
        EvolutionWebhookController,
        MetaWebhookController,
      ],
      providers: [
        { provide: EVOLUTION_API, useFactory: () => evolution ?? evolutionApiFromEnv(process.env) },
        { provide: META_API, useFactory: () => meta ?? new HttpMetaApi() },
        {
          provide: EVOLUTION_WEBHOOK_SECRET,
          useFactory: () => process.env["EVOLUTION_WEBHOOK_SECRET"] || null,
        },
        { provide: META_CONFIG, useFactory: () => metaConfigFromEnv(process.env) },
        EvolutionWebhookGuard,
        MetaWebhookGuard,
        PublicRateLimitGuard,
        {
          provide: META_WEBHOOK,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Database, clock: Clock) => new MetaWebhook({ db, clock }),
        },
        {
          provide: EVOLUTION_WEBHOOK,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Database, clock: Clock) =>
            new EvolutionWebhook({ db, clock, ids: systemUuidV7() }),
        },
        {
          provide: NOTIFICATION_SETTINGS_CHANGES,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Database, clock: Clock) =>
            new NotificationSettingsChanges({ db, clock, ids: systemUuidV7() }),
        },
        {
          provide: WHATSAPP_LINK,
          inject: [DATABASE, CLOCK, EVOLUTION_API],
          useFactory: (db: Database, clock: Clock, api: EvolutionApi) =>
            new WhatsappLink({ db, clock, ids: systemUuidV7(), evolution: api }),
        },
        {
          provide: WHATSAPP_COEXISTENCE,
          inject: [DATABASE, CLOCK, EVOLUTION_API, META_API],
          useFactory: (db: Database, clock: Clock, api: EvolutionApi, metaApi: MetaApi) =>
            new WhatsappCoexistence({
              db,
              clock,
              ids: systemUuidV7(),
              evolution: api,
              meta: metaApi,
              sealKey: mailProviderSealKey(process.env),
            }),
        },
        {
          provide: WHATSAPP_EMBEDDED_SIGNUP,
          inject: [DATABASE, CLOCK, EVOLUTION_API, META_API, META_CONFIG],
          useFactory: (
            db: Database,
            clock: Clock,
            api: EvolutionApi,
            metaApi: MetaApi,
            app: MetaAppConfig | null,
          ) =>
            new WhatsappEmbeddedSignup({
              db,
              clock,
              ids: systemUuidV7(),
              evolution: api,
              meta: metaApi,
              app,
              sealKey: mailProviderSealKey(process.env),
            }),
        },
      ],
    };
  }
}
