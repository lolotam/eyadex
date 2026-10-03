import type { Language } from "@eyadex/contracts/common";

/** Date and time of an audit entry, shown in the given time zone. */
export function formatAuditTime(iso: string, lang: Language, timeZone: string): string {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-KW" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}
