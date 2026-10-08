import { isCalendarDay } from "@eyadex/contracts/audit-http";

import { ApiError } from "../../../shared/errors.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The database's own text for the instant, to the microsecond: a JS Date would round it to the
// millisecond and two rows in one millisecond would then share a cursor. Each part is checked on the
// text (a real day in years 1–9999, a real time), so PostgreSQL's cast can never fail on it.
const INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/;

function isInstant(text: string): boolean {
  const match = INSTANT.exec(text);
  if (match === null) return false;
  const [day = "", hour, minute, second] = match.slice(1);
  return isCalendarDay(day) && Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
}

const SOURCES = new Set(["platform", "clinic"]);

/**
 * آخر صف في الصفحة، بمفتاح الترتيب كامل. سجل العيادة: `(created_at, id)` فريد جوه العيادة. سجل
 * المنصة بيجمع جدولين وعيادات كتير، والـ id فريد بس جوه `(clinic_id, id)`، فالمفتاح بيكمّل
 * بالمصدر والعيادة عشان مايتخطاش صف ولا يتكرر.
 */
export type AuditCursor =
  | { readonly kind: "clinic"; readonly at: string; readonly id: string }
  | {
      readonly kind: "platform";
      readonly at: string;
      readonly id: string;
      readonly source: string;
      readonly clinicKey: string;
    };

const partsOf = (cursor: AuditCursor): string[] =>
  cursor.kind === "clinic"
    ? [cursor.at, cursor.id]
    : [cursor.at, cursor.id, cursor.source, cursor.clinicKey];

/**
 * بيحوّل آخر صف لـ cursor مقفول (base64url) عشان العميل مايفهموش ولا يبنيه.
 *
 * @param cursor مفتاح ترتيب آخر صف
 * @returns النص اللي بيرجع في `nextCursor`
 */
export function encodeAuditCursor(cursor: AuditCursor): string {
  return Buffer.from(partsOf(cursor).join("|")).toString("base64url");
}

/**
 * بيفك الـ cursor ويتأكد من كل جزء. أي حاجة تانية → `validation` من غير ما نرجّع النص نفسه.
 *
 * @param raw الـ cursor من الـ query، أو `undefined` لأول صفحة
 * @param kind أنهي سجل (عدد الأجزاء بيختلف)
 * @returns المفتاح، أو `null` لأول صفحة
 */
export function decodeAuditCursor(
  raw: string | undefined,
  kind: AuditCursor["kind"],
): AuditCursor | null {
  if (raw === undefined) return null;
  const parts = Buffer.from(raw, "base64url").toString().split("|");
  const [at = "", id = "", source = "", clinicKey = ""] = parts;
  const valid =
    parts.length === (kind === "clinic" ? 2 : 4) &&
    isInstant(at) &&
    UUID.test(id) &&
    (kind === "clinic" || (SOURCES.has(source) && UUID.test(clinicKey)));
  if (!valid) throw new ApiError("validation", [{ path: ["cursor"], code: "invalid" }]);
  return kind === "clinic" ? { kind, at, id } : { kind, at, id, source, clinicKey };
}
