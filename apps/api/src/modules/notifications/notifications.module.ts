import { Module, type DynamicModule } from "@nestjs/common";
import type { Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { DatabaseModule } from "../../shared/database.module.ts";
import { DATABASE } from "../../shared/database.provider.ts";
import { mailProviderSealKey } from "../../shared/mail-provider-seal-key.ts";
import { CLOCK, TenancyModule, type Clock } from "../tenancy/index.ts";
import { NotificationSettingsController } from "./http/notification-settings.controller.ts";
import { WhatsappController } from "./http/whatsapp.controller.ts";
import { evolutionApiFromEnv } from "./persistence/evolution-config.ts";
import type { EvolutionApi } from "./ports/evolution-api.ts";
import {
  EVOLUTION_API,
  NOTIFICATION_SETTINGS_CHANGES,
  WHATSAPP_COEXISTENCE,
  WHATSAPP_LINK,
} from "./ports/tokens.ts";
import { NotificationSettingsChanges } from "./use-cases/notification-settings/notification-settings.ts";
import { WhatsappCoexistence } from "./use-cases/whatsapp-channel/whatsapp-coexistence.ts";
import { WhatsappLink } from "./use-cases/whatsapp-channel/whatsapp-link.ts";

/**
 * رسائل المراجعين (ADR-0031، phase 3 N1 و N2): `/v1/clinic/notification-settings` و `/v1/clinic/whatsapp`.
 * الموديول صاحب تلات جداول بس (`clinic_notification_settings` و `patient_notifications` و
 * `clinic_whatsapp_channels`)؛ المواعيد والطب بيحطوا الرسائل في الطابور ويقروا تاريخها من adapters بيصدّرها
 * `index.ts`، مربوطة بـ ports بتاعتهم. الإرسال نفسه شغل الـ worker. محتاج `MAIL_PROVIDER_SEAL_KEY` (ختم توكن
 * coexistence)، و `EVOLUTION_API_URL` + `EVOLUTION_API_KEY` مع بعض أو ولا واحد فيهم.
 */
@Module({})
export class NotificationsModule {
  /**
   * الموديول بـ Evolution من البيئة، أو اللي الاختبار بيحقنه.
   *
   * @param evolution بديل للاختبارات بس
   * @returns الموديول
   */
  static forRoot(evolution?: EvolutionApi): DynamicModule {
    return {
      module: NotificationsModule,
      imports: [DatabaseModule, TenancyModule],
      controllers: [NotificationSettingsController, WhatsappController],
      providers: [
        { provide: EVOLUTION_API, useFactory: () => evolution ?? evolutionApiFromEnv(process.env) },
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
          inject: [DATABASE, CLOCK, EVOLUTION_API],
          useFactory: (db: Database, clock: Clock, api: EvolutionApi) =>
            new WhatsappCoexistence({
              db,
              clock,
              ids: systemUuidV7(),
              evolution: api,
              sealKey: mailProviderSealKey(process.env),
            }),
        },
      ],
    };
  }
}
