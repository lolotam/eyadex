import { NOTIFICATION_KINDS, type NotificationKind } from "@eyadex/contracts/notifications";
import type { WhatsappChannelView, WhatsappCoexistenceRequest } from "@eyadex/contracts/whatsapp";

export type TemplateDraft = { name: string; language: string };

export type CoexistenceDraft = {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  templates: Record<NotificationKind, TemplateDraft>;
};

/** Meta identifiers pre-fill from the view; the write-only token always starts empty. */
export function coexistenceDraftOf(view: WhatsappChannelView | null): CoexistenceDraft {
  return {
    accessToken: "",
    phoneNumberId: view?.phoneNumberId ?? "",
    businessAccountId: view?.businessAccountId ?? "",
    templates: Object.fromEntries(
      NOTIFICATION_KINDS.map((kind) => {
        const t = view?.templates[kind];
        return [kind, { name: t?.name ?? "", language: t?.language ?? "" }];
      }),
    ) as Record<NotificationKind, TemplateDraft>,
  };
}

/**
 * The request: an empty token is omitted so the stored one is kept (write-only); a message kind with
 * no template name is `null` (not sent on WhatsApp).
 */
export function toCoexistenceRequest(d: CoexistenceDraft): WhatsappCoexistenceRequest {
  return {
    ...(d.accessToken.trim() ? { accessToken: d.accessToken.trim() } : {}),
    phoneNumberId: d.phoneNumberId.trim(),
    businessAccountId: d.businessAccountId.trim(),
    templates: Object.fromEntries(
      NOTIFICATION_KINDS.map((kind) => {
        const t = d.templates[kind];
        return [kind, t.name.trim() ? { name: t.name.trim(), language: t.language.trim() } : null];
      }),
    ) as WhatsappCoexistenceRequest["templates"],
  };
}
