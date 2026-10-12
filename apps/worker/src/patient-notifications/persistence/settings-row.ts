import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationKind,
  type NotificationSettings,
} from "@eyadex/contracts/notifications";
import { sql, type Tx } from "@eyadex/db";

type SettingsRow = { email_enabled: boolean } & Record<NotificationKind, boolean>;

/**
 * إعدادات رسايل العيادة (0054). عيادة ماحفظتش إعداداتها مالهاش صف، فبتاخد الافتراضي: الإيميل وكل الرسايل
 * شغّالة.
 *
 * @param tx الـ transaction تحت `withTenant`
 * @param clinicId العيادة
 * @param lock `FOR SHARE` لحد آخر الـ transaction (وقت الإرسال)، أو قراءة عادية (الـ scanner)
 * @returns الإعدادات
 */
export async function readNotificationSettings(
  tx: Tx,
  clinicId: string,
  lock: boolean,
): Promise<NotificationSettings> {
  const [row] = (await tx.execute(
    lock
      ? sql`SELECT email_enabled, booked, rescheduled, cancelled, reminder_day, reminder_2h, prescription
            FROM clinic_notification_settings WHERE clinic_id = ${clinicId} FOR SHARE`
      : sql`SELECT email_enabled, booked, rescheduled, cancelled, reminder_day, reminder_2h, prescription
            FROM clinic_notification_settings WHERE clinic_id = ${clinicId}`,
  )) as unknown as SettingsRow[];
  if (row === undefined) return DEFAULT_NOTIFICATION_SETTINGS;
  return {
    emailEnabled: row.email_enabled,
    messages: {
      booked: row.booked,
      rescheduled: row.rescheduled,
      cancelled: row.cancelled,
      reminder_day: row.reminder_day,
      reminder_2h: row.reminder_2h,
      prescription: row.prescription,
    },
  };
}
