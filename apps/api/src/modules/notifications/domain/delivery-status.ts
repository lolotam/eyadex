import type { NotificationStatus } from "@eyadex/contracts/notifications";

/** The WhatsApp transport whose provider reported the status. */
export type DeliveryTransport = "evolution" | "coexistence";

/** What a provider said happened to a message it had accepted (spec §7.2). */
export type DeliveryUpdate =
  | { readonly kind: "delivered"; readonly at: Date }
  | { readonly kind: "read"; readonly at: Date }
  /** `code` is the ledger's code without the transport prefix (`meta_rejected`, `evo_delivery_rejected`…). */
  | { readonly kind: "failed"; readonly code: string };

/** The part of a ledger row a status may change. */
export interface DeliveryState {
  readonly status: NotificationStatus;
  readonly deliveredAt: Date | null;
  readonly readAt: Date | null;
  readonly lastError: string | null;
}

const later = (a: Date, b: Date): Date => (a.getTime() >= b.getTime() ? a : b);

/**
 * قاعدة "لقدّام بس" (spec §7.2): مُرسلة ← اتسلّمت ← اتقرت. بتتطبّق على صف `sent` بس؛ القراءة قبل التسليم
 * بتحط الاتنين (القراءة معناها إنها اتسلّمت)؛ تسليم متأخر بعد القراءة أو حدث متكرر مابيغيّرش حاجة؛ الفشل
 * بعد القبول بيحوّل الصف `failed` بكود `<transport>:<code>` ويسيب أوقات القبول والتسليم زي ما هي.
 *
 * @param state الصف زي ما هو دلوقتي
 * @param transport طريقة الربط اللي بعتت الرسالة
 * @param update اللي المزود قاله
 * @returns الصف الجديد، أو `null` لو مفيش تغيير
 */
export function applyDeliveryUpdate(
  state: DeliveryState,
  transport: DeliveryTransport,
  update: DeliveryUpdate,
): DeliveryState | null {
  if (state.status !== "sent") return null;
  if (update.kind === "failed")
    return { ...state, status: "failed", lastError: `${transport}:${update.code}` };
  if (update.kind === "delivered")
    return state.deliveredAt === null ? { ...state, deliveredAt: update.at } : null;
  if (state.readAt !== null) return null;
  const deliveredAt = state.deliveredAt ?? update.at;
  return { ...state, deliveredAt, readAt: later(update.at, deliveredAt) };
}

/**
 * كود فشل التسليم من كود Meta الرقمي (spec §7.2). كله نهائي: الرسالة اتقبلت قبل كده، فمفيش إعادة.
 *
 * @param code `errors[0].code` من الـ webhook، أو `null`
 * @returns كود الدفتر من غير البادئة
 */
export function metaDeliveryFailureCode(code: number | null): string {
  if (code === 131026) return "meta_not_on_whatsapp";
  if (code === 131048 || code === 131056 || code === 130429) return "meta_rate_limited";
  if (code !== null && code >= 132000 && code <= 132015) return "meta_template";
  return "meta_rejected";
}
