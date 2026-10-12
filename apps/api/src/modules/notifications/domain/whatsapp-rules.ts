import { NOTIFICATION_KINDS } from "@eyadex/contracts/notifications";
import {
  whatsappTemplateSchema,
  WHATSAPP_RISK_VERSION,
  type WhatsappChannelView,
  type WhatsappCoexistenceRequest,
  type WhatsappStatus,
  type WhatsappTransport,
} from "@eyadex/contracts/whatsapp";

/** A Meta template per message kind; `null` = none set for that kind. */
export type WhatsappTemplates = WhatsappCoexistenceRequest["templates"];

/** صف قناة واتساب العيادة كما هو في الداتابيز (0057). */
export interface ChannelRecord {
  readonly id: string;
  readonly transport: WhatsappTransport | null;
  readonly status: WhatsappStatus;
  /** موجود ⇔ فيه instance على Evolution لطريقة الربط الحالية. */
  readonly instanceName: string | null;
  readonly phoneLast4: string | null;
  readonly riskAcceptedAt: Date | null;
  /** The admin's user id; never in a response. */
  readonly riskAcceptedBy: string | null;
  readonly riskVersion: number | null;
  /** التوكن المختوم (AAD = id الصف)؛ مايرجعش في أي رد أبداً. */
  readonly sealedCredentials: string | null;
  readonly phoneNumberId: string | null;
  readonly businessAccountId: string | null;
  readonly templates: WhatsappTemplates;
  readonly connectedAt: Date | null;
  readonly lastError: string | null;
}

/** A refusal decided under the channel lock: `validation` with one detail. */
export interface ChannelRefusal {
  readonly path: string;
  readonly code: string;
}

/**
 * اسم الـ instance بتاع العيادة على Evolution (spec §7.1): ثابت للعيادة، فإعادة الربط بتلاقيه.
 *
 * @param clinicId العيادة
 * @returns `eyadex-<clinic id>`
 */
export function instanceNameFor(clinicId: string): string {
  return `eyadex-${clinicId}`;
}

/**
 * آخر 4 أرقام من `ownerJid` بتاع Evolution (`<digits>[:device]@s.whatsapp.net`). الرقم الكامل مابيتخزنش
 * ولا بيرجع.
 *
 * @param ownerJid القيمة اللي Evolution رجّعها
 * @returns 4 أرقام، أو `null` لو مش رقم
 */
export function last4FromOwnerJid(ownerJid: unknown): string | null {
  if (typeof ownerJid !== "string") return null;
  const digits = /^(\d+)(?::\d+)?@/.exec(ownerJid)?.[1];
  return digits === undefined || digits.length < 4 ? null : digits.slice(-4);
}

const QR_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

/**
 * الـ QR زي ما Evolution بيرجّعه (data URL لصورة PNG)، لو شكله صح بس؛ أي حاجة تانية = لسه مااتعملش.
 *
 * @param value حقل `base64`
 * @returns الـ data URL أو `null`
 */
export function qrDataUrlOf(value: unknown): string | null {
  return typeof value === "string" && QR_DATA_URL.test(value) ? value : null;
}

/**
 * هل قبول المخاطرة محتاج يتسجل دلوقتي؟ أول مرة، أو لو نص المخاطرة اتغيّر بعد آخر قبول.
 *
 * @param record صف القناة أو `null`
 * @returns `true` لو لازم صف قبول جديد وسجل تدقيق
 */
export function riskToRecord(record: ChannelRecord | null): boolean {
  return (record?.riskVersion ?? 0) < WHATSAPP_RISK_VERSION;
}

/**
 * ربط Evolution مرفوض لما رقم coexistence لسه مربوط: الأدمن يفك الربط الأول.
 *
 * @param record صف القناة أو `null`
 * @returns الرفض أو `null`
 */
export function evolutionLinkRefusal(record: ChannelRecord | null): ChannelRefusal | null {
  return record?.transport === "coexistence" && record.status !== "disconnected"
    ? { path: "transport", code: "coexistence_linked" }
    : null;
}

