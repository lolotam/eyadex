import { renderAppointmentEmail, type AppointmentMessage } from "./appointment-email.ts";
import { formatWhen } from "./email-layout.ts";
import {
  prescriptionLineText,
  renderPrescriptionEmail,
  type PrescriptionMessage,
} from "./prescription-email.ts";
import { templateParameters } from "./whatsapp-template.ts";

/** محتوى رسالة جاهز لأي قناة: موعد أو وصفة، بلغة واحدة. */
export type MessageContent =
  | { readonly kind: "appointment"; readonly message: AppointmentMessage }
  | { readonly kind: "prescription"; readonly message: PrescriptionMessage };

/**
 * نص رسالة Evolution (spec §7.1): نفس كلام الجزء النصي من الإيميل بلغة الرسالة، من غير موضوع ولا HTML.
 *
 * @param content المحتوى
 * @returns النص
 */
export function whatsappText(content: MessageContent): string {
  return content.kind === "appointment"
    ? renderAppointmentEmail(content.message).text
    : renderPrescriptionEmail(content.message).text;
}

/**
 * قيم قالب Meta (coexistence) بالترتيب الثابت في `whatsappTemplateSchema`، والتاريخ والوقت بمنطقة
 * العيادة ولغة المحتوى.
 *
 * @param content المحتوى (بلغة القالب)
 * @returns القيم بالترتيب
 */
export function whatsappTemplateValues(content: MessageContent): string[] {
  if (content.kind === "prescription") {
    const { clinicName, doctorName, lines } = content.message;
    return templateParameters({
      kind: "prescription",
      clinicName,
      doctorName,
      lines: lines.map(prescriptionLineText),
    });
  }
  const m = content.message;
  const when = formatWhen(m.startsAt, m.language, m.timeZone);
  return templateParameters({
    kind: "appointment",
    clinicName: m.clinicName,
    date: when.date,
    time: when.time,
    providerName: m.providerName,
    branchName: m.branchName,
  });
}
