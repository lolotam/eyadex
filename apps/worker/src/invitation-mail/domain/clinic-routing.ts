import { USER_INVITED } from "./invitation-event.ts";

/** اللي القرار محتاجه من صف مزود العيادة. */
export interface ProviderHealth {
  readonly verifiedAt: Date | null;
  readonly degradedAt: Date | null;
  readonly fromName: string;
  readonly fromEmail: string;
  readonly replyTo: string | null;
}

/**
 * مسار الرسالة: مزود العيادة، أو المنصة كما هي، أو المنصة بالنيابة عن عيادة متحوّلة (اسم العيادة الظاهر
 * وعنوان الرد بتاعها، والعنوان نفسه عنوان المنصة لأن دومين العيادة مش متوثق عند المنصة).
 */
export type InvitationRoute =
  | { readonly kind: "clinic" }
  | { readonly kind: "platform" }
  | { readonly kind: "platform_on_behalf"; readonly fromName: string; readonly replyTo: string };

/**
 * بيختار مسار دعوة (ADR-0014، 7c-2b). دعوة المستخدم بس بتروح لمزود العيادة، ولما يكون متوثق ومش
 * متحوّل. مزود متحوّل → المنصة بالنيابة. مفيش صف أو مش متوثق → المنصة زي ما هي (مش فشل).
 *
 * @param eventType نوع حدث الدعوة
 * @param provider صف مزود العيادة، أو `null`
 * @returns المسار
 */
export function routeInvitation(
  eventType: string,
  provider: ProviderHealth | null,
): InvitationRoute {
  if (eventType !== USER_INVITED || provider === null) return { kind: "platform" };
  if (provider.degradedAt !== null) {
    return {
      kind: "platform_on_behalf",
      fromName: provider.fromName,
      replyTo: provider.replyTo ?? provider.fromEmail,
    };
  }
  if (provider.verifiedAt === null) return { kind: "platform" };
  return { kind: "clinic" };
}
