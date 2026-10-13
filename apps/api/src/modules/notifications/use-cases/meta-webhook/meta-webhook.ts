import type { Database } from "@eyadex/db";

import { parseMetaWebhook } from "../../domain/meta-webhook.ts";
import {
  applyProviderStatus,
  whatsappClinicForPhoneNumber,
} from "../../persistence/pg-delivery-status.ts";

/**
 * حالات رسايل coexistence من webhook بتاع Meta (spec §7.2). الرقم بيحدد العيادة من خلال دالة 0059 (برّه أي
 * عيادة، بترجع رقم العيادة بس)، وبعدها كل حالة جوه `withTenant` بتاعة العيادة دي على صفوف
 * WhatsApp/coexistence بس. رقم مش معروف = تجاهل؛ إعادة نفس الحدث = مفيش تغيير؛ خطأ داتابيز بيطلع (500)
 * عشان Meta يبعت تاني.
 */
export class MetaWebhook {
  constructor(private readonly deps: { db: Database; clock: { now(): Date } }) {}

  /**
   * @param body الجسم بعد التحقق من التوقيع و `JSON.parse`، غير موثوق في شكله
   */
  async receive(body: unknown): Promise<void> {
    const { db, clock } = this.deps;
    for (const batch of parseMetaWebhook(body, clock.now())) {
      const clinicId = await db.withNoTenant((tx) =>
        whatsappClinicForPhoneNumber(tx, batch.phoneNumberId),
      );
      if (clinicId === null) continue;
      await db.withTenant(clinicId, async (tx) => {
        const now = clock.now();
        for (const { messageId, update } of batch.updates)
          await applyProviderStatus(
            tx,
            { clinicId, transport: "coexistence", messageId },
            update,
            now,
          );
      });
    }
  }
}
