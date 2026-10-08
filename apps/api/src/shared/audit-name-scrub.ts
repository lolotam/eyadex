// The one place slice 11 (ADR-0020) imports the strict audit scrub. Another change is moving it to
// @eyadex/observability; when it lands, only this file's import changes.
import { scrubPatientAuditText } from "./patient-audit-text.ts";

/**
 * نص كتبه شخص (اسم عيادة، اسم عضو، اسم مرسل) قبل ما يدخل سجل التدقيق: بيتشال منه حروف التحكم
 * المخفية، وأي سلسلة أرقام طويلة (تليفون أو رقم مدني) بتتغطّى مهما كان اللي جنبها.
 *
 * @param text النص
 * @returns النص بعد التغطية
 */
export function scrubAuditName(text: string): string {
  return scrubPatientAuditText(text);
}
