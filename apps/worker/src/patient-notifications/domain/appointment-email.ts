import type { MessageLanguage, NotificationKind } from "@eyadex/contracts/notifications";

import { formatWhen, renderNotification, type RenderedNotification } from "./email-layout.ts";

/** رسايل المواعيد: كل الأنواع غير الوصفة. */
export type AppointmentKind = Exclude<NotificationKind, "prescription">;

/**
 * اللي رسالة الموعد بتقوله، ومفيش غيره (N-4): العيادة، الفرع، التاريخ والوقت، واسم مقدم الخدمة. النوع
 * نفسه مافيهوش خانة للخدمة ولا التشخيص ولا الملاحظات، فمستحيل توصل للنص.
 */
export interface AppointmentMessage {
  readonly kind: AppointmentKind;
  readonly language: MessageLanguage;
  readonly clinicName: string;
  readonly branchName: string;
  readonly branchAddress: string | null;
  readonly startsAt: Date;
  readonly timeZone: string;
  readonly providerName: string;
}

type Copy = {
  readonly subject: Record<AppointmentKind, (clinic: string) => string>;
  readonly intro: Record<AppointmentKind, (clinic: string) => string>;
  readonly greeting: string;
  readonly labels: {
    clinic: string;
    branch: string;
    address: string;
    date: string;
    time: string;
    provider: string;
  };
  readonly change: string;
  readonly rebook: string;
  readonly footer: (clinic: string) => string;
};

// Product vocabulary (CLAUDE.md §0): the message speaks to the person directly and never calls them a
// patient. Nothing medical: no service, no diagnosis, no note.
const COPY: Record<MessageLanguage, Copy> = {
  ar: {
    subject: {
      booked: (c) => `تم تأكيد موعدك في ${c}`,
      rescheduled: (c) => `تم تغيير موعدك في ${c}`,
      cancelled: (c) => `تم إلغاء موعدك في ${c}`,
      reminder_day: (c) => `تذكير بموعدك القادم في ${c}`,
      reminder_2h: (c) => `تذكير: موعدك في ${c} بعد قليل`,
    },
    intro: {
      booked: (c) => `تم حجز موعدك في ${c}.`,
      rescheduled: (c) => `تم تغيير موعدك في ${c}، وهذا هو الموعد الجديد.`,
      cancelled: (c) => `تم إلغاء موعدك التالي في ${c}.`,
      reminder_day: (c) => `نذكّرك بموعدك القادم في ${c}.`,
      reminder_2h: (c) => `نذكّرك بأن موعدك في ${c} بعد قليل.`,
    },
    greeting: "مرحباً،",
    labels: {
      clinic: "العيادة",
      branch: "الفرع",
      address: "العنوان",
      date: "التاريخ",
      time: "الوقت",
      provider: "مع",
    },
    change: "لتغيير الموعد أو إلغائه، يرجى التواصل مع العيادة.",
    rebook: "لحجز موعد جديد، يرجى التواصل مع العيادة.",
    footer: (c) => `أُرسلت هذه الرسالة من ${c} عبر Eyadex.`,
  },
  en: {
    subject: {
      booked: (c) => `Your appointment at ${c} is confirmed`,
      rescheduled: (c) => `Your appointment at ${c} has a new time`,
      cancelled: (c) => `Your appointment at ${c} is cancelled`,
      reminder_day: (c) => `Reminder: your upcoming appointment at ${c}`,
      reminder_2h: (c) => `Reminder: your appointment at ${c} is coming up soon`,
    },
    intro: {
      booked: (c) => `Your appointment at ${c} is booked.`,
      rescheduled: (c) => `Your appointment at ${c} has been moved. Here is the new time.`,
      cancelled: (c) => `The following appointment at ${c} has been cancelled.`,
      reminder_day: (c) => `This is a reminder of your upcoming appointment at ${c}.`,
      reminder_2h: (c) => `This is a reminder that your appointment at ${c} is coming up soon.`,
    },
    greeting: "Hello,",
    labels: {
      clinic: "Clinic",
      branch: "Branch",
      address: "Address",
      date: "Date",
      time: "Time",
      provider: "With",
    },
    change: "To change or cancel this appointment, please contact the clinic.",
    rebook: "To book a new appointment, please contact the clinic.",
    footer: (c) => `This message was sent by ${c} through Eyadex.`,
  },
};

/**
 * رسالة موعد بلغة المراجع (أو لغة العيادة الافتراضية): الموضوع والجسم بيسمّوا العيادة، والتاريخ والوقت
 * بمنطقة العيادة (spec §4).
 *
 * @param message بيانات الموعد المسموح بيها بس
 * @returns الموضوع والـ HTML والنص
 */
export function renderAppointmentEmail(message: AppointmentMessage): RenderedNotification {
  const copy = COPY[message.language];
  const when = formatWhen(message.startsAt, message.language, message.timeZone);
  const { labels } = copy;
  return renderNotification({
    language: message.language,
    clinicName: message.clinicName,
    subject: copy.subject[message.kind](message.clinicName),
    greeting: copy.greeting,
    intro: copy.intro[message.kind](message.clinicName),
    details: [
      { label: labels.clinic, value: message.clinicName },
      { label: labels.branch, value: message.branchName },
      ...(message.branchAddress === null
        ? []
        : [{ label: labels.address, value: message.branchAddress }]),
      { label: labels.date, value: when.date },
      { label: labels.time, value: when.time },
      { label: labels.provider, value: message.providerName },
    ],
    closing: message.kind === "cancelled" ? copy.rebook : copy.change,
    footer: copy.footer(message.clinicName),
  });
}
