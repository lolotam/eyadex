import type { MessageLanguage } from "@eyadex/contracts/notifications";

import type { MessageContent } from "./domain/whatsapp-message.ts";
import type { ReadyNotification } from "./ports/notification-store.ts";
import { openPrescriptionLines, type FieldOpener } from "./prescription-lines.ts";

/** محتوى الرسالة قبل أي قناة: موعد أو وصفة، أو سبب إن مفيش محتوى ينفع يتبعت. */
export type NotificationContent =
  MessageContent | { readonly kind: "broken"; readonly error: string };

/**
 * المحتوى المسموح بيه بس (N-4، N-5) بلغة معيّنة، من الصفوف الممسوكة: الإيميل ونص واتساب وقيم قالب Meta
 * كلهم بيتبنوا منه. مفيش محاولة تصلّح `broken` (زيارة ناقصة، مفيش مفتاح للوصفة، ظرف مايتفتحش).
 *
 * @param state الصفوف الممسوكة
 * @param clinicId العيادة (ربط ظروف الوصفة)
 * @param cipher فاتح سطور الوصفة، أو `null`
 * @param language لغة الرسالة
 * @returns المحتوى، أو سبب الكسر
 */
export function buildContent(
  state: ReadyNotification,
  clinicId: string,
  cipher: FieldOpener | null,
  language: MessageLanguage,
): NotificationContent {
  const clinicName = language === "ar" ? state.clinic.nameAr : state.clinic.nameEn;
  const { kind } = state.ledger;
  if (kind !== "prescription") {
    const appointment = state.appointment;
    if (appointment === null) return { kind: "broken", error: "subject_missing" };
    const branch = appointment.branch;
    return {
      kind: "appointment",
      message: {
        kind,
        language,
        clinicName,
        branchName: language === "ar" ? branch.nameAr : branch.nameEn,
        branchAddress: branch.address,
        startsAt: appointment.startsAt,
        timeZone: state.clinic.timeZone,
        providerName: appointment.providerName,
      },
    };
  }
  const visit = state.visit;
  if (visit === null || visit.lines.length === 0)
    return { kind: "broken", error: "subject_missing" };
  if (cipher === null) return { kind: "broken", error: "no_medical_key" };
  try {
    const lines = openPrescriptionLines(cipher, clinicId, visit.lines);
    return {
      kind: "prescription",
      message: { language, clinicName, doctorName: visit.doctorName, lines },
    };
  } catch {
    return { kind: "broken", error: "field_unreadable" };
  }
}
