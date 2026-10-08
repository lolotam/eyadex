import { REDACTED, redactSecrets } from "@eyadex/observability";

const MAX_DEPTH = 8;
// Format characters (ZWJ, ZWNJ, LRM, RLM, soft hyphen, BOM…) and controls other than whitespace hide
// nothing a reader needs and can split a number so that no pattern sees it.
const INVISIBLE = /[\p{Cf}\p{Cc}]/gu;
const CONTROL_SPACE = /[\t\n\r\v\f]/g;
// Arabic-Indic and Eastern Arabic-Indic digits; NFKC already folds full-width and styled digits.
const ARABIC_DIGIT = /[٠-٩۰-۹]/g;
// Any run of digits, separators allowed between them, whatever stands before or after it (a digit
// glued to letters still counts). 12 or more digits can be a civil ID; 7 to 11 a phone number.
const DIGIT_RUN = /\+?\p{Nd}(?:[\s.\-/()]*\p{Nd})*/gu;
const DIGIT = /\p{Nd}/gu;
const PHONE_MIN_DIGITS = 7;
const CIVIL_ID_MIN_DIGITS = 12;

// Values that are identifiers or instants by shape, under keys that only ever hold them; anything
// else under those keys is treated as free text.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2}))?$/;
const STRUCTURED_KEYS = new Set([
  "id",
  "roleId",
  "branchId",
  "branchIds",
  "registrationBranchId",
  "invitationId",
  "expiresAt",
  "verifiedAt",
  "degradedAt",
]);

/**
 * نفس الكتابة بشكل واحد: NFKC، من غير حروف خفية، والأرقام العربية أرقام ASCII. العرض والبحث
 * الاتنين بيعدّوا عليها، فمحدش يقدر يخبّي رقم ورا حرف مش باين أو رقم بخط تاني.
 *
 * @param text النص زي ما اتخزن أو اتكتب في البحث
 * @returns النص بعد التوحيد
 */
export function normalizedText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(CONTROL_SPACE, " ")
    .replace(INVISIBLE, "")
    .replace(ARABIC_DIGIT, (d) => String((d.charCodeAt(0) - 0x0660) % 0x90));
}

function maskDigitRun(run: string): string {
  const digits = run.match(DIGIT) ?? [];
  if (digits.length >= CIVIL_ID_MIN_DIGITS) return REDACTED;
  if (digits.length >= PHONE_MIN_DIGITS) return `***${digits.slice(-3).join("")}`;
  return run;
}

/**
 * نص بيطلع في السجل (اسم فاعل، اسم عيادة، نص في لقطة): موحّد، من غير سر (`redactSecrets`)،
 * وأي سلسلة أرقام من 12 فأكتر بتتشال (رقم مدني)، ومن 7 لـ 11 بيفضل منها آخر 3 (تليفون).
 *
 * @param text النص زي ما اتخزن
 * @returns النص اللي ينفع يتعرض
 */
export function shownText(text: string): string {
  const scrubbed = redactSecrets(normalizedText(text));
  return (typeof scrubbed === "string" ? scrubbed : REDACTED).replace(DIGIT_RUN, maskDigitRun);
}

function shownLeaf(key: string | undefined, value: unknown): unknown {
  if (typeof value === "string") {
    const structured = key !== undefined && STRUCTURED_KEYS.has(key);
    return structured && (UUID.test(value) || INSTANT.test(value)) ? value : shownText(value);
  }
  // A long integer in a snapshot is shown the way the same digits in text would be.
  if (typeof value === "number" && Number.isInteger(value) && Math.abs(value) >= 1_000_000) {
    return shownText(String(value));
  }
  return value;
}

/**
 * نفس `shownText` على كل نص في قيمة، في أي عمق (لقطة قبل/بعد فيها objects وarrays جوه بعض).
 * الـ ids والأوقات بتفضل زي ما هي بس تحت مفاتيحها المعروفة ولو شكلها مظبوط.
 *
 * @param value القيمة بعد الـ allowlist
 * @param key المفتاح اللي القيمة تحته (لعناصر الـ array: مفتاح الـ array)
 * @param depth العمق الحالي (من بره: 0)
 * @returns نسخة كل نص فيها اتنضف
 */
export function shownValue(value: unknown, key?: string, depth = 0): unknown {
  if (typeof value !== "object" || value === null) return shownLeaf(key, value);
  // A snapshot is a few levels deep; anything deeper is not shown rather than walked without end.
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => shownValue(item, key, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [name, shownValue(item, name, depth + 1)]),
  );
}
