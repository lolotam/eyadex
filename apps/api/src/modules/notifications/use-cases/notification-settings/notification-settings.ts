import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
} from "@eyadex/contracts/notifications";
import type { Database } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import { ApiError } from "../../../../shared/errors.ts";
import type { Clock } from "../../../tenancy/index.ts";
import { sameSettings } from "../../domain/notification-rules.ts";
import {
  lockNotificationSettings,
  readNotificationSettings,
  upsertNotificationSettings,
} from "../../persistence/pg-notification-settings.ts";
import { whatsappConnected } from "../../persistence/pg-whatsapp-channel.ts";

/** What the settings use case needs: the clinic pool, the time and ids. */
export interface NotificationSettingsDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** The admin the guard resolved. */
export interface NotificationSettingsActor {
  readonly clinicId: string;
  readonly userId: string;
}

/**
 * إعدادات رسائل المراجعين (N-1، ADR-0031): صف واحد للعيادة، ولو ماحفظتش يبقى الافتراضي (البريد شغّال وكل
 * رسالة شغّالة). الحفظ transaction واحدة جوه `withTenant` بصف سجل إداري واحد (قبل/بعد)؛ نفس القيم = نفس
 * الرد من غير كتابة ولا سجل.
 */
export class NotificationSettingsChanges {
  constructor(private readonly deps: NotificationSettingsDeps) {}

  /**
   * الإعدادات الفعلية للعيادة.
   *
   * @param clinicId العيادة
   * @returns المحفوظ، أو الافتراضي لو مفيش صف
   */
  read(clinicId: string): Promise<NotificationSettings> {
    return this.deps.db.withTenant(clinicId, async (tx) => {
      const stored = await readNotificationSettings(tx, clinicId);
      return stored?.settings ?? DEFAULT_NOTIFICATION_SETTINGS;
    });
  }

  /**
   * بيحفظ الإعدادات كلها (upsert للصف الواحد) ويكتب `clinic.notification_settings_updated` على كيان
   * العيادة. القفل بيخلّي "قبل" هو الصف اللي اتبدّل فعلاً. واتساب شغّال وقناة العيادة مش `connected` =
   * رفض (`validation`، `whatsapp_not_connected`)، حتى لو كان شغّال قبل كده والقناة اتفكت بعدها.
   *
   * @param actor الأدمن
   * @param settings الإعدادات بعد `notificationSettingsSchema`
   * @returns الإعدادات بعد الحفظ
   */
  update(
    actor: NotificationSettingsActor,
    settings: NotificationSettings,
  ): Promise<NotificationSettings> {
    const { db, clock, ids } = this.deps;
    return db.withTenant(actor.clinicId, async (tx) => {
      await lockNotificationSettings(tx, actor.clinicId);
      const stored = await readNotificationSettings(tx, actor.clinicId);
      const before = stored?.settings ?? DEFAULT_NOTIFICATION_SETTINGS;
      // A plain read of the channel: the save holds no lock the link writes wait on, and the worker
      // decides again at send time (`whatsapp_disconnected`).
      if (settings.whatsappEnabled && !(await whatsappConnected(tx, actor.clinicId))) {
        throw new ApiError("validation", [
          { path: ["whatsappEnabled"], code: "whatsapp_not_connected" },
        ]);
      }
      if (stored !== null && sameSettings(before, settings)) return before;
      const now = clock.now();
      await upsertNotificationSettings(
        tx,
        actor.clinicId,
        stored?.id ?? ids.newId(),
        settings,
        now,
      );
      await writeClinicAudit(tx, {
        clinicId: actor.clinicId,
        id: ids.newId(),
        actorUserId: actor.userId,
        action: "clinic.notification_settings_updated",
        // An existing audit entity, so both audit screens list it (clinic.settings_updated does the same).
        entityType: "clinic",
        entityId: actor.clinicId,
        details: { before, after: settings },
        createdAt: now,
      });
      return settings;
    });
  }
}
