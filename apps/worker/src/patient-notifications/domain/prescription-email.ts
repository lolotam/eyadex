import type { MessageLanguage } from "@eyadex/contracts/notifications";

import { renderNotification, type RenderedNotification } from "./email-layout.ts";

/** سطر دوا مفتوح: الاسم والجرعة والتكرار والمدة وملاحظة السطر نفسه (لو فيه). */
export interface PrescriptionLine {
  readonly medicine: string;
  readonly dose: string;
  readonly frequency: string;
  readonly duration: string;
  readonly note: string | null;
}

/**
 * اللي إيميل الوصفة بيقوله، ومفيش غيره (N-5): سطور الأدوية واسم الطبيب. مفيش خانة للتشخيص ولا ملاحظات
 * الزيارة، فمستحيل توصل للنص.
 */
export interface PrescriptionMessage {
  readonly language: MessageLanguage;
  readonly clinicName: string;
  readonly doctorName: string;
  readonly lines: readonly PrescriptionLine[];
}

const COPY = {
  ar: {
    subject: (c: string) => `وصفتك الطبية من ${c}`,
    greeting: "مرحباً،",
    intro: (c: string) => `هذه هي الأدوية التي وُصفت لك في ${c}.`,
    clinic: "العيادة",
    doctor: "الطبيب",
    line: (l: PrescriptionLine) =>
      [l.medicine, l.dose, l.frequency, l.duration, l.note]
        .filter((part): part is string => part !== null && part.trim() !== "")
        .join(" — "),
    closing: "إذا كان لديك أي سؤال عن أدويتك، يرجى التواصل مع العيادة.",
    footer: (c: string) => `أُرسلت هذه الرسالة من ${c} عبر Eyadex.`,
  },
  en: {
    subject: (c: string) => `Your prescription from ${c}`,
    greeting: "Hello,",
    intro: (c: string) => `These are the medicines prescribed for you at ${c}.`,
    clinic: "Clinic",
    doctor: "Prescribed by",
    line: (l: PrescriptionLine) =>
      [l.medicine, l.dose, l.frequency, l.duration, l.note]
        .filter((part): part is string => part !== null && part.trim() !== "")
        .join(" — "),
    closing: "If you have any questions about your medicines, please contact the clinic.",
    footer: (c: string) => `This message was sent by ${c} through Eyadex.`,
  },
} as const;

/**
 * إيميل الوصفة بلغة المراجع (أو لغة العيادة الافتراضية): الموضوع والجسم بيسمّوا العيادة، وكل دوا سطر.
 *
 * @param message الأدوية واسم الطبيب بس
 * @returns الموضوع والـ HTML والنص
 */
export function renderPrescriptionEmail(message: PrescriptionMessage): RenderedNotification {
  const copy = COPY[message.language];
  return renderNotification({
    language: message.language,
    clinicName: message.clinicName,
    subject: copy.subject(message.clinicName),
    greeting: copy.greeting,
    intro: copy.intro(message.clinicName),
    details: [
      { label: copy.clinic, value: message.clinicName },
      { label: copy.doctor, value: message.doctorName },
    ],
    items: message.lines.map(copy.line),
    closing: copy.closing,
    footer: copy.footer(message.clinicName),
  });
}
