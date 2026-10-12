import type { NotificationKind } from "@eyadex/contracts/notifications";

const HOUR_MS = 3_600_000;
/** تذكير اليوم اللي قبله: من 24 ساعة قبل البداية. */
export const DAY_BEFORE_MS = 24 * HOUR_MS;
/** تذكير الساعتين: من ساعتين قبل البداية. */
export const TWO_HOURS_MS = 2 * HOUR_MS;

/** التذكيرين، الأنواع الوحيدة اللي الـ scanner بيسجّلها. */
export type ReminderKind = Extract<NotificationKind, "reminder_day" | "reminder_2h">;

/** موعد `booked` زي ما الـ scanner بيقراه. */
export interface ReminderCandidate {
  readonly startsAt: Date;
  readonly createdAt: Date;
}

/**
 * التذكير المستحق دلوقتي لموعد (spec §3.2)، لو فيه:
 * - اليوم اللي قبله: `starts_at − 24h ≤ now < starts_at − 2h`، والموعد اتعمل قبل `starts_at − 24h`
 *   (حجز في نفس اليوم خد التأكيد خلاص)؛
 * - الساعتين: `starts_at − 2h ≤ now < starts_at`، والموعد اتعمل قبل `starts_at − 2h`.
 * النافذتين مابيتداخلوش، فالموعد عنده تذكير واحد بالكتير في أي لحظة. الـ SQL فلتر تقريبي بس؛ ده المرجع.
 *
 * @param candidate بداية الموعد ووقت إنشائه
 * @param now الوقت من الـ Clock
 * @returns نوع التذكير، أو `null`
 */
export function dueReminder(candidate: ReminderCandidate, now: Date): ReminderKind | null {
  const start = candidate.startsAt.getTime();
  const created = candidate.createdAt.getTime();
  const at = now.getTime();
  if (at >= start - DAY_BEFORE_MS && at < start - TWO_HOURS_MS) {
    return created < start - DAY_BEFORE_MS ? "reminder_day" : null;
  }
  if (at >= start - TWO_HOURS_MS && at < start) {
    return created < start - TWO_HOURS_MS ? "reminder_2h" : null;
  }
  return null;
}
