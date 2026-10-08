import { maskPhonesInText, REDACTED, redactSecrets } from "@eyadex/observability";

const MAX_DEPTH = 8;

/**
 * نص بيطلع في السجل (اسم فاعل، اسم عيادة): من غير سر ولا رقم مدني (`redactSecrets`، نفس قاعدة
 * باقي الكود)، والتليفونات بآخر 3 أرقام.
 *
 * @param text النص زي ما اتخزن
 * @returns النص اللي ينفع يتعرض
 */
export function shownText(text: string): string {
  const scrubbed = redactSecrets(text);
  return maskPhonesInText(typeof scrubbed === "string" ? scrubbed : REDACTED);
}

/**
 * نفس `shownText` على كل نص في قيمة، في أي عمق (لقطة قبل/بعد فيها objects وarrays جوه بعض).
 *
 * @param value القيمة بعد الـ allowlist
 * @param depth العمق الحالي (من بره: 0)
 * @returns نسخة كل نص فيها اتنضف
 */
export function shownValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return shownText(value);
  if (typeof value !== "object" || value === null) return value;
  // A snapshot is a few levels deep; anything deeper is not shown rather than walked without end.
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => shownValue(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, shownValue(item, depth + 1)]),
  );
}
