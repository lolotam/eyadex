import { stripInvisibleControls } from "@eyadex/contracts/patients";
import { REDACTED } from "@eyadex/observability";

// A patient audit row is append-only, so an identifier that reaches it can never be removed. The shared
// sanitiser looks for a civil ID or a phone between word boundaries; a clinic can type a name with the
// number glued to it ("Test290040112347"), in full-width digits or in Arabic-Indic digits. This pass
// is stricter and patients-only: normalise first, then mask every long digit run wherever it sits.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Only these keys hold identifiers. A UUID-shaped value anywhere else is text a person typed (a name can
// look like a UUID whose last group is a civil ID), so it is scrubbed like any other text.
const ID_KEYS: ReadonlySet<string> = new Set([
  "id",
  "patientId",
  "branchId",
  "registrationBranchId",
]);

// Eight digits or more of any script, with the separators people type between groups (space, dash, dot,
// slash, brackets). Eight is the shortest phone; twelve is a civil ID.
const DIGIT_RUN = /\p{Nd}(?:[\s\-./()]*\p{Nd}){7,}/gu;
const DIGIT = /\p{Nd}/gu;
const PHONE_MAX_DIGITS = 11;

// Invisible format/control characters go first (a ZWJ, a bidi control or a soft hyphen between digits
// would split a run), then NFKC folds full-width digits to ASCII; Arabic-Indic and Eastern
// Arabic-Indic digits are digits of their own script, so they are folded here explicitly.
const toAsciiDigits = (text: string): string =>
  stripInvisibleControls(text)
    .normalize("NFKC")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

// 12+ digits (a civil ID, or anything as long) is replaced whole; a phone-length run keeps its last 3.
function maskRun(run: string): string {
  const digits = run.match(DIGIT) ?? [];
  if (digits.length > PHONE_MAX_DIGITS) return REDACTED;
  return `***${digits.slice(-3).join("")}`;
}

/**
 * نص محفوظ في سجل وصول المراجعين: بتتشال منه حروف التحكم والتنسيق المخفية، وبيتطبّع (NFKC + الأرقام
 * العربية الهندية لـ ASCII)، وبعدين أي
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
 * بيعدّي على كل نص في تفاصيل حدث المراجع، على أي عمق. المعرّف (UUID كامل) بيفضل زي ما هو بس تحت
 * مفتاح معرّفات معروف (`id`، `patientId`، `branchId`، `registrationBranchId`)؛ أي نص تاني بيتغطّى
 * حتى لو شكله UUID، لأن الاسم ممكن يتكتب على شكل UUID آخره رقم مدني.
 *
 * @param value التفاصيل
 * @param key اسم المفتاح اللي القيمة تحته (لو فيه)
 * @returns نسخة متغطّية
 */
export function scrubPatientAuditDetails(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    const isId = key !== undefined && ID_KEYS.has(key) && UUID.test(value);
    return isId ? value : scrubPatientAuditText(value);
  }
  if (Array.isArray(value)) return value.map((item) => scrubPatientAuditDetails(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, child]) => [name, scrubPatientAuditDetails(child, name)]),
    );
  }
  return value;
}
