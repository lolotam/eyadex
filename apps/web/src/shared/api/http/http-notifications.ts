import {
  mailProviderViewSchema,
  mailProvidersResponseSchema,
  type MailProviderRequest,
} from "@eyadex/contracts/mail-provider";
import {
  mailProviderSlotSchema,
  notificationSettingsSchema,
  patientNotificationListSchema,
  type MailProviderSlot,
  type NotificationSettings,
} from "@eyadex/contracts/notifications";
import { ApiError } from "../api-error";
import type { NotificationsApi } from "../notifications-client";
import type { HttpContext } from "./http-context";

/** Only the two slot names can ever reach the URL. */
function slotPath(slot: MailProviderSlot): string {
  const parsed = mailProviderSlotSchema.safeParse(slot);
  if (!parsed.success) throw new ApiError("validation");
  return `/v1/clinic/mail-providers/${parsed.data}`;
}

/** The request's declared fields only, so nothing else the caller's object carries is sent. */
export function toMailProviderBody(input: MailProviderRequest): MailProviderRequest {
  const sender = {
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  };
  return input.kind === "resend"
    ? { kind: "resend", apiKey: input.apiKey, ...sender }
    : {
        kind: "smtp",
        host: input.host,
        port: input.port,
        user: input.user,
        password: input.password,
        ...sender,
      };
}

const settingsBody = (s: NotificationSettings): NotificationSettings => ({
  emailEnabled: s.emailEnabled,
  messages: { ...s.messages },
});

export function createHttpNotifications(ctx: HttpContext): NotificationsApi {
  const { transport } = ctx;
  return {
    getSettings: () =>
      transport.send("GET", "/v1/clinic/notification-settings", {
        schema: notificationSettingsSchema,
      }),
    updateSettings: (_persona, input) =>
      transport.send("PUT", "/v1/clinic/notification-settings", {
        schema: notificationSettingsSchema,
        body: settingsBody(input),
      }),
    mailProviders: () =>
      transport.send("GET", "/v1/clinic/mail-providers", { schema: mailProvidersResponseSchema }),
    setMailProvider: (_persona, slot, input, idempotencyKey) =>
      transport.send("PUT", slotPath(slot), {
        schema: mailProviderViewSchema,
        body: toMailProviderBody(input),
        idempotencyKey,
      }),
    removeMailProvider: (_persona, slot) => transport.sendEmpty("DELETE", slotPath(slot)),
    testMailProvider: (_persona, slot, idempotencyKey) =>
      transport.sendEmpty("POST", `${slotPath(slot)}/test`, { idempotencyKey }),
    appointmentHistory: (_persona, id) =>
      transport.send("GET", `/v1/appointments/${encodeURIComponent(id)}/notifications`, {
        schema: patientNotificationListSchema,
      }),
    visitHistory: (_persona, id) =>
      transport.send("GET", `/v1/visits/${encodeURIComponent(id)}/notifications`, {
        schema: patientNotificationListSchema,
      }),
  };
}
