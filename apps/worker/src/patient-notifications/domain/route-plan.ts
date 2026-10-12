import type { NotificationRoute } from "@eyadex/contracts/notifications";

import type { ProviderHealth } from "../../invitation-mail/domain/clinic-routing.ts";

const ORDER: readonly NotificationRoute[] = ["primary", "fallback", "platform"];

/** مزود متوثق ومش متحوّل: الحالة الوحيدة اللي بنبعت بيها عبر مزود العيادة (ADR-0014). */
const usable = (provider: ProviderHealth | null): boolean =>
  provider !== null && provider.verifiedAt !== null && provider.degradedAt === null;

/**
 * ترتيب المسارات لمحاولة واحدة (N-3): المزود الأساسي، ثم البديل — كل واحد بس لو متوثق ومش متحوّل —
 * وفي الآخر المنصة بالنيابة عن العيادة (موجودة دايمًا). لو المحاولة اللي فاتت وقفت عند مسار بفشل غامض،
 * نبدأ منه ومانرجعش لمسار قبله.
 *
 * @param primary صف المزود الأساسي، أو `null`
 * @param fallback صف المزود البديل، أو `null`
 * @param resumeFrom المسار اللي نكمّل منه (`resumeRoute`)، أو `null` = من الأول
 * @returns المسارات بالترتيب، وآخرها `platform` دايمًا
 */
export function planRoutes(
  primary: ProviderHealth | null,
  fallback: ProviderHealth | null,
  resumeFrom: NotificationRoute | null,
): NotificationRoute[] {
  const from = resumeFrom === null ? 0 : ORDER.indexOf(resumeFrom);
  const open: Record<NotificationRoute, boolean> = {
    primary: usable(primary),
    fallback: usable(fallback),
    platform: true,
  };
  return ORDER.filter((route, index) => index >= from && open[route]);
}

/**
 * عنوان الرد لما المنصة بتبعت بالنيابة: عنوان الرد بتاع المزود الأساسي أو عنوان الإرسال بتاعه، وإلا نفس
 * الحاجة من البديل. العيادة مالهاش إيميل غير كده، فمن غير أي مزود الرسالة بتمشي من غير عنوان رد.
 *
 * @param primary صف المزود الأساسي، أو `null`
 * @param fallback صف المزود البديل، أو `null`
 * @returns العنوان، أو `null`
 */
export function onBehalfReplyTo(
  primary: ProviderHealth | null,
  fallback: ProviderHealth | null,
): string | null {
  return primary?.replyTo ?? primary?.fromEmail ?? fallback?.replyTo ?? fallback?.fromEmail ?? null;
}
