import { REDACTED } from "./masks.ts";
import { normalizeAuditText } from "./normalize.ts";
import { redactSecrets } from "./redaction.ts";

// The one scrub for free text in the audit log, used where a row is written (patient access, role and
// member names) and again where any row is shown (actor, clinic and reference names, snapshot strings).
// An audit row is append-only, so an identifier that reaches it can never be removed: unlike the log
// scanners (free-text.ts), which look for a civil ID or a phone between word boundaries, this pass masks
// every digit run wherever it sits — glued to letters, in another script, split by separators.

// Any run of digits, with the separators people type between groups (space, dot, dash, slash,
// brackets), whatever stands before or after it. A leading "+" belongs to the number.
const DIGIT_RUN = /\+?\p{Nd}(?:[\s.\-/()]*\p{Nd})*/gu;
const DIGIT = /\p{Nd}/gu;
// 7 digits is the shortest phone either scrub ever masked; 12 is a civil ID (anything as long goes whole).
const PHONE_MIN_DIGITS = 7;
const CIVIL_ID_MIN_DIGITS = 12;
// An integer this large in a snapshot is shown the way the same digits in text would be.
const LONG_INTEGER = 1_000_000;
// A snapshot is a few levels deep; anything deeper is withheld rather than walked without end.
const MAX_DEPTH = 8;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2}))?$/;
// Keys that only ever hold an identifier or an instant set by the code. A value under one of them is
// kept only when it has exactly that shape; under any other key a UUID-shaped string is text a person
// typed (a name can look like a UUID whose last group is a civil ID) and is scrubbed like any text.
const STRUCTURED_KEYS: ReadonlySet<string> = new Set([
  "id",
  "patientId",
  "roleId",
  "branchId",
  "branchIds",
  "registrationBranchId",
  "invitationId",
  "expiresAt",
  "verifiedAt",
  "degradedAt",
]);

function maskDigitRun(run: string): string {
  const digits = run.match(DIGIT) ?? [];
  if (digits.length >= CIVIL_ID_MIN_DIGITS) return REDACTED;
  if (digits.length >= PHONE_MIN_DIGITS) return `***${digits.slice(-3).join("")}`;
  return run;
}

/**
 * نص بيتكتب في السجل أو بيطلع منه (اسم فاعل، اسم عيادة أو دور أو فرع، نص في لقطة): موحّد
 * (`normalizeAuditText`)، من غير سر (`redactSecrets`)، وأي سلسلة أرقام فيها 12 رقم أو أكتر بتتشال
 * كلها (رقم مدني)، ومن 7 لـ 11 بيفضل منها آخر 3 بس (تليفون)، مهما كان اللي لازق فيها.
 *
 * @param text the text as typed or stored
 * @returns the text that may be stored or shown
 */
export function scrubAuditText(text: string): string {
  const scrubbed = redactSecrets(normalizeAuditText(text));
  return (typeof scrubbed === "string" ? scrubbed : REDACTED).replace(DIGIT_RUN, maskDigitRun);
}

function scrubLeaf(key: string | undefined, value: unknown): unknown {
  if (typeof value === "string") {
    const structured = key !== undefined && STRUCTURED_KEYS.has(key);
    return structured && (UUID.test(value) || INSTANT.test(value)) ? value : scrubAuditText(value);
  }
  if (typeof value === "number" && Number.isInteger(value) && Math.abs(value) >= LONG_INTEGER) {
    return scrubAuditText(String(value));
  }
  return value;
}

/**
 * نفس `scrubAuditText` على كل نص في قيمة، في أي عمق (لقطة قبل/بعد فيها objects وarrays جوه بعض).
 * الـ UUID والوقت بيفضلوا زي ما هما بس تحت مفاتيحهم المعروفة ولو شكلهم مظبوط؛ عنصر array بياخد
 * مفتاح الـ array (`branchIds`). أعمق من 8 مستويات بيتشال.
 *
 * @param value the details or snapshot
 * @param key the key the value sits under (for array items: the array's key)
 * @param depth the current depth (0 from outside)
 * @returns a copy with every string scrubbed
 */
export function scrubAuditValue(value: unknown, key?: string, depth = 0): unknown {
  if (typeof value !== "object" || value === null) return scrubLeaf(key, value);
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => scrubAuditValue(item, key, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [name, scrubAuditValue(item, name, depth + 1)]),
  );
}