/**
 * حفظ coexistence مرفوض لما رقم Evolution لسه مربوط أو بيتربط، أو لما مفيش توكن لا في الطلب ولا محفوظ.
 *
 * @param record صف القناة أو `null`
 * @param hasToken الطلب فيه توكن
 * @returns الرفض أو `null`
 */
export function coexistenceRefusal(
  record: ChannelRecord | null,
  hasToken: boolean,
): ChannelRefusal | null {
  if (record?.transport === "evolution" && record.status !== "disconnected") {
    return { path: "transport", code: "evolution_linked" };
  }
  if (!hasToken && record?.sealedCredentials == null) {
    return { path: "accessToken", code: "required" };
  }
  return null;
}

/**
 * القوالب المحفوظة (jsonb) بشكل العقد: كل نوع رسالة موجود، واللي مش محفوظ أو شكله غلط = `null`.
 *
 * @param raw قيمة العمود
 * @returns قالب لكل نوع
 */
export function templatesOf(raw: unknown): WhatsappTemplates {
  const stored = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    NOTIFICATION_KINDS.map((kind) => {
      const parsed = whatsappTemplateSchema.safeParse(stored[kind]);
      return [kind, parsed.success ? parsed.data : null];
    }),
  ) as WhatsappTemplates;
}

/**
 * هل حفظ coexistence محتاج instance جديد على Evolution؟ أول ربط، أو طريقة ربط تانية، أو توكن جديد، أو
 * أرقام Meta اتغيّرت. القوالب لوحدها مش محتاجة.
 *
 * @param record صف القناة أو `null`
 * @param request الطلب
 * @param tokenChanged التوكن في الطلب غير المحفوظ
 * @returns `true` لو لازم الـ instance يتعمل من جديد
 */
export function coexistenceNeedsInstance(
  record: ChannelRecord | null,
  request: WhatsappCoexistenceRequest,
  tokenChanged: boolean,
): boolean {
  return (
    record === null ||
    record.transport !== "coexistence" ||
    record.status !== "connected" ||
    record.instanceName === null ||
    tokenChanged ||
    record.phoneNumberId !== request.phoneNumberId ||
    record.businessAccountId !== request.businessAccountId
  );
}

const sameTemplates = (a: WhatsappTemplates, b: WhatsappTemplates): boolean =>
  NOTIFICATION_KINDS.every(
    (kind) => a[kind]?.name === b[kind]?.name && a[kind]?.language === b[kind]?.language,
  );

/**
 * هل الحفظ مايغيّرش حاجة؟ نفس الربط والأرقام والقوالب ومن غير توكن جديد = مفيش كتابة ولا سجل.
 *
 * @param record صف القناة أو `null`
 * @param request الطلب
 * @param tokenChanged التوكن في الطلب غير المحفوظ
 * @returns `true` لو مفيش أي تغيير
 */
export function coexistenceUnchanged(
  record: ChannelRecord | null,
  request: WhatsappCoexistenceRequest,
  tokenChanged: boolean,
): boolean {
  return (
    record !== null &&
    !coexistenceNeedsInstance(record, request, tokenChanged) &&
    sameTemplates(record.templates, request.templates)
  );
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

/**
 * عرض القناة للأدمن (`whatsappChannelViewSchema`): عمره ما فيه توكن ولا الرقم الكامل.
 *
 * @param record صف القناة، أو `null` لعيادة ماربطتش قبل كده
 * @returns العرض
 */
export function channelView(record: ChannelRecord | null): WhatsappChannelView {
  return {
    transport: record?.transport ?? null,
    status: record?.status ?? "disconnected",
    phoneLast4: record?.phoneLast4 ?? null,
    riskAcceptedAt: iso(record?.riskAcceptedAt ?? null),
    hasCredentials: record?.sealedCredentials != null,
    templates: record?.templates ?? templatesOf({}),
    connectedAt: iso(record?.connectedAt ?? null),
    lastError: record?.lastError ?? null,
  };
}
