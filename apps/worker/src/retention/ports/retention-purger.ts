import type { RetentionTarget } from "@eyadex/db";

/** الحذف بعد مدة الاحتفاظ؛ الـ dispatcher outbox (`@eyadex/db`) هو اللي بينفّذه على `eyadex_dispatcher`. */
export interface RetentionPurger {
  /**
   * دفعة واحدة من دفتر واحد في transaction خاصة بيها. المدة بتتحسب جوه الداتابيز من `now()` (0040)،
   * فالـ worker مابيبعتش أي وقت.
   *
   * @param target الدفتر
   * @param limit أقصى عدد صفوف في الدفعة
   * @returns عدد الصفوف اللي اتمسحت؛ أقل من `limit` معناها إن الدفتر خلص
   */
  purgeExpired(target: RetentionTarget, limit: number): Promise<number>;
}
