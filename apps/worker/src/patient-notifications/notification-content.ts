import { formatMinor } from "@eyadex/contracts/money";
import type { MessageLanguage } from "@eyadex/contracts/notifications";

import type { MessageContent } from "./domain/whatsapp-message.ts";
import type { SendTarget } from "./handler-context.ts";
import type { ReadyNotification } from "./ports/notification-store.ts";
import { openPrescriptionLines, type FieldOpener } from "./prescription-lines.ts";

/** محتوى الرسالة قبل أي قناة: موعد أو وصفة أو فاتورة، أو سبب إن مفيش محتوى ينفع يتبعت. */
export type NotificationContent =
  MessageContent | { readonly kind: "broken"; readonly error: string };

/**
 * موضوع الرسالة اتشال من وقت ما اتسجّلت (موعد أو زيارة أو فاتورة مش موجودة)؟
 *
 * @param state الصفوف الممسوكة
 * @returns صح لو مفيش موضوع يتبعت عنه
 */
export function subjectMissing(state: ReadyNotification): boolean {
  const { kind } = state.ledger;
  if (kind === "invoice") return state.invoice === null;
  return kind === "prescription" ? state.visit === null : state.appointment === null;
}

/**
 * الفاكتس اللي قرار التخطي محتاجها من الصفوف الممسوكة، غير القناة.
 *
 * @param state الصفوف الممسوكة
 * @returns النوع والإعدادات والمراجع والموعد (لرسايل المواعيد بس) وحالة الفاتورة
 */
export function sendFacts(state: ReadyNotification) {
  const { kind } = state.ledger;
  const forAppointment = kind !== "prescription" && kind !== "invoice";
  return {
    kind,
    settings: state.settings,
    patient: { email: state.patient.email, optedOut: state.patient.optedOut },
    appointment: forAppointment ? state.appointment : null,
    invoiceVoid: state.invoice?.status === "void",
  };
}

/**
 * المحتوى المسموح بيه بس (N-4، N-5) بلغة معيّنة، من الصفوف الممسوكة: الإيميل ونص واتساب وقيم قالب Meta
 * كلهم بيتبنوا منه. مفيش محاولة تصلّح `broken` (زيارة ناقصة، مفيش مفتاح للوصفة، ظرف مايتفتحش).
 *
 * @param state الصفوف الممسوكة
 * @param target العيادة (ربط ظروف الوصفة) ورابط الفاتورة
 * @param cipher فاتح سطور الوصفة، أو `null`
 * @param language لغة الرسالة
 * @returns المحتوى، أو سبب الكسر
 */
export function buildContent(
  state: ReadyNotification,
  target: SendTarget,
  cipher: FieldOpener | null,
  language: MessageLanguage,
): NotificationContent {
  const clinicName = language === "ar" ? state.clinic.nameAr : state.clinic.nameEn;
  const { kind } = state.ledger;
  if (kind === "invoice") {
    const { invoice } = state;
    if (invoice === null || target.invoiceUrl === null) {
      return { kind: "broken", error: "subject_missing" };
    }
    return {
      kind: "invoice",
      message: {
        language,
        clinicName,
        number: invoice.number,
        amount: `${formatMinor(invoice.totalMinor, invoice.currencyExponent)} ${invoice.currency}`,
        url: target.invoiceUrl,
      },
    };
  }
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
    const lines = openPrescriptionLines(cipher, target.clinicId, visit.lines);
    return {
      kind: "prescription",
      message: { language, clinicName, doctorName: visit.doctorName, lines },
    };
  } catch {
    return { kind: "broken", error: "field_unreadable" };
  }
}
