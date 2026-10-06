const DAY_MS = 24 * 60 * 60 * 1000;

/** طريقة تحديد الانتهاء: مدة من النهارده، أو تاريخ صريح — واحدة بس (ADR-0010). */
export type ExpiryInput =
  | { readonly kind: "duration"; readonly days: number }
  | { readonly kind: "date"; readonly at: Date };

/**
 * تاريخ الانتهاء الجديد (stories 9–12). المدة بتتحسب من اللحظة دي على الـ Clock المحقون؛ التاريخ
 * الصريح بيتاخد زي ما هو حتى لو فات (المنصة ممكن تنهي الدخول عمدًا).
 *
 * @param input المدة أو التاريخ
 * @param now الوقت الحالي
 * @returns لحظة الانتهاء
 */
export function resolveExpiry(input: ExpiryInput, now: Date): Date {
  if (input.kind === "date") return new Date(input.at.getTime());
  if (!Number.isInteger(input.days) || input.days < 1) {
    throw new RangeError("days must be a positive integer");
  }
  return new Date(now.getTime() + input.days * DAY_MS);
}
