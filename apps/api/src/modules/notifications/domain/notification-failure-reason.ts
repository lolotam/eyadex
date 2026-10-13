import type {
  NotificationFailureReason,
  NotificationStatus,
} from "@eyadex/contracts/notifications";

/**
 * يحوّل كود الدفتر إلى سبب عام دون تسريب تفاصيل المزود إلى تاريخ الرسائل.
 * @param status حالة الرسالة
 * @param lastError كود الفشل المحفوظ
 * @returns السبب للفشل فقط، أو null لبقية الحالات
 */
export function notificationFailureReason(
  status: NotificationStatus,
  lastError: string | null,
): NotificationFailureReason | null {
  if (status !== "failed") return null;
  const code =
    lastError?.replace(/^(?:evolution|coexistence|primary|fallback|platform):/, "") ?? "";
  if (code === "evo_delivery_rejected") return "delivery_rejected";
  if (["evo_not_on_whatsapp", "meta_not_on_whatsapp"].includes(code)) return "not_on_whatsapp";
  if (["evo_unauthorized", "meta_unauthorized", "seal_unreadable"].includes(code))
    return "whatsapp_credentials";
  if (code === "meta_template" || /^(?:template(?:_|:|$)|.*:template(?:_|:|$))/.test(code))
    return "template";
  if (code === "evo_not_connected") return "disconnected";
  // N3: the WhatsApp Business app on the number has two-step verification on (Meta error 2388001).
  if (code === "meta_two_step") return "whatsapp_two_step";
  if (
    ["evo_timeout", "meta_timeout", "route_timeout", "resend_timeout", "resend_network"].includes(
      code.split(":")[0] ?? "",
    ) ||
    /ambiguous|unconfirmed|_after_data(?:$|:)/.test(code)
  )
    return "unconfirmed";
  if (
    ["invalid_phone", "no_email", "invalid_address", "invalid_email"].includes(code) ||
    /(?:^|[:_])invalid_(?:address|email(?:_address)?)(?:$|:)/.test(code)
  )
    return "invalid_address";
  return "other";
}
