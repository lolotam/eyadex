import type { MessageLanguage, NotificationKind } from "@eyadex/contracts/notifications";
import { whatsappTemplateSchema, type WhatsappTemplate } from "@eyadex/contracts/whatsapp";

/** اللي قالب موعد بيتملي بيه (N-4): العيادة والتاريخ والوقت ومقدم الخدمة والفرع، مفيش غيرهم. */
export interface AppointmentTemplateFacts {
  readonly clinicName: string;
  readonly date: string;
  readonly time: string;
  readonly providerName: string;
  readonly branchName: string;
}

/** اللي قالب الوصفة بيتملي بيه (N-5): العيادة والطبيب وسطور الأدوية، مفيش تشخيص ولا ملاحظات. */
export interface PrescriptionTemplateFacts {
  readonly clinicName: string;
  readonly doctorName: string;
  readonly lines: readonly string[];
}

// Meta refuses a body parameter with a new line, a tab or more than four spaces in a row.
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * قيم قالب Meta بالترتيب الثابت في `whatsappTemplateSchema`: المواعيد {{1}} العيادة، {{2}} التاريخ،
 * {{3}} الوقت، {{4}} مقدم الخدمة، {{5}} الفرع؛ الوصفة {{1}} العيادة، {{2}} الطبيب، {{3}} الأدوية مفصولة
 * بـ " • ". كل قيمة سطر واحد.
 *
 * @param facts بيانات الموعد أو الوصفة
 * @returns القيم بالترتيب
 */
export function templateParameters(
  facts:
    | ({ readonly kind: "appointment" } & AppointmentTemplateFacts)
    | ({ readonly kind: "prescription" } & PrescriptionTemplateFacts),
): string[] {
  const values =
    facts.kind === "appointment"
      ? [facts.clinicName, facts.date, facts.time, facts.providerName, facts.branchName]
      : [facts.clinicName, facts.doctorName, facts.lines.join(" • ")];
  return values.map(oneLine);
}

/**
 * قالب نوع الرسالة من `clinic_whatsapp_channels.templates`. قالب ناقص أو شكله مش سليم = مفيش قالب
 * (`template_missing`)، عمره ما بيتبعت قالب مش متحقق منه.
 *
 * @param templates عمود `templates` (kind → `{name, language}`)
 * @param kind نوع الرسالة
 * @returns القالب، أو `null`
 */
export function templateFor(templates: unknown, kind: NotificationKind): WhatsappTemplate | null {
  if (typeof templates !== "object" || templates === null) return null;
  const slot: unknown = Object.hasOwn(templates, kind)
    ? (templates as Record<string, unknown>)[kind]
    : undefined;
  const parsed = whatsappTemplateSchema.safeParse(slot);
  return parsed.success ? parsed.data : null;
}

/**
 * لغة القيم: لغة القالب نفسه (Meta وافق على القالب بلغة معيّنة، فالتاريخ واسم العيادة لازم يكونوا بيها)،
 * ولو القالب بلغة غير العربي والإنجليزي، لغة المراجع.
 *
 * @param template القالب
 * @param fallback لغة المراجع أو لغة العيادة الافتراضية
 * @returns لغة القيم
 */
export function templateLanguage(
  template: WhatsappTemplate,
  fallback: MessageLanguage,
): MessageLanguage {
  const prefix = template.language.slice(0, 2);
  return prefix === "ar" || prefix === "en" ? prefix : fallback;
}
