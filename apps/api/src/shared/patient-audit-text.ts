import { REDACTED } from "@eyadex/observability";

// A patient audit row is append-only, so an identifier that reaches it can never be removed. The shared
// sanitiser looks for a civil ID or a phone between word boundaries; a clinic can type a name with the
// number glued to it ("Test290040112347"), in full-width digits or in Arabic-Indic digits. This pass
// is stricter and patients-only: normalise first, then mask every long digit run wherever it sits.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Eight digits or more of any script, with the separators people type between groups (space, dash, dot,
// slash, brackets). Eight is the shortest phone; twelve is a civil ID.
const DIGIT_RUN = /\p{Nd}(?:[\s\-./()]*\p{Nd}){7,}/gu;
const DIGIT = /\p{Nd}/gu;
const PHONE_MAX_DIGITS = 11;

// NFKC folds full-width digits to ASCII; Arabic-Indic and Eastern Arabic-Indic digits are digits of
// their own script, so they are folded here explicitly.
const toAsciiDigits = (text: string): string =>
  text
    .normalize("NFKC")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

// 12+ digits (a civil ID, or anything as long) is replaced whole; a phone-length run keeps its last 3.
function maskRun(run: string): string {
  const digits = run.match(DIGIT) ?? [];
  if (digits.length > PHONE_MAX_DIGITS) return REDACTED;
  return `***${digits.slice(-3).join("")}`;
}

/**
 * نص محفوظ في سجل وصول المراجعين: بيتطبّع (NFKC + الأرقام العربية الهندية لـ ASCII)، وبعدين أي
 * سلسلة أرقام طولها 8 أو أكتر بتتغطّى مهما كان اللي جنبها: 12 رقم أو أكتر بتتشال كلها، وأقل من كده
 * بيفضل آخر 3 أرقام بس.
 *
 * @param text النص
 * @returns النص بعد التغطية
 */
export function scrubPatientAuditText(text: string): string {
  return toAsciiDigits(text).replace(DIGIT_RUN, maskRun);
}

/**
 * بيعدّي على كل نص في تفاصيل حدث المراجع، على أي عمق. المعرّفات (UUID كامل) بس اللي بتفضل زي ما
 * هي، لأنها مفاتيح هيكلية مش بيانات شخص.
 *
 * @param value التفاصيل
 * @returns نسخة متغطّية
 */
export function scrubPatientAuditDetails(value: unknown): unknown {
  if (typeof value === "string") return UUID.test(value) ? value : scrubPatientAuditText(value);
  if (Array.isArray(value)) return value.map(scrubPatientAuditDetails);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, scrubPatientAuditDetails(child)]),
    );
  }
  return value;
}
